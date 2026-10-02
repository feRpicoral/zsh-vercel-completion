#!/usr/bin/env bash
# Regenerates _vercel from a published Vercel CLI release.
# Usage: scripts/update.sh [version]   (defaults to "latest")

set -euo pipefail

version="${1:-latest}"
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
