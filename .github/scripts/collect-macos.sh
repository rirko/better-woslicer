#!/usr/bin/env bash
set -euo pipefail

version="$(node -p 'require("./package.json").version')"
case "$WOSLICER_BUILD_PROFILE" in debug|release) ;; *) exit 1 ;; esac
bundle="src-tauri/target/$RUST_TARGET/$WOSLICER_BUILD_PROFILE/bundle"
architecture="$(uname -m)"
for app in "$bundle"/macos/*.app; do
  plist="$app/Contents/Info.plist"
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" = "$version"
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
  test "$(lipo -archs "$app/Contents/MacOS/$executable")" = "$architecture"
done
for image in "$bundle"/dmg/*.dmg; do
  test -s "$image"
  hdiutil verify "$image"
done

destination="release/$RELEASE_PLATFORM"
mkdir -p "$destination"
cp "$bundle"/dmg/*.dmg "$destination/"
