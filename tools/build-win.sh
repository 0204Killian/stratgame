#!/usr/bin/env bash
# Builds a portable Windows x64 folder + zip without npm, by dropping the game into the official
# Electron runtime. On Windows with Node installed you can instead run: npm install && npm run dist
set -euo pipefail
ELECTRON_VERSION=33.4.11
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
CACHE="$ROOT/.cache"; DIST="$ROOT/dist"; NAME="WheelOfNations-$VERSION-win-x64"; OUT="$DIST/$NAME"
mkdir -p "$CACHE" "$DIST"
ZIP="$CACHE/electron-v$ELECTRON_VERSION-win32-x64.zip"
[ -f "$ZIP" ] || curl -fL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip"
rm -rf "$OUT" && mkdir -p "$OUT"
unzip -q "$ZIP" -d "$OUT"
mv "$OUT/electron.exe" "$OUT/Wheel of Nations.exe"
rm -f "$OUT/resources/default_app.asar"
APP="$OUT/resources/app"; mkdir -p "$APP"
cp "$ROOT/main.js" "$ROOT/preload.js" "$APP/"
cp -r "$ROOT/src" "$APP/src"
node -e "const p=require('$ROOT/package.json');require('fs').writeFileSync('$APP/package.json',JSON.stringify({name:p.name,productName:p.productName,version:p.version,main:p.main},null,1))"
cat > "$OUT/README.txt" <<EOF
Wheel of Nations $VERSION
Double-click "Wheel of Nations.exe" to play. Keep this whole folder together.
Saves and settings live in %APPDATA%\\Wheel of Nations\\
If Windows SmartScreen warns you, click "More info" then "Run anyway" (the app is not code-signed).
EOF
(cd "$DIST" && rm -f "$NAME.zip" && zip -qr -9 "$NAME.zip" "$NAME")
echo "Built $DIST/$NAME.zip"
