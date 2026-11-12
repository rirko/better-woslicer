#!/usr/bin/env bash
set -euo pipefail

metadata=(
  --prerelease
  --latest=false
  --title "$RELEASE_TITLE"
  --notes-file release-notes.md
)

if gh release view "$GITHUB_REF_NAME" > /dev/null 2>&1; then
  gh release upload "$GITHUB_REF_NAME" release-assets/* --clobber
  gh release edit "$GITHUB_REF_NAME" --draft=false "${metadata[@]}"
else
  gh release create "$GITHUB_REF_NAME" release-assets/* --verify-tag "${metadata[@]}"
fi
