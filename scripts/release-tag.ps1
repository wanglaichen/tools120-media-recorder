# Push version tag once (avoids duplicate GitHub Actions runs)
param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if ($Tag -notmatch '^v\d+\.\d+\.\d+(-[\w.-]+)?$') {
  throw 'Tag must look like v1.2.3 or v1.2.3-beta.1'
}

git rev-parse $Tag 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  throw "Tag $Tag already exists locally. Do not use tag -f or push --force."
}

$remoteTag = git ls-remote --tags origin $Tag
if ($LASTEXITCODE -eq 0 -and $remoteTag) {
  throw "Tag $Tag already exists on origin."
}

Write-Host 'Pushing main...'
git push origin main

Write-Host "Creating and pushing tag $Tag (once)..."
git tag -a $Tag -m "release $Tag"
git push origin $Tag

Write-Host 'Done. Expect exactly one CI/CD run on GitHub Actions.'
