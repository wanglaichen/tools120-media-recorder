$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = Join-Path $root "client"
$rootEnv = Join-Path $root ".env"
$rootEnvExample = Join-Path $root ".env.example"
$clientEnv = Join-Path $clientDir ".env"
$clientEnvExample = Join-Path $clientDir ".env.example"

function Copy-EnvIfMissing {
  param (
    [string]$EnvPath,
    [string]$ExamplePath
  )

  if (-not (Test-Path -LiteralPath $EnvPath) -and (Test-Path -LiteralPath $ExamplePath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $EnvPath
    Write-Host "Created $EnvPath"
  }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm was not found. Install Node.js 18+ first."
}

Copy-EnvIfMissing -EnvPath $rootEnv -ExamplePath $rootEnvExample
Copy-EnvIfMissing -EnvPath $clientEnv -ExamplePath $clientEnvExample

$clientEnvLocal = Join-Path $clientDir ".env.local"
if (-not (Test-Path -LiteralPath $clientEnvLocal) -and (Test-Path -LiteralPath $clientEnvExample)) {
  Copy-Item -LiteralPath $clientEnvExample -Destination $clientEnvLocal
  Write-Host "Created $clientEnvLocal"
}
node (Join-Path $root "scripts/sync-minimax-env.mjs")

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "Installing server dependencies..."
  npm install --prefix $root
}

if (-not (Test-Path -LiteralPath (Join-Path $clientDir "node_modules"))) {
  Write-Host "Installing client dependencies..."
  npm install --prefix $clientDir
}

$clientHost = "127.0.0.1"
$clientPort = "5173"
if (Test-Path $rootEnv) {
  $envContent = Get-Content $rootEnv -Raw
  if ($envContent -match 'CLIENT_HOST=([^\r\n]+)') {
    $clientHost = $matches[1].Trim()
  }
  if ($envContent -match 'CLIENT_PORT=(\d+)') {
    $clientPort = $matches[1]
  }
}

Write-Host "Stopping existing processes..."
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -like "*tools020*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 500

Write-Host "Starting API server..."
Start-Process -FilePath "node" -ArgumentList "server/index.mjs" -WorkingDirectory $root -WindowStyle Hidden

Start-Sleep -Seconds 2

Write-Host "Starting Next.js at http://${clientHost}:${clientPort} ..."
Set-Location $clientDir
npm run dev -- -H $clientHost -p $clientPort