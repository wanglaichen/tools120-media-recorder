#!/usr/bin/env bash
# Gitee / EdgeOne 统一 CI 入口（一条命令完成，避免网页旧流水线仍跑 npm ci + Node 19）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 把 Node 20 加入 PATH，供后续 npm / next 使用
setup_node() {
  bash scripts/ci-use-node20.sh
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm use 20.18.0 2>/dev/null || nvm use 20 2>/dev/null || true
  fi
  if [ -d "$HOME/.cache/tools020-node/node-v20.18.0-linux-x64/bin" ]; then
    export PATH="$HOME/.cache/tools020-node/node-v20.18.0-linux-x64/bin:$PATH"
  fi
  ARCH="linux-x64"
  case "$(uname -m)" in aarch64|arm64) ARCH="linux-arm64" ;; esac
  TARBALL="node-v20.18.0-${ARCH}"
  if [ -x "$HOME/.cache/tools020-node/$TARBALL/bin/node" ]; then
    export PATH="$HOME/.cache/tools020-node/$TARBALL/bin:$PATH"
  fi
}

setup_node
echo "=== CI build with Node $(node -v) ==="

npm config set registry https://registry.npmmirror.com

npm install

# 避免 npm ci 在 Linux 上漏装 @tailwindcss/oxide-* 可选依赖（lock 若在 Windows 生成）
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
