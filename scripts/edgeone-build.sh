#!/usr/bin/env bash
# EdgeOne Pages 专用构建（环境已预装 Node 20.18.0，勿再下载 Node）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== EdgeOne build Node $(node -v) ==="

export npm_config_ignore_scripts=false

node scripts/ensure-tailwind-native.mjs
node scripts/write-build-version.mjs

export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-https://tools120-media-recorder.edgeone.cool}"
echo "NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL"
if [ -n "${NEXT_PUBLIC_UPLOAD_ENDPOINT:-}" ]; then
  export NEXT_PUBLIC_UPLOAD_ENDPOINT
fi

# EdgeOne 已提供 Node 20，直接 next build，避免 build-with-node20 再下载 Node
(cd client && npx --no-install next build)

node scripts/postprocess-static-export.mjs
node scripts/verify-static-export.mjs ./client/out
test -f ./client/out/index.html
grep -q "聚合工作台" ./client/out/index.html || (echo "client/out/index.html 不是首页产物" && exit 1)
grep -q "聚合工作台 v" ./client/out/index.html || (echo "client/out/index.html 缺少版本号" && exit 1)
test ! -f ./client/out/404.html || (echo "client/out 仍含 404.html" && exit 1)
echo "=== EdgeOne build OK (output: client/out) ==="
ls -la ./client/out | head -15
