# GitHub 发版：只 push 一次 tag，避免 CI 跑两遍
param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if ($Tag -notmatch '^v\d+\.\d+\.\d+(-[\w.-]+)?$') {
  throw "Tag 须为 v1.2.3 或 v1.2.3-beta.1 形式"
}

$localTag = git rev-parse $Tag 2>$null
if ($LASTEXITCODE -eq 0) {
  throw "本地已存在 Tag $Tag。勿使用 tag -f / push --force，否则会触发第二次 CI。"
}

$remoteTag = git ls-remote --tags origin "refs/tags/$Tag"
if ($remoteTag) {
  throw "远端已存在 Tag $Tag，拒绝重复推送。"
}

Write-Host "同步 main..."
git push origin main

Write-Host "创建并推送 Tag $Tag（仅一次）..."
git tag -a $Tag -m "release $Tag"
git push origin $Tag

Write-Host "完成。请在 GitHub Actions 查看 CI/CD（应只有 1 条运行）。"
