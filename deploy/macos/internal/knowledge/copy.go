package knowledge

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

func CopyKnowledgeDB(home, tmpRoot string) (snapshot, snapshotDir, status, detail string) {
	if home == "" {
		return "", "", "sqlite", "HOME is unset"
	}
	src := filepath.Join(home, "Library", "Application Support", "Knowledge", "knowledgeC.db")
	return CopyDatabase(src, tmpRoot)
}

func CopyDatabase(src, tmpRoot string) (snapshot, snapshotDir, status, detail string) {
	dir, err := os.MkdirTemp(tmpRoot, "lifelog-knowledge-")
	if err != nil {
		return "", "", "sqlite", "could not create a temp directory"
	}
	dest := filepath.Join(dir, "knowledgeC.db")
	if err := copyFileNoFollow(src, dest); err != nil {
		os.RemoveAll(dir)
		status, detail = classifyCopyError(err, true)
		return "", "", status, detail
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		err := copyFileNoFollow(src+suffix, dest+suffix)
		if err == nil || errors.Is(err, os.ErrNotExist) {
			continue
		}
		os.RemoveAll(dir)
		status, detail = classifyCopyError(err, false)
		return "", "", status, detail
	}
	return dest, dir, "", ""
}

func classifyCopyError(err error, primary bool) (status, detail string) {
	if primary && errors.Is(err, os.ErrNotExist) {
		return "sqlite", "knowledgeC.db is missing"
	}
	if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) {
		return "full_disk_access", "knowledgeC.db is not readable"
	}
	return "sqlite", "could not copy knowledgeC.db"
}

func copyFileNoFollow(src, dst string) error {
	in, err := os.OpenFile(src, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file")
	}

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
