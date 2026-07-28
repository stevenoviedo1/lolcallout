# Friend playtest helper — run agent + desktop against a remote API
# Usage:
#   .\scripts\playtest-friend.ps1 -ApiUrl "https://xxxx.ngrok-free.app"

param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$ApiUrl = $ApiUrl.TrimEnd("/")

Write-Host "LOLCallout friend playtest" -ForegroundColor Cyan
Write-Host "API: $ApiUrl"
Write-Host "Agent: http://127.0.0.1:3847 (local — required for League)"
Write-Host ""

# Desktop env (Vite)
$desktopEnv = @"
VITE_API_URL=$ApiUrl
VITE_AGENT_URL=http://127.0.0.1:3847
"@
$desktopEnvPath = Join-Path $root "apps\desktop\.env"
Set-Content -Path $desktopEnvPath -Value $desktopEnv -Encoding utf8
Write-Host "Wrote $desktopEnvPath"

# Ensure deps (quick)
if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Running npm install..."
  npm install
}

npm run build -w @riftcoach/shared
npm run build -w @riftcoach/prompts

Write-Host ""
Write-Host "Starting agent + desktop..." -ForegroundColor Green
Write-Host "Open http://127.0.0.1:5173 after Vite starts"
Write-Host "Sign in with email (or Dev bypass). Then queue League."
Write-Host ""

npx --yes concurrently -n agent,desktop -c green,magenta `
  "npm run dev -w @riftcoach/agent" `
  "npm run dev -w @riftcoach/desktop"
