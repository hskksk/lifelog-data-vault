#!/bin/sh
# Terminal helper. Launchd runs deploy/macos/lifelog-macos-collect instead:
# a shell script's shebang is /bin/sh, so Full Disk Access would cover the shell.
# tsx only applies collectors/macos/tsconfig.json when that directory is the cwd.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export PATH="${HOME}/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "macos-collect: node not found" >&2
  exit 1
fi

TSX=$(cd "$ROOT" && node -p "require.resolve('tsx/cli')")
cd "$ROOT/collectors/macos"
exec node "$TSX" src/cli.ts "${1:-run}"
