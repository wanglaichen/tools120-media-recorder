#!/usr/bin/env bash
# GitHub 发版：只 push 一次 tag，避免 CI 跑两遍（勿 tag -f 再 push）
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "用法: bash scripts/release-tag.sh v0.5.8"
  exit 1
fi

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Tag 须为 v1.2.3 或 v1.2.3-beta.1 形式"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "本地已存在 Tag $TAG。不要 force-push，否则会触发第二次 CI。"
  echo "若必须重发：先删远端 tag，再重新打 tag 指向新提交。"
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$TAG" | grep -q .; then
  echo "远端已存在 Tag $TAG，拒绝重复推送。"
  exit 1
fi

echo "同步 main..."
git push origin main

echo "创建并推送 Tag $TAG（仅一次）..."
git tag -a "$TAG" -m "release $TAG"
git push origin "$TAG"

echo "完成。请在 GitHub Actions 查看 CI/CD（应只有 1 条运行）。"
echo "https://github.com/wanglaichen/tools120-media-recorder/actions"
