package collect

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPowerWindowAndEmptyEnvelope(t *testing.T) {
	log := strings.Join([]string{
		"2026-11-08 01:00:00 +0000 Sleep                 old",
		"2026-11-08 06:30:00 +0000 Wake                  recent",
	}, "\n")
	now := time.Date(2026, 11, 8, 8, 0, 0, 0, time.UTC)
	events := powerEventsInWindow(log, "2026-11-08T07:00:00.000Z", now)
	if len(events) != 1 || events[0].Kind != "Wake" || events[0].Message != "recent" {
		t.Fatalf("events = %#v", events)
	}
	if events[0].OccurredAt != "2026-11-08T06:30:00+00:00" {
		t.Fatalf("occurred = %s", events[0].OccurredAt)
	}
	identity := Identity{HardwareUUID: "MACHINE", OSUserID: 501, ComputerName: "Studio", Model: "Mac14,13", OSVersion: "15.1", Timezone: "Asia/Tokyo", PersonID: "hskksk"}
	if got := powerEnvelopes(identity, nil, "2026-11-08T08:00:00.000Z"); len(got) != 0 {
		t.Fatalf("empty envelopes = %#v", got)
	}
	envelopes := powerEnvelopes(identity, events, "2026-11-08T08:00:00.000Z")
	if len(envelopes) != 1 || envelopes[0].ExportedAt != "2026-11-08T08:00:00+00:00" {
		t.Fatalf("envelope = %#v", envelopes)
	}
	body, err := marshalJSON(envelopes[0])
	if err != nil || !strings.Contains(string(body), `"person_id":"hskksk"`) {
		t.Fatalf("body = %s %v", body, err)
	}
}

func TestScreenTimeQueryShape(t *testing.T) {
	without, err := screenTimeQuery(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(without, "ZDEVICEID") || strings.Contains(without, "ZSTARTDATE >=") {
		t.Fatalf("query = %s", without)
	}
	bound := 100
	with, err := screenTimeQuery(&bound, "ZDEVICEID")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(with, "s.ZDEVICEID") || !strings.Contains(with, "ZSTARTDATE >= 100") {
		t.Fatalf("query = %s", with)
	}
	if _, err := screenTimeQuery(nil, "ZOTHER"); err == nil {
		t.Fatal("expected unsupported column")
	}
}

func TestChunkEvents(t *testing.T) {
	events := []PowerEvent{{Kind: "Sleep"}, {Kind: "Wake"}, {Kind: "Start"}}
	chunks := chunkEvents(events, func(chunk []PowerEvent) any {
		return chunk
	})
	if len(chunks) != 1 || len(chunks[0]) != 3 {
		t.Fatalf("chunks = %#v", chunks)
	}
	previous := maxEvents
	maxEvents = 2
	t.Cleanup(func() { maxEvents = previous })
	chunks = chunkEvents(events, func(chunk []PowerEvent) any { return chunk })
	if len(chunks) != 2 || len(chunks[0]) != 2 || len(chunks[1]) != 1 {
		t.Fatalf("chunks = %#v", chunks)
	}
}

func TestConfigAndState(t *testing.T) {
	dir := t.TempDir()
	path, created, err := writeConfigTemplate(dir, "")
	if err != nil || !created {
		t.Fatal(err, created)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "macos-ingest") {
		t.Fatalf("config = %s", body)
	}
	if _, created, err := writeConfigTemplate(dir, "https://example.test/macos-ingest"); err != nil || created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	kept, err := os.ReadFile(path)
	if err != nil || string(kept) != string(body) {
		t.Fatalf("rewrote config: %s", kept)
	}
	if err := writeState(dir, State{PowerCoveredUntil: "2026-11-08T08:00:00.000Z"}); err != nil {
		t.Fatal(err)
	}
	if got := readState(dir).PowerCoveredUntil; got != "2026-11-08T08:00:00.000Z" {
		t.Fatalf("state = %s", got)
	}
	start := windowStart("2026-11-08T08:00:00.000Z", 120*time.Minute)
	if start == nil || start.UTC().Format(time.RFC3339) != "2026-11-08T06:00:00Z" {
		t.Fatalf("window = %v", start)
	}
}

func TestExtractScreenTimeFromSnapshot(t *testing.T) {
	if _, err := exec.LookPath("sqlite3"); err != nil {
		t.Skip("sqlite3 is not installed")
	}
	dir := t.TempDir()
	db := filepath.Join(dir, "knowledgeC.db")
	sql := `create table ZOBJECT (
		ZSTREAMNAME text, ZVALUESTRING text, ZSTARTDATE real, ZENDDATE real, ZSOURCE integer
	);
	create table ZSOURCE (Z_PK integer primary key, ZDEVICEID text);
	insert into ZSOURCE (Z_PK, ZDEVICEID) values (1, 'mac');
	insert into ZOBJECT (ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE, ZSOURCE)
	values ('/app/usage', 'com.example.App', 700000000, 700000060, 1);`
	if err := exec.Command("sqlite3", db, sql).Run(); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	events, counts, err := extractScreenTime(db, "", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].BundleID != "com.example.App" || events[0].Source != "mac" {
		t.Fatalf("events = %#v", events)
	}
	if counts["/app/usage"] != 1 {
		t.Fatalf("counts = %#v", counts)
	}
}

func TestPostRequiresAccepted(t *testing.T) {
	var sawAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	if err := postJSON(server.URL, "secret", map[string]string{"ok": "yes"}); err != nil {
		t.Fatal(err)
	}
	if sawAuth != "Bearer secret" {
		t.Fatalf("auth = %s", sawAuth)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer bad.Close()
	if err := postJSON(bad.URL, "secret", map[string]string{"ok": "yes"}); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}

func TestSourcesFor(t *testing.T) {
	got, err := sourcesFor(nil)
	if err != nil || len(got) != 2 {
		t.Fatalf("run = %v %v", got, err)
	}
	got, err = sourcesFor([]string{"power"})
	if err != nil || len(got) != 1 || got[0] != "power" {
		t.Fatalf("power = %v %v", got, err)
	}
	if _, err := sourcesFor([]string{"nope"}); err == nil {
		t.Fatal("expected usage error")
	}
}

func TestParsePlatformUUID(t *testing.T) {
	text := `"IOPlatformUUID" = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"`
	if parseIOPlatformUUID(text) != "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE" {
		t.Fatalf("uuid = %s", parseIOPlatformUUID(text))
	}
}
