#!/usr/bin/env bash
set -euo pipefail

case "$WOSLICER_BUILD_PROFILE" in debug|release) ;; *) exit 1 ;; esac
bundle="src-tauri/target/$RUST_TARGET/$WOSLICER_BUILD_PROFILE/bundle"
version="$(node -p 'require("./package.json").version')"
for file in "$bundle"/deb/*.deb; do
  test "$(dpkg-deb --field "$file" Version)" = "$version"
  dpkg-deb --info "$file"
  dpkg-deb --contents "$file"
done
for file in "$bundle"/appimage/*.AppImage; do
  chmod +x "$file"
  "$file" --appimage-version
done

destination="release/$RELEASE_PLATFORM"
mkdir -p "$destination"
cp "$bundle"/deb/*.deb "$bundle"/appimage/*.AppImage "$destination/"
