#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Axi Todo.app"
SOURCE_APP="$ROOT_DIR/dist/$APP_NAME"
DEST_APP="/Applications/$APP_NAME"

"$ROOT_DIR/scripts/build-macos-app.sh"

if [ ! -d "$SOURCE_APP" ]; then
  echo "Missing app bundle: $SOURCE_APP" >&2
  exit 1
fi

rm -rf "$DEST_APP"
ditto "$SOURCE_APP" "$DEST_APP"

printf '%s\n' "$DEST_APP"
