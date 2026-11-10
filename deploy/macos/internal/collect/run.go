package collect

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

func Main(args []string) int {
	if len(args) == 0 || args[0] == "open" || args[0] == "ui" {
		if err := serveSettings(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	if len(args) > 0 && args[0] == "init-config" {
		url := ""
		if len(args) > 1 {
			url = args[1]
		}
		path, created, err := writeConfigTemplate(stateDirFromEnv(), url)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if created {
			fmt.Printf("wrote %s\n", path)
		} else {
			fmt.Printf("left existing %s\n", path)
		}
		return 0
	}
	sources, err := sourcesFor(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, "usage: lifelog-macos-collect [open] | init-config [ingest-url] | run | power | screentime")
		return 2
	}
	failed := 0
	for _, source := range sources {
		if _, err := runSource(source, time.Now()); err != nil {
			fmt.Fprintf(os.Stderr, "%s %s\n", source, err)
			failed++
		}
	}
	if failed > 0 {
		return 1
	}
	return 0
}

func sourcesFor(args []string) ([]string, error) {
	cmd := "run"
	if len(args) > 0 && args[0] != "" {
		cmd = args[0]
	}
	switch cmd {
	case "run":
		return []string{"power", "screentime"}, nil
	case "power", "screentime":
		return []string{cmd}, nil
	default:
		return nil, fmt.Errorf("unknown command")
	}
}

func runSource(source string, now time.Time) (string, error) {
	url, token, personID, dir, err := loadConfig()
	if err != nil {
		return "", err
	}
	identity, err := readIdentity()
	if err != nil {
		return "", err
	}
	identity.PersonID = personID
	switch source {
	case "power":
		return sendPower(identity, dir, url, token, now)
	case "screentime":
		return sendScreenTime(identity, dir, url, token, now)
	default:
		return "", fmt.Errorf("unknown source")
	}
}

func sendPower(identity Identity, dir, url, token string, now time.Time) (string, error) {
	state := readState(dir)
	stamp := exportedAt(now)
	logText, err := commandOutput("pmset", "-g", "log")
	if err != nil {
		return "", fmt.Errorf("pmset failed")
	}
	events := powerEventsInWindow(logText, state.PowerCoveredUntil, now)
	for _, envelope := range powerEnvelopes(identity, events, stamp) {
		if err := postJSON(url, token, envelope); err != nil {
			return "", err
		}
	}
	state.PowerCoveredUntil = stamp
	if err := writeState(dir, state); err != nil {
		return "", err
	}
	if len(events) == 0 {
		return "送信するイベントはありません", nil
	}
	return fmt.Sprintf("%d件を送信しました", len(events)), nil
}

func sendScreenTime(identity Identity, dir, url, token string, now time.Time) (string, error) {
	state := readState(dir)
	stamp := exportedAt(now)
	src, err := knowledgeSource()
	if err != nil {
		return "", err
	}
	events, counts, err := extractScreenTime(src, state.ScreenCoveredUntil, now)
	if err != nil {
		if fail, ok := err.(*extractFailure); ok && fail.Reason == "full_disk_access" {
			fmt.Fprintln(os.Stderr, "lifelog-macos-collect: grant Full Disk Access to Lifelog Collect.app")
		}
		return "", err
	}
	for _, envelope := range screenEnvelopes(identity, events, counts, stamp) {
		if err := postJSON(url, token, envelope); err != nil {
			return "", err
		}
	}
	state.ScreenCoveredUntil = stamp
	if err := writeState(dir, state); err != nil {
		return "", err
	}
	if len(events) == 0 {
		return "送信するイベントはありません", nil
	}
	return fmt.Sprintf("%d件を送信しました", len(events)), nil
}

func postJSON(url, token string, body any) error {
	payload, err := marshalJSON(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("macos ingest responded %d", resp.StatusCode)
	}
	return nil
}

func readIdentity() (Identity, error) {
	ioreg, err := commandOutput("ioreg", "-rd1", "-c", "IOPlatformExpertDevice")
	if err != nil {
		return Identity{}, fmt.Errorf("IOPlatformUUID was not found")
	}
	hardware := parseIOPlatformUUID(ioreg)
	if hardware == "" {
		return Identity{}, fmt.Errorf("IOPlatformUUID was not found")
	}
	name, err := commandOutput("scutil", "--get", "ComputerName")
	name = strings.TrimSpace(name)
	if err != nil || name == "" {
		return Identity{}, fmt.Errorf("ComputerName is empty")
	}
	model, err := commandOutput("sysctl", "-n", "hw.model")
	if err != nil {
		return Identity{}, err
	}
	version, err := commandOutput("sw_vers", "-productVersion")
	if err != nil {
		return Identity{}, err
	}
	uid := os.Getuid()
	if uid < 0 {
		uid = 0
	}
	return Identity{
		HardwareUUID: hardware,
		OSUserID:     uid,
		ComputerName: name,
		Model:        strings.TrimSpace(model),
		OSVersion:    strings.TrimSpace(version),
		Timezone:     systemTimezone(),
	}, nil
}

func commandOutput(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).Output()
	return string(out), err
}
