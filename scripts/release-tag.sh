#!/usr/bin/env bash
# 本地打 Tag 并推送，触发 Gitee 流水线（Linux/macOS/Git Bash 可用）
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "用法: bash scripts/release-tag.sh v1.14.0"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git push origin master
git tag -a "$TAG" -m "release $TAG"
git push origin "$TAG"
echo "已推送 Tag $TAG，请在 Gitee 查看新流水线（勿重跑旧记录）"
