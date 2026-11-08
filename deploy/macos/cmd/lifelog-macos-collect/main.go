// Launchd runs this binary. macOS attaches Full Disk Access to the program
// launchd executes. A shell script still runs as /bin/sh, so granting access
// to the script grants it to the shell.
//
// This process copies knowledgeC.db, then replaces itself with node running
// the existing collector. Node reads the copy and does not need Full Disk Access.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "lifelog-macos-collect: %s\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	snapshotDir := ""
	defer func() {
		if snapshotDir != "" {
			os.RemoveAll(snapshotDir)
		}
	}()
	if commandNeedsScreenTime(args) {
		home, _ := os.UserHomeDir()
		if home == "" {
			home = os.Getenv("HOME")
		}
		snapshot, dir, status, detail := copyKnowledgeDB(home, "")
		if status == "" {
			snapshotDir = dir
		}
		applyCopyEnv(snapshot, dir, status, detail)
		if status == "full_disk_access" {
			fmt.Fprintln(os.Stderr, "lifelog-macos-collect: grant Full Disk Access to this binary, not to /bin/sh")
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root, err := findRepoRoot(exe)
	if err != nil {
		return err
	}
	node, tsx, err := resolveNode(root)
	if err != nil {
		return err
	}
	collector := filepath.Join(root, "collectors", "macos")
	if err := os.Chdir(collector); err != nil {
		return err
	}
	argv := []string{node, tsx, "src/cli.ts"}
	if len(args) == 0 {
		argv = append(argv, "run")
	} else {
		argv = append(argv, args...)
	}
	return syscall.Exec(node, argv, os.Environ())
}

func findRepoRoot(exe string) (string, error) {
	dir := filepath.Dir(exe)
	for i := 0; i < 6; i++ {
		cli := filepath.Join(dir, "collectors", "macos", "src", "cli.ts")
		workspace := filepath.Join(dir, "pnpm-workspace.yaml")
		if info, err := os.Stat(cli); err == nil && !info.IsDir() {
			if info, err := os.Stat(workspace); err == nil && !info.IsDir() {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("could not find the repository root from %s", exe)
}

func resolveNode(root string) (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.Getenv("HOME")
	}
	prefix := []string{
		filepath.Join(home, ".local", "share", "mise", "shims"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
	}
	os.Setenv("PATH", strings.Join(prefix, string(os.PathListSeparator))+string(os.PathListSeparator)+os.Getenv("PATH"))
	node, err := exec.LookPath("node")
	if err != nil {
		return "", "", fmt.Errorf("node not found")
	}
	cmd := exec.Command(node, "-p", "require.resolve('tsx/cli')")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("tsx not found")
	}
	tsx := strings.TrimSpace(string(out))
	if tsx == "" {
		return "", "", fmt.Errorf("tsx not found")
	}
	return node, tsx, nil
}
