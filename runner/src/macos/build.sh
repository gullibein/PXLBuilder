#!/bin/bash
# Builds the macOS runner as an app bundle (both Apple silicon and Intel), ad-hoc signed, with a placeholder game:
# the editor puts the real game in and re-seals the signature for it (src/core/export/desktop.ts).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$1"
work="$(mktemp -d)"
swiftc -O -target arm64-apple-macos11 "$here/main.swift" -o "$work/arm64"
swiftc -O -target x86_64-apple-macos11 "$here/main.swift" -o "$work/x86_64"
app="$out/Game.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
lipo -create "$work/arm64" "$work/x86_64" -output "$app/Contents/MacOS/Game"
cp "$here/Info.plist" "$app/Contents/Info.plist"
printf 'PXL placeholder game\n' > "$app/Contents/Resources/game.html"
codesign --force --sign - --identifier com.pxlbuilder.game "$app"
codesign --verify --strict --verbose=2 "$app"
codesign -d --verbose=4 "$app" 2>&1 | grep -E "Hash type|CandidateCDHash|Format|Identifier"
ls -la "$app/Contents/MacOS"
