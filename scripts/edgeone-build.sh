#!/usr/bin/env bash
# EdgeOne Pages 专用构建（环境已预装 Node 20.18.0，勿再下载 Node）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== EdgeOne build Node $(node -v) ==="

export npm_config_ignore_scripts=false

node scripts/ensure-tailwind-native.mjs

if [ -n "${NEXT_PUBLIC_API_BASE_URL:-}" ]; then
  export NEXT_PUBLIC_API_BASE_URL
fi
if [ -n "${NEXT_PUBLIC_UPLOAD_ENDPOINT:-}" ]; then
  export NEXT_PUBLIC_UPLOAD_ENDPOINT
fi

# EdgeOne 已提供 Node 20，直接 next build，避免 build-with-node20 再下载 Node
(cd client && npx --no-install next build)

node scripts/sync-dist.mjs
test -f ./dist/index.html
echo "=== EdgeOne build OK ==="
ls -la ./dist | head -15
