#!/bin/sh
# Install ~/Applications/Lifelog Collect.app from this checkout.
# launchd runs that copy. Later edits in the checkout do not affect it.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
APP_NAME="Lifelog Collect.app"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$APP_NAME/Contents/MacOS"
cp "$ROOT/deploy/macos/app/Info.plist" "$STAGE/$APP_NAME/Contents/Info.plist"
(
  cd "$ROOT/deploy/macos"
  go build -o "$STAGE/$APP_NAME/Contents/MacOS/lifelog-macos-collect" ./cmd/lifelog-macos-collect
)

mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
DEST="$HOME/Applications/$APP_NAME"
rm -rf "$DEST"
cp -R "$STAGE/$APP_NAME" "$DEST"
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$DEST"
fi

sed -e "s|REPLACE_WITH_HOME|$HOME|g" \
  "$ROOT/deploy/macos/launchd/dev.lifelog.macos-collect.plist" \
  > "$HOME/Library/LaunchAgents/dev.lifelog.macos-collect.plist"

cat <<EOF
Installed $DEST
config.json and the keychain entry were left in place.

Add this app in System Settings → Privacy & Security → Full Disk Access:
  $DEST
Reinstalling changes the signature, so add the app again after the next install.

Then reload the agent:
  launchctl bootout "gui/$(id -u)/dev.lifelog.macos-collect" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.lifelog.macos-collect.plist"
  launchctl kickstart -k "gui/$(id -u)/dev.lifelog.macos-collect"
EOF
