package collect

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

const settingsAddr = "127.0.0.1:47631"

type settingsView struct {
	IngestURL  string `json:"ingest_url"`
	PersonID   string `json:"person_id"`
	TokenState string `json:"token_state"`
}

type settingsUpdate struct {
	IngestURL   string `json:"ingest_url"`
	PersonID    string `json:"person_id"`
	BearerToken string `json:"bearer_token"`
}

type sourceResult struct {
	Source string `json:"source"`
	Label  string `json:"label"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

func serveSettings() error {
	ln, err := net.Listen("tcp", settingsAddr)
	if err != nil {
		if isAddrInUse(err) && runtime.GOOS == "darwin" && os.Getenv("LIFELOG_UI_NO_OPEN") != "1" {
			_ = exec.Command("open", "http://"+settingsAddr+"/").Start()
			return nil
		}
		return err
	}
	secret, err := newSecret()
	if err != nil {
		return err
	}
	var srv *http.Server
	srv = &http.Server{Handler: newSettingsHandler(secret, func() {
		go srvShutdown(srv)
	})}
	url := "http://" + ln.Addr().String() + "/"
	fmt.Println(url)
	if os.Getenv("LIFELOG_UI_NO_OPEN") != "1" {
		openSettings(url)
	}
	err = srv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func srvShutdown(srv *http.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func openSettings(url string) {
	if runtime.GOOS != "darwin" {
		return
	}
	_ = exec.Command("open", url).Start()
}

func isAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}

func newSecret() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func newSettingsHandler(secret string, quit func()) http.Handler {
	mux := http.NewServeMux()
	page := template.Must(template.New("settings").Parse(settingsPage))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = page.Execute(w, secret)
	})
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		if !allowSettings(w, r, secret) {
			return
		}
		writeJSON(w, currentSettings())
	})
	mux.HandleFunc("POST /api/settings", func(w http.ResponseWriter, r *http.Request) {
		if !allowSettings(w, r, secret) {
			return
		}
		var update settingsUpdate
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&update); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if err := saveConfig(stateDirFromEnv(), update.IngestURL, update.PersonID); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(update.BearerToken) != "" {
			if err := writeKeychainToken(strings.TrimSpace(update.BearerToken)); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}
		writeJSON(w, currentSettings())
	})
	mux.HandleFunc("POST /api/run", func(w http.ResponseWriter, r *http.Request) {
		if !allowSettings(w, r, secret) {
			return
		}
		writeJSON(w, map[string]any{"results": collectNow(time.Now())})
	})
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		if !allowSettings(w, r, secret) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
		if quit != nil {
			quit()
		}
	})
	return mux
}

func allowSettings(w http.ResponseWriter, r *http.Request, secret string) bool {
	if r.Header.Get("X-Lifelog-Token") != secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(value)
}

func currentSettings() settingsView {
	dir := stateDirFromEnv()
	file := readConfig(filepath.Join(dir, "config.json"))
	url := os.Getenv("MACOS_INGEST_URL")
	if url == "" {
		url = file.IngestURL
	}
	personID := os.Getenv("MACOS_PERSON_ID")
	if personID == "" {
		personID = file.PersonID
	}
	return settingsView{IngestURL: url, PersonID: strings.TrimSpace(personID), TokenState: tokenState()}
}

func tokenState() string {
	if os.Getenv("MACOS_INGEST_BEARER_TOKEN") != "" {
		return "この起動では環境変数のトークンを使います"
	}
	if readKeychainToken() != "" {
		return "キーチェーンに保存済みです"
	}
	return "トークンはまだありません"
}

func writeKeychainToken(token string) error {
	cmd := exec.Command("security", "add-generic-password", "-U", "-s", "lifelog-macos-ingest", "-a", "bearer", "-w", token)
	if out, err := cmd.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(out))
		if detail == "" {
			detail = err.Error()
		}
		return fmt.Errorf("キーチェーンに保存できません: %s", detail)
	}
	return nil
}

func collectNow(now time.Time) []sourceResult {
	sources, _ := sourcesFor([]string{"run"})
	results := make([]sourceResult, 0, len(sources))
	for _, source := range sources {
		detail, err := runSource(source, now)
		item := sourceResult{Source: source, Label: sourceLabel(source), Detail: detail, OK: err == nil}
		if err != nil {
			item.Detail = err.Error()
		}
		results = append(results, item)
	}
	return results
}

func sourceLabel(source string) string {
	switch source {
	case "power":
		return "電源"
	case "screentime":
		return "スクリーンタイム"
	default:
		return source
	}
}

const settingsPage = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ライフログ収集</title>
<style>
  :root { color-scheme: light; --paper:#f4efe6; --ink:#1d2830; --muted:#5c6b74; --teal:#2b5d6b; --line:#e2d8c8; --good:#2d6a4f; --bad:#8d3b32; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 "Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif; }
  main { max-width:30rem; margin:3.5rem auto; padding:0 1.25rem 3rem; }
  h1 { font-size:1.4rem; font-weight:650; margin:0 0 0.4rem; }
  .lead { margin:0 0 1.4rem; color:var(--muted); }
  label { display:block; font-size:0.82rem; margin:1rem 0 0.3rem; }
  input { width:100%; box-sizing:border-box; border:1px solid var(--line); background:#fffdf8; color:inherit; border-radius:10px; padding:0.7rem 0.8rem; font:inherit; }
  .note { min-height:1.3rem; margin:0.45rem 0 0; color:var(--muted); font-size:0.85rem; }
  .row { display:flex; gap:0.6rem; margin-top:1.2rem; }
  button { font:inherit; border:0; border-radius:10px; padding:0.7rem 1rem; cursor:pointer; }
  button.primary { background:var(--teal); color:#f7f4ee; }
  button.quiet { background:transparent; color:var(--teal); box-shadow:inset 0 0 0 1px var(--teal); }
  button:disabled { opacity:0.55; cursor:wait; }
  ul { list-style:none; padding:0; margin:1.3rem 0 0; }
  li { display:flex; justify-content:space-between; gap:1rem; padding:0.75rem 0; border-top:1px solid var(--line); }
  .ok { color:var(--good); }
  .bad { color:var(--bad); }
  .detail { color:var(--muted); text-align:right; }
</style>
</head>
<body>
<main>
  <h1>ライフログ収集</h1>
  <p class="lead">送信先と person_id を保存して、いまの電源とスクリーンタイムを送れます。person_id は OwnTracks の user と同じにしてください。</p>
  <form id="form">
    <label for="url">送信先 URL</label>
    <input id="url" name="ingest_url" autocomplete="off" spellcheck="false" required>
    <label for="person">person_id</label>
    <input id="person" name="person_id" autocomplete="off" spellcheck="false" required placeholder="OwnTracks の user">
    <label for="token">Bearer トークン</label>
    <input id="token" name="bearer_token" type="password" autocomplete="off" placeholder="変えるときだけ入力">
    <p class="note" id="token-state"></p>
    <div class="row">
      <button class="quiet" type="submit">保存</button>
      <button class="primary" id="send" type="button">今すぐ送信</button>
      <button class="quiet" id="quit" type="button">閉じる</button>
    </div>
  </form>
  <p class="note" id="status"></p>
  <ul id="results"></ul>
</main>
<script>
const secret = {{ . }};
const headers = { "Content-Type": "application/json", "X-Lifelog-Token": secret };
const url = document.querySelector("#url");
const person = document.querySelector("#person");
const token = document.querySelector("#token");
const tokenState = document.querySelector("#token-state");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const send = document.querySelector("#send");

async function load() {
  const response = await fetch("/api/settings", { headers });
  const body = await response.json();
  url.value = body.ingest_url || "";
  person.value = body.person_id || "";
  tokenState.textContent = body.token_state || "";
}

document.querySelector("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "保存しています";
  const response = await fetch("/api/settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ ingest_url: url.value, person_id: person.value, bearer_token: token.value })
  });
  if (!response.ok) {
    status.textContent = await response.text();
    return;
  }
  const body = await response.json();
  token.value = "";
  tokenState.textContent = body.token_state || "";
  status.textContent = "保存しました";
});

send.addEventListener("click", async () => {
  send.disabled = true;
  status.textContent = "送信しています";
  results.replaceChildren();
  try {
    const response = await fetch("/api/run", { method: "POST", headers });
    if (!response.ok) {
      status.textContent = await response.text();
      return;
    }
    const body = await response.json();
    let failed = 0;
    for (const item of body.results || []) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.label + " · " + (item.ok ? "成功" : "失敗");
      name.className = item.ok ? "ok" : "bad";
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = item.detail || "";
      row.append(name, detail);
      results.append(row);
      if (!item.ok) failed++;
    }
    status.textContent = failed === 0 ? "送信できました" : "一部、またはすべて失敗しました";
  } catch (error) {
    status.textContent = "画面との通信に失敗しました";
  } finally {
    send.disabled = false;
  }
});

document.querySelector("#quit").addEventListener("click", async () => {
  await fetch("/api/quit", { method: "POST", headers });
  status.textContent = "閉じました。このタブを閉じてください";
});

load().catch(() => { status.textContent = "設定を読めませんでした"; });
</script>
</body>
</html>
`
