#!/usr/bin/env bash
# Gitee 默认 Node 19.6.x 不满足 Next.js 15 / Tailwind v4，强制使用 Node 20 LTS
set -euo pipefail

REQUIRED="20.18.0"
CURRENT="$(node -v 2>/dev/null || echo 'none')"
echo "CI Node (before): $CURRENT"

version_ok() {
  local v="$1"
  v="${v#v}"
  local major minor patch
  major="$(echo "$v" | cut -d. -f1)"
  minor="$(echo "$v" | cut -d. -f2)"
  patch="$(echo "$v" | cut -d. -f3)"
  if [ "$major" -ge 21 ]; then return 0; fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge 3 ]; then return 0; fi
  if [ "$major" -eq 19 ] && [ "$minor" -ge 8 ]; then return 0; fi
  if [ "$major" -eq 18 ] && [ "$minor" -ge 18 ]; then return 0; fi
  return 1
}

if version_ok "$CURRENT"; then
  echo "CI Node OK: $CURRENT"
  exit 0
fi

echo "Node $CURRENT 不满足依赖要求，切换到 v${REQUIRED} ..."

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm install "$REQUIRED"
  nvm use "$REQUIRED"
else
  ARCH="linux-x64"
  case "$(uname -m)" in
    aarch64|arm64) ARCH="linux-arm64" ;;
  esac
  TARBALL="node-v${REQUIRED}-${ARCH}"
  CACHE_DIR="${HOME}/.cache/tools020-node"
  mkdir -p "$CACHE_DIR"
  if [ ! -x "$CACHE_DIR/$TARBALL/bin/node" ]; then
    curl -fsSL "https://nodejs.org/dist/v${REQUIRED}/${TARBALL}.tar.xz" -o "/tmp/${TARBALL}.tar.xz"
    tar -xJf "/tmp/${TARBALL}.tar.xz" -C "$CACHE_DIR"
  fi
  export PATH="$CACHE_DIR/$TARBALL/bin:$PATH"
fi

CURRENT="$(node -v)"
echo "CI Node (after): $CURRENT"

if ! version_ok "$CURRENT"; then
  echo "ERROR: 无法切换到兼容 Node，当前 $CURRENT"
  exit 1
fi
