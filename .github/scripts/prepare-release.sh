#!/usr/bin/env bash
set -euo pipefail

name="$(node -p 'require("./package.json").name')"
version="$(node -p 'require("./package.json").version')"
if [[ "$GITHUB_REF_NAME" != "v$version" ]]; then
  echo "Release tag $GITHUB_REF_NAME does not match package version $version" >&2
  exit 1
fi

web_archive="release-assets/$name-$version-web.zip"
portable_archive="release-assets/$name-$version-windows-x64-portable.zip"
for asset in "$web_archive" "$portable_archive"; do
  if [[ ! -s "$asset" ]]; then
    echo "Missing or empty release asset: $asset" >&2
    exit 1
  fi
done
unzip -t "$web_archive"
unzip -t "$portable_archive"

(
  cd release-assets
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 |
    sort -z |
    xargs -0 sha256sum > SHA256SUMS
)

printf 'title=%s %s\n' "$name" "$version" >> "$GITHUB_OUTPUT"

cat > release-notes.md <<EOF
Prerelease of $name $version.

Source commit: $GITHUB_SHA

Web and Windows x64 passed the required build checks.
Windows ARM64, Linux and macOS packages are included when their optional builds succeed.
Windows packages are portable ZIPs and require WebView2.
EOF
