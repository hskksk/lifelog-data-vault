package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyKnowledgeDBCopiesRegularFilesOnly(t *testing.T) {
	home := t.TempDir()
	db := filepath.Join(home, "Library", "Application Support", "Knowledge", "knowledgeC.db")
	if err := os.MkdirAll(filepath.Dir(db), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(db, []byte("db-body"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(db+"-wal", []byte("wal-body"), 0o600); err != nil {
		t.Fatal(err)
	}

	snapshot, dir, status, detail := copyKnowledgeDB(home, t.TempDir())
	if status != "" || detail != "" {
		t.Fatalf("status=%q detail=%q", status, detail)
	}
	got, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "db-body" {
		t.Fatalf("db = %q", got)
	}
	wal, err := os.ReadFile(snapshot + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	if string(wal) != "wal-body" {
		t.Fatalf("wal = %q", wal)
	}
	if _, err := os.Stat(snapshot + "-shm"); !os.IsNotExist(err) {
		t.Fatalf("shm err = %v", err)
	}
	if !strings.HasPrefix(filepath.Base(dir), "lifelog-knowledge-") {
		t.Fatalf("dir = %q", dir)
	}
	os.RemoveAll(dir)
}

func TestCopyKnowledgeDBRejectsSymlink(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "Library", "Application Support", "Knowledge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("do-not-copy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "knowledgeC.db")); err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	snapshot, _, status, _ := copyKnowledgeDB(home, tmp)
	if snapshot != "" {
		t.Fatalf("copied symlink to %s", snapshot)
	}
	if status != "sqlite" {
		t.Fatalf("status = %q", status)
	}
	entries, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("left temp entries: %v", entries)
	}
}

func TestCopyKnowledgeDBMissingAndUnreadable(t *testing.T) {
	_, _, status, detail := copyKnowledgeDB("", t.TempDir())
	if status != "sqlite" || detail != "HOME is unset" {
		t.Fatalf("empty home: %s %s", status, detail)
	}

	home := t.TempDir()
	_, _, status, detail = copyKnowledgeDB(home, t.TempDir())
	if status != "sqlite" || detail != "knowledgeC.db is missing" {
		t.Fatalf("missing: %s %s", status, detail)
	}

	blocked := t.TempDir()
	dbDir := filepath.Join(blocked, "Library", "Application Support", "Knowledge")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dbDir, "knowledgeC.db"), []byte("hidden"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dbDir, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dbDir, 0o755) })
	tmp := t.TempDir()
	_, _, status, detail = copyKnowledgeDB(blocked, tmp)
	if status != "full_disk_access" || detail != "knowledgeC.db is not readable" {
		t.Fatalf("unreadable: %s %s", status, detail)
	}
	entries, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("left temp entries: %v", entries)
	}
}

func TestCommandNeedsScreenTime(t *testing.T) {
	if !commandNeedsScreenTime(nil) || !commandNeedsScreenTime([]string{"run"}) || !commandNeedsScreenTime([]string{"screentime"}) {
		t.Fatal("run and screentime copy the database")
	}
	if commandNeedsScreenTime([]string{"power"}) || commandNeedsScreenTime([]string{"init-config", "https://example.test"}) {
		t.Fatal("power and init-config do not copy the database")
	}
}

func TestFindRepoRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "collectors", "macos", "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "collectors", "macos", "src", "cli.ts"), []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pnpm-workspace.yaml"), []byte("packages:\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(root, "deploy", "macos", "lifelog-macos-collect")
	got, err := findRepoRoot(exe)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("root = %s, want %s", got, root)
	}
}
