package collect

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsPageSavesURLAndReportsSend(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LIFELOG_STATE_DIR", dir)
	t.Setenv("MACOS_INGEST_URL", "")
	t.Setenv("MACOS_INGEST_BEARER_TOKEN", "")

	handler := newSettingsHandler("test-secret", nil)
	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "今すぐ送信") || !strings.Contains(page.Body.String(), "person_id") {
		t.Fatalf("page = %d %s", page.Code, page.Body.String())
	}
	if !strings.Contains(page.Body.String(), "test-secret") {
		t.Fatal("page did not include the request token")
	}

	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("settings without token = %d", denied.Code)
	}

	save := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"ingest_url":"https://example.test/macos-ingest","person_id":" hskksk ","bearer_token":""}`))
	save.Header.Set("X-Lifelog-Token", "test-secret")
	saved := httptest.NewRecorder()
	handler.ServeHTTP(saved, save)
	if saved.Code != http.StatusOK {
		body, _ := io.ReadAll(saved.Body)
		t.Fatalf("save = %d %s", saved.Code, body)
	}
	config, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil || !strings.Contains(string(config), "https://example.test/macos-ingest") || !strings.Contains(string(config), `"person_id": "hskksk"`) {
		t.Fatalf("config = %s %v", config, err)
	}
	blank := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"ingest_url":"https://example.test/macos-ingest","person_id":"","bearer_token":""}`))
	blank.Header.Set("X-Lifelog-Token", "test-secret")
	rejected := httptest.NewRecorder()
	handler.ServeHTTP(rejected, blank)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("blank person = %d", rejected.Code)
	}

	run := httptest.NewRequest(http.MethodPost, "/api/run", nil)
	run.Header.Set("X-Lifelog-Token", "test-secret")
	t.Setenv("MACOS_INGEST_BEARER_TOKEN", "secret")
	ran := httptest.NewRecorder()
	handler.ServeHTTP(ran, run)
	if ran.Code != http.StatusOK || !strings.Contains(ran.Body.String(), `"ok":false`) {
		t.Fatalf("run = %d %s", ran.Code, ran.Body.String())
	}
	if !strings.Contains(ran.Body.String(), "電源") || !strings.Contains(ran.Body.String(), "スクリーンタイム") {
		t.Fatalf("labels missing: %s", ran.Body.String())
	}
}
