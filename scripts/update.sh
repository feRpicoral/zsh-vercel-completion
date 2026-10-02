#!/usr/bin/env bash
# Regenerates _vercel from a published Vercel CLI release.
# Usage: scripts/update.sh [version|latest]   (defaults to the version of the installed CLI)

set -euo pipefail

if [[ $# -gt 0 ]]; then
  version="$1"
else
  version="$(vercel --version 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    echo "Could not read the installed vercel version; pass a version or \"latest\"." >&2
    exit 1
  fi
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

npm install --prefix "$workdir" --no-audit --no-fund --ignore-scripts --silent "vercel@$version"

package_dir="$workdir/node_modules/vercel"
node "$root/scripts/generate.mjs" "$package_dir" > "$workdir/_vercel"
zsh -n "$workdir/_vercel"

mv "$workdir/_vercel" "$root/_vercel"
node -p "require('$package_dir/package.json').version" > "$root/vercel-version"

echo "Generated _vercel for vercel $(cat "$root/vercel-version")"
