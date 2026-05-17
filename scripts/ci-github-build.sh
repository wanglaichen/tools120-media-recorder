#!/usr/bin/env bash
# GitHub Actions CI 构建入口
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CI build with Node $(node -v) ==="

# 安装根目录依赖
npm install --no-audit --no-fund

# 安装 client 依赖
npm install --prefix client --no-audit --no-fund

# 构建 client
export NEXT_TELEMETRY_DISABLED=1
npm run --prefix client build

# 同步输出
node scripts/sync-dist.mjs

test -f ./dist/index.html
echo "=== CI build OK ==="
ls -la ./dist | head -20