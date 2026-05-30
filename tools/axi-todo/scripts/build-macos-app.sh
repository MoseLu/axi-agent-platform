#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${1:-debug}"

cd "$ROOT_DIR"

pnpm run frontend:build

BIN_DIR="$(swift build -c "$CONFIGURATION" --product AxiTodoDesktop --show-bin-path)"
swift build -c "$CONFIGURATION" --product AxiTodoDesktop

APP_DIR="$ROOT_DIR/dist/Axi Todo.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BIN_DIR/AxiTodoDesktop" "$MACOS_DIR/AxiTodoDesktop"
cp "$ROOT_DIR/resources/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$ROOT_DIR/resources/macos/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
cp -R "$ROOT_DIR/dist-web" "$RESOURCES_DIR/web"
chmod +x "$MACOS_DIR/AxiTodoDesktop"

printf '%s\n' "$APP_DIR"
