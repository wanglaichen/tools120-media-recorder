#!/usr/bin/env bash
# GitHub Actions CI 构建入口
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CI build with Node $(node -v) ==="

node scripts/write-build-version.mjs

# 安装根目录依赖
npm install --no-audit --no-fund

# 安装 client 依赖
npm install --prefix client --no-audit --no-fund

# 构建 client（线上默认同源 API）
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-https://tools120-media-recorder.edgeone.dev}"
npm run --prefix client build

node scripts/postprocess-static-export.mjs
node scripts/verify-static-export.mjs ./client/out
node scripts/sync-dist.mjs

test -f ./client/out/index.html
test -f ./dist/index.html
echo "=== CI build OK (client/out + dist) ==="
ls -la ./client/out | head -15