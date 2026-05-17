#!/usr/bin/env bash
# GitHub Actions CI 构建入口
# 由 .github/workflows/ci.yml 调用
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CI build with Node $(node -v) ==="

npm config set registry https://registry.npmmirror.com

npm install

# 避免跨平台可选依赖问题
rm -rf client/node_modules
npm install --prefix client --include=optional --no-audit --no-fund
node scripts/ensure-tailwind-native.mjs

if [ -n "${NEXT_PUBLIC_API_BASE_URL:-}" ]; then
  export NEXT_PUBLIC_API_BASE_URL
fi
if [ -n "${NEXT_PUBLIC_UPLOAD_ENDPOINT:-}" ]; then
  export NEXT_PUBLIC_UPLOAD_ENDPOINT
fi

node scripts/build-with-node20.mjs
node scripts/sync-dist.mjs

test -f ./dist/index.html
echo "=== CI build OK ==="
ls -la ./dist | head -20