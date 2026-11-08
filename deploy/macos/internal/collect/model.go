package collect

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/hskksk/lifelog-data-vault/deploy/macos/internal/knowledge"
)

const (
	screenTimeStream = "/app/usage"
	cocoaEpoch       = 978307200
	powerOverlap     = 120 * time.Minute
	screenOverlap    = 24 * time.Hour
	futureSkew       = 5 * time.Minute
	placeholderURL   = "https://<project-ref>.supabase.co/functions/v1/macos-ingest"
)

var (
	maxEvents    = 1000
	maxBodyBytes = 1_500_000
)

var powerKinds = map[string]struct{}{
	"Sleep": {}, "Wake": {}, "DarkWake": {}, "Start": {}, "Shutdown": {}, "Restart": {},
}

var pmsetLine = regexp.MustCompile(`^([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]([0-9]{2}:[0-9]{2}:[0-9]{2}) ([+-][0-9]{4}) (\S+)\s*(.*)$`)
var offsetStamp = regexp.MustCompile(`^([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$`)
var platformUUID = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`)

type Identity struct {
	HardwareUUID string `json:"hardware_uuid"`
	OSUserID     int    `json:"os_user_id"`
	ComputerName string `json:"computer_name"`
	Model        string `json:"model"`
	OSVersion    string `json:"os_version"`
	Timezone     string `json:"timezone"`
}

type PowerEvent struct {
	OccurredAt string `json:"occurred_at"`
	Kind       string `json:"kind"`
	Message    string `json:"message"`
	RawLine    string `json:"raw_line"`
}

type ScreenEvent struct {
	Stream    string  `json:"stream"`
	BundleID  string  `json:"bundle_id"`
	StartedAt string  `json:"started_at"`
	EndedAt   *string `json:"ended_at"`
	Duration  float64 `json:"duration_seconds"`
	Source    string  `json:"source_device_ref"`
}

type powerEnvelope struct {
	SchemaVersion int          `json:"schema_version"`
	RecordSource  string       `json:"record_source"`
	Entity        string       `json:"entity"`
	ExportedAt    string       `json:"exported_at"`
	Collector     Identity     `json:"collector"`
	Events        []PowerEvent `json:"events"`
}

type screenEnvelope struct {
	SchemaVersion int           `json:"schema_version"`
	RecordSource  string        `json:"record_source"`
	Entity        string        `json:"entity"`
	ExportedAt    string        `json:"exported_at"`
	Collector     Identity      `json:"collector"`
	Extract       screenExtract `json:"extract"`
	Events        []ScreenEvent `json:"events"`
}

type screenExtract struct {
	StreamCounts map[string]int `json:"stream_counts"`
}

type State struct {
	PowerCoveredUntil  string `json:"power_covered_until,omitempty"`
	ScreenCoveredUntil string `json:"screentime_covered_until,omitempty"`
}

type configFile struct {
	IngestURL string `json:"ingest_url"`
}

func canonicalOffsetTimestamp(value string) string {
	match := offsetStamp.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return ""
	}
	offset := match[3]
	if offset == "Z" {
		offset = "+00:00"
	} else if len(offset) == 5 && (offset[0] == '+' || offset[0] == '-') {
		offset = offset[:3] + ":" + offset[3:]
	}
	iso := match[1] + "T" + match[2] + offset
	if _, ok := parseTime(iso); !ok {
		return ""
	}
	return iso
}

func parseTime(value string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func parsePmsetLog(text string) []PowerEvent {
	var events []PowerEvent
	for _, rawLine := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(rawLine) == "" {
			continue
		}
		match := pmsetLine.FindStringSubmatch(rawLine)
		if match == nil {
			continue
		}
		if _, ok := powerKinds[match[4]]; !ok {
			continue
		}
		occurred := canonicalOffsetTimestamp(match[1] + "T" + match[2] + match[3])
		if occurred == "" {
			continue
		}
		events = append(events, PowerEvent{
			OccurredAt: occurred,
			Kind:       match[4],
			Message:    strings.TrimSpace(match[5]),
			RawLine:    rawLine,
		})
	}
	return events
}

func windowStart(coveredUntil string, overlap time.Duration) *time.Time {
	if coveredUntil == "" {
		return nil
	}
	parsed, ok := parseTime(coveredUntil)
	if !ok {
		return nil
	}
	start := parsed.Add(-overlap)
	return &start
}

func powerEventsInWindow(logText, coveredUntil string, now time.Time) []PowerEvent {
	start := windowStart(coveredUntil, powerOverlap)
	var events []PowerEvent
	for _, event := range parsePmsetLog(logText) {
		occurred, ok := parseTime(event.OccurredAt)
		if !ok {
			continue
		}
		if start != nil && occurred.Before(*start) {
			continue
		}
		if occurred.After(now.Add(futureSkew)) {
			continue
		}
		events = append(events, event)
	}
	return events
}

func exportedAt(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04:05.000Z")
}

func powerEnvelopes(identity Identity, events []PowerEvent, rawExported string) []powerEnvelope {
	canonical := canonicalOffsetTimestamp(rawExported)
	if canonical == "" {
		canonical = rawExported
	}
	chunks := chunkEvents(events, func(chunk []PowerEvent) any {
		return powerEnvelope{
			SchemaVersion: 1,
			RecordSource:  "macos_power",
			Entity:        "power_event",
			ExportedAt:    canonical,
			Collector:     identity,
			Events:        chunk,
		}
	})
	out := make([]powerEnvelope, 0, len(chunks))
	for _, chunk := range chunks {
		out = append(out, powerEnvelope{
			SchemaVersion: 1,
			RecordSource:  "macos_power",
			Entity:        "power_event",
			ExportedAt:    canonical,
			Collector:     identity,
			Events:        chunk,
		})
	}
	return out
}

func chunkEvents[T any](events []T, wrap func([]T) any) [][]T {
	var chunks [][]T
	var current []T
	for _, event := range events {
		next := append(append([]T{}, current...), event)
		tooMany := len(next) > maxEvents
		body, err := marshalJSON(wrap(next))
		tooBig := err == nil && len(body) > maxBodyBytes
		if len(current) > 0 && (tooMany || tooBig) {
			chunks = append(chunks, current)
			current = []T{event}
			continue
		}
		current = next
	}
	if len(current) > 0 {
		chunks = append(chunks, current)
	}
	return chunks
}

func marshalJSON(value any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		return nil, err
	}
	body := buf.Bytes()
	if len(body) > 0 && body[len(body)-1] == '\n' {
		body = body[:len(body)-1]
	}
	return body, nil
}

func screenTimeQuery(cocoaLower *int, deviceColumn string) (string, error) {
	if deviceColumn != "" && deviceColumn != "ZDEVICEID" {
		return "", fmt.Errorf("unsupported screen time device column")
	}
	deviceExpr := "''"
	if deviceColumn != "" {
		deviceExpr = "coalesce(s." + deviceColumn + ", '')"
	}
	lower := ""
	if cocoaLower != nil {
		lower = fmt.Sprintf("and o.ZSTARTDATE >= %d", *cocoaLower)
	}
	return fmt.Sprintf(`
    select
      o.ZSTREAMNAME as stream,
      o.ZVALUESTRING as bundle_id,
      strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ', o.ZSTARTDATE + %d, 'unixepoch') as started_at,
      strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ', o.ZENDDATE + %d, 'unixepoch') as ended_at,
      (o.ZENDDATE - o.ZSTARTDATE) as duration_seconds,
      %s as source_device_ref
    from ZOBJECT o
    left join ZSOURCE s on o.ZSOURCE = s.Z_PK
    where o.ZSTREAMNAME = '%s'
      %s
  `, cocoaEpoch, cocoaEpoch, deviceExpr, screenTimeStream, lower), nil
}

func normalizeScreenEvent(row map[string]any) *ScreenEvent {
	stream, _ := row["stream"].(string)
	if stream != screenTimeStream {
		return nil
	}
	bundle, _ := row["bundle_id"].(string)
	if bundle == "" {
		return nil
	}
	startedRaw, _ := row["started_at"].(string)
	started := canonicalOffsetTimestamp(startedRaw)
	if started == "" {
		return nil
	}
	var ended *string
	switch value := row["ended_at"].(type) {
	case string:
		if value != "" {
			canonical := canonicalOffsetTimestamp(value)
			if canonical == "" {
				return nil
			}
			ended = &canonical
		}
	case nil:
	default:
		return nil
	}
	duration, ok := asFloat(row["duration_seconds"])
	if !ok || duration <= 0 {
		return nil
	}
	source := ""
	if row["source_device_ref"] != nil {
		source = fmt.Sprint(row["source_device_ref"])
	}
	return &ScreenEvent{
		Stream:    screenTimeStream,
		BundleID:  bundle,
		StartedAt: started,
		EndedAt:   ended,
		Duration:  duration,
		Source:    source,
	}
}

func asFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func parseIOPlatformUUID(text string) string {
	match := platformUUID.FindStringSubmatch(text)
	if match == nil {
		return ""
	}
	return match[1]
}

func systemTimezone() string {
	target, err := filepath.EvalSymlinks("/etc/localtime")
	if err == nil {
		const marker = "zoneinfo/"
		if i := strings.LastIndex(target, marker); i >= 0 {
			name := target[i+len(marker):]
			if name != "" && name != "localtime" {
				return name
			}
		}
	}
	if loc := time.Local.String(); strings.Contains(loc, "/") {
		return loc
	}
	return "UTC"
}

func defaultStateDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.Getenv("HOME")
	}
	return filepath.Join(home, "Library", "Application Support", "lifelog")
}

func stateDirFromEnv() string {
	if dir := os.Getenv("LIFELOG_STATE_DIR"); dir != "" {
		return dir
	}
	return defaultStateDir()
}

func readState(dir string) State {
	body, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		return State{}
	}
	var state State
	if json.Unmarshal(body, &state) != nil {
		return State{}
	}
	return state
}

func writeState(dir string, state State) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	body, err := marshalIndent(state)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "state.json"), body, 0o600)
}

func marshalIndent(value any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(value); err != nil {
		return nil, err
	}
	body := buf.Bytes()
	if len(body) > 0 && body[len(body)-1] == '\n' {
		body = body[:len(body)-1]
	}
	return body, nil
}

func writeConfigTemplate(dir, ingestURL string) (string, bool, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", false, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", false, err
	}
	path := filepath.Join(dir, "config.json")
	if _, err := os.Stat(path); err == nil {
		return path, false, nil
	}
	if ingestURL == "" {
		ingestURL = placeholderURL
	}
	body, err := marshalIndent(configFile{IngestURL: ingestURL})
	if err != nil {
		return "", false, err
	}
	if err := os.WriteFile(path, append(body, '\n'), 0o600); err != nil {
		return "", false, err
	}
	return path, true, nil
}

func saveIngestURL(dir, ingestURL string) error {
	ingestURL = strings.TrimSpace(ingestURL)
	if ingestURL == "" {
		return fmt.Errorf("ingest_url is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	body, err := marshalIndent(configFile{IngestURL: ingestURL})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.json"), append(body, '\n'), 0o600)
}

func loadConfig() (url, token, dir string, err error) {
	dir = stateDirFromEnv()
	url = os.Getenv("MACOS_INGEST_URL")
	if url == "" {
		url = readIngestURL(filepath.Join(dir, "config.json"))
	}
	if url == "" {
		return "", "", dir, fmt.Errorf("Set MACOS_INGEST_URL, or write ingest_url with: lifelog-macos-collect init-config")
	}
	token = os.Getenv("MACOS_INGEST_BEARER_TOKEN")
	if token == "" {
		token = readKeychainToken()
	}
	if token == "" {
		return "", "", dir, fmt.Errorf("Set MACOS_INGEST_BEARER_TOKEN or store it in the keychain service lifelog-macos-ingest")
	}
	return url, token, dir, nil
}

func readIngestURL(path string) string {
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var parsed configFile
	if json.Unmarshal(body, &parsed) != nil {
		return ""
	}
	return parsed.IngestURL
}

func readKeychainToken() string {
	out, err := exec.Command("security", "find-generic-password", "-s", "lifelog-macos-ingest", "-w").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func knowledgeSource() (string, error) {
	if path := os.Getenv("KNOWLEDGE_C_DB"); path != "" {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.Getenv("HOME")
	}
	if home == "" {
		return "", fmt.Errorf("HOME is unset")
	}
	return filepath.Join(home, "Library", "Application Support", "Knowledge", "knowledgeC.db"), nil
}

type extractFailure struct {
	Reason string
	Detail string
}

func (e *extractFailure) Error() string {
	return e.Reason + ": " + e.Detail
}

func extractScreenTime(src, coveredUntil string, now time.Time) ([]ScreenEvent, map[string]int, error) {
	snapshot, dir, status, detail := knowledge.CopyDatabase(src, "")
	if status != "" {
		return nil, nil, &extractFailure{Reason: status, Detail: detail}
	}
	defer os.RemoveAll(dir)

	columns, err := columnNames(snapshot, "ZOBJECT")
	if err != nil {
		return nil, nil, &extractFailure{Reason: "schema", Detail: "could not read ZOBJECT columns"}
	}
	required := []string{"ZSTREAMNAME", "ZVALUESTRING", "ZSTARTDATE", "ZENDDATE", "ZSOURCE"}
	var missing []string
	have := map[string]struct{}{}
	for _, name := range columns {
		have[name] = struct{}{}
	}
	for _, name := range required {
		if _, ok := have[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return nil, nil, &extractFailure{Reason: "schema", Detail: "missing columns: " + strings.Join(missing, ", ")}
	}
	deviceColumn := ""
	if sourceColumns, err := columnNames(snapshot, "ZSOURCE"); err == nil {
		for _, name := range sourceColumns {
			if name == "ZDEVICEID" {
				deviceColumn = "ZDEVICEID"
			}
		}
	}
	var cocoa *int
	if start := windowStart(coveredUntil, screenOverlap); start != nil {
		value := int(start.Unix()) - cocoaEpoch
		cocoa = &value
	}
	query, err := screenTimeQuery(cocoa, deviceColumn)
	if err != nil {
		return nil, nil, err
	}
	rows, err := sqliteRows(snapshot, query)
	if err != nil {
		return nil, nil, &extractFailure{Reason: "sqlite", Detail: "screen time query failed"}
	}
	countRows, err := sqliteRows(snapshot, "select ZSTREAMNAME as stream, count(*) as n from ZOBJECT group by ZSTREAMNAME")
	if err != nil {
		return nil, nil, &extractFailure{Reason: "sqlite", Detail: "screen time query failed"}
	}
	counts := map[string]int{}
	for _, row := range countRows {
		stream, _ := row["stream"].(string)
		if stream == "" {
			continue
		}
		if n, ok := asFloat(row["n"]); ok {
			counts[stream] = int(n)
		}
	}
	var events []ScreenEvent
	for _, row := range rows {
		event := normalizeScreenEvent(row)
		if event == nil {
			continue
		}
		started, ok := parseTime(event.StartedAt)
		if ok && !started.After(now) {
			events = append(events, *event)
		}
	}
	return events, counts, nil
}

func columnNames(db, table string) ([]string, error) {
	if table != "ZOBJECT" && table != "ZSOURCE" {
		return nil, fmt.Errorf("unsupported table")
	}
	rows, err := sqliteRows(db, "select name from pragma_table_info('"+table+"')")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, row := range rows {
		name, _ := row["name"].(string)
		if name != "" {
			names = append(names, name)
		}
	}
	return names, nil
}

func sqliteRows(db, sql string) ([]map[string]any, error) {
	bin, err := exec.LookPath("sqlite3")
	if err != nil {
		if _, statErr := os.Stat("/usr/bin/sqlite3"); statErr == nil {
			bin = "/usr/bin/sqlite3"
		} else {
			return nil, err
		}
	}
	cmd := exec.Command(bin, "-json", db, sql)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(out)) == "" {
		return []map[string]any{}, nil
	}
	var rows []map[string]any
	if err := json.Unmarshal(out, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func screenEnvelopes(identity Identity, events []ScreenEvent, counts map[string]int, rawExported string) []screenEnvelope {
	canonical := canonicalOffsetTimestamp(rawExported)
	if canonical == "" {
		canonical = rawExported
	}
	if counts == nil {
		counts = map[string]int{}
	}
	chunks := chunkEvents(events, func(chunk []ScreenEvent) any {
		return screenEnvelope{
			SchemaVersion: 1,
			RecordSource:  "macos_screentime",
			Entity:        "usage_interval",
			ExportedAt:    canonical,
			Collector:     identity,
			Extract:       screenExtract{StreamCounts: counts},
			Events:        chunk,
		}
	})
	out := make([]screenEnvelope, 0, len(chunks))
	for _, chunk := range chunks {
		out = append(out, screenEnvelope{
			SchemaVersion: 1,
			RecordSource:  "macos_screentime",
			Entity:        "usage_interval",
			ExportedAt:    canonical,
			Collector:     identity,
			Extract:       screenExtract{StreamCounts: counts},
			Events:        chunk,
		})
	}
	return out
}
