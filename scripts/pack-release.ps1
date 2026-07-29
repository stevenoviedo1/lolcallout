# Build a Windows playtest release of LOLCallout
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "==> Building packages" -ForegroundColor Cyan
npm run build -w @riftcoach/shared
npm run build -w @riftcoach/prompts
npm run build -w @riftcoach/api
npm run build -w @riftcoach/agent
npm run build -w @riftcoach/desktop

$pack = Join-Path $root "apps\desktop\release-pack"
if (Test-Path $pack) { Remove-Item $pack -Recurse -Force }
New-Item -ItemType Directory -Path "$pack\server\api" -Force | Out-Null
New-Item -ItemType Directory -Path "$pack\server\agent" -Force | Out-Null
New-Item -ItemType Directory -Path "$pack\ui" -Force | Out-Null

Write-Host "==> Copying server bundles" -ForegroundColor Cyan
Copy-Item "$root\apps\api\dist\*" "$pack\server\api\" -Recurse -Force
Copy-Item "$root\apps\agent\dist\*" "$pack\server\agent\" -Recurse -Force

$serverPkg = @'
{
  "name": "lolcallout-server",
  "private": true,
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^17.4.2",
    "express": "^4.21.2",
    "openai": "^5.23.2",
    "stripe": "^18.5.0",
    "uuid": "^13.0.0",
    "undici": "^8.9.0",
    "screenshot-desktop": "^1.15.4"
  }
}
'@
Set-Content "$pack\server\package.json" $serverPkg -Encoding utf8

Write-Host "==> npm install server deps" -ForegroundColor Cyan
Push-Location "$pack\server"
npm install --omit=dev
Pop-Location

# MUST run AFTER npm install — npm prunes anything not listed in package.json
# Without these, agent/api crash with ERR_MODULE_NOT_FOUND @riftcoach/shared (Offline)
function Copy-RiftcoachWorkspacePkg([string]$name) {
  $srcRoot = Join-Path $root "packages\$name"
  $dest = Join-Path $pack "server\node_modules\@riftcoach\$name"
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  Copy-Item (Join-Path $srcRoot "package.json") $dest -Force
  Copy-Item (Join-Path $srcRoot "dist") (Join-Path $dest "dist") -Recurse -Force
  # package.json "main"/"exports" expect dist; ensure files exist
  if (-not (Test-Path (Join-Path $dest "dist\index.js"))) {
    throw "Missing packages/$name/dist - run build first"
  }
}
Write-Host "==> Bundling @riftcoach/shared + prompts into server node_modules" -ForegroundColor Cyan
Copy-RiftcoachWorkspacePkg "shared"
Copy-RiftcoachWorkspacePkg "prompts"

Copy-Item "$root\apps\desktop\dist\*" "$pack\ui\" -Recurse -Force
# Single brand mark — same as lolcallout.com
$brand = "$root\apps\web\logo-circle.png"
if (-not (Test-Path $brand)) { $brand = "$root\apps\desktop\public\logo-circle.png" }
if (Test-Path $brand) {
  Copy-Item $brand "$pack\ui\logo-circle.png" -Force
  Copy-Item $brand "$root\apps\desktop\public\logo-circle.png" -Force
  Copy-Item $brand "$root\apps\desktop\build\icon.png" -Force
}
if (Test-Path "$root\apps\desktop\public\icon.jpg") {
  Copy-Item "$root\apps\desktop\public\icon.jpg" "$pack\ui\icon.jpg" -Force
}

$envSrc = Join-Path $root ".env"
$playtestEnv = Join-Path $pack "playtest.env"
$extra = @(
  "API_PORT=8787",
  "AGENT_PORT=3847",
  "AGENT_USE_MOCK=false",
  "AUTH_APP_URL=lolcallout://auth",
  "AUTH_DEV_RETURN_LINK=1",
  "API_PUBLIC_URL=http://127.0.0.1:8787",
  "CORS_ORIGIN=http://127.0.0.1:5179",
  "NODE_ENV=production"
)
if (Test-Path $envSrc) {
  $lines = Get-Content $envSrc | Where-Object {
    $_ -match '^(XAI_|AUTH_|API_|AGENT_|TTS_|RESEND_|STRIPE_)' -or $_ -match '^\s*#' -or $_ -match '^[A-Z0-9_]+='
  }
  ($lines + $extra) | Set-Content $playtestEnv -Encoding utf8
  Write-Host "Wrote playtest.env from root .env (playtest keys baked in)" -ForegroundColor Yellow
} else {
  Write-Host "WARNING: no root .env - build may lack XAI_API_KEY" -ForegroundColor Red
  $extra | Set-Content $playtestEnv -Encoding utf8
}

Write-Host "==> Rebuild desktop UI" -ForegroundColor Cyan
npm run build -w @riftcoach/desktop

Write-Host "==> electron-builder" -ForegroundColor Cyan
$desktop = Join-Path $root "apps\desktop"
$releaseDir = Join-Path $desktop "release"
$unpacked = Join-Path $releaseDir "win-unpacked"

# Close any running playtest build so Windows unlocks DLLs
Get-Process -Name "LOLCallout" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping running LOLCallout (PID $($_.Id))..." -ForegroundColor Yellow
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
if (Test-Path $unpacked) {
  Write-Host "Cleaning locked release\win-unpacked..." -ForegroundColor DarkGray
  Remove-Item $unpacked -Recurse -Force -ErrorAction SilentlyContinue
}

Push-Location $desktop

# Monorepo hoists electron to root — electron-builder only looks under apps/desktop.
# Link (or copy) so packaging can resolve electron (matches package.json electronVersion).
$hoistedElectron = Join-Path $root "node_modules\electron"
$localNm = Join-Path $desktop "node_modules"
$localElectron = Join-Path $localNm "electron"
if (-not (Test-Path $localNm)) {
  New-Item -ItemType Directory -Path $localNm -Force | Out-Null
}
if ((Test-Path $hoistedElectron) -and -not (Test-Path (Join-Path $localElectron "package.json"))) {
  if (Test-Path $localElectron) { Remove-Item $localElectron -Recurse -Force -ErrorAction SilentlyContinue }
  try {
    New-Item -ItemType Junction -Path $localElectron -Target $hoistedElectron -Force | Out-Null
    Write-Host "Linked apps/desktop/node_modules/electron -> monorepo root" -ForegroundColor DarkGray
  } catch {
    Write-Host "Junction failed, copying electron module..." -ForegroundColor Yellow
    Copy-Item $hoistedElectron $localElectron -Recurse -Force
  }
}

$builderJs = Join-Path $root "node_modules\electron-builder\cli.js"
if (-not (Test-Path $builderJs)) {
  $builderJs = Join-Path $desktop "node_modules\electron-builder\cli.js"
}
if (-not (Test-Path $builderJs)) {
  throw "electron-builder not found. From repo root run: npm install"
}

# Skip Authenticode tooling unless CSC_LINK / CSC_NAME is set (needs code-signing cert)
if (-not $env:CSC_LINK -and -not $env:CSC_NAME -and -not $env:WIN_CSC_LINK) {
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  Write-Host "Code signing skipped (no CSC_LINK). Set cert env to sign builds." -ForegroundColor DarkGray
}

# NSIS installer (desktop shortcut + Start Menu) + portable exe
& node $builderJs --win nsis portable --x64 --config.electronVersion=39.8.10
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "electron-builder failed with exit code $LASTEXITCODE"
}

# electron-builder frequently omits nested node_modules from extraResources.
# Without them the Live Client agent exits immediately → app shows Offline in-game.
$serverNmSrc = Join-Path $pack "server\node_modules"
$serverNmDst = Join-Path $unpacked "resources\server\node_modules"
$expressOk = Test-Path (Join-Path $serverNmDst "express\package.json")
if (-not $expressOk) {
  if (-not (Test-Path (Join-Path $serverNmSrc "express\package.json"))) {
    Pop-Location
    throw "release-pack/server/node_modules missing express - npm install step failed"
  }
  Write-Host "==> Injecting server node_modules into win-unpacked (Live Client agent deps)" -ForegroundColor Yellow
  if (Test-Path $serverNmDst) { Remove-Item $serverNmDst -Recurse -Force -ErrorAction SilentlyContinue }
  Copy-Item $serverNmSrc $serverNmDst -Recurse -Force
  if (-not (Test-Path (Join-Path $serverNmDst "express\package.json"))) {
    Pop-Location
    throw "Failed to inject server node_modules into win-unpacked"
  }
  Write-Host "==> Rebuilding NSIS + portable from fixed prepackaged app" -ForegroundColor Cyan
  & node $builderJs --win nsis portable --x64 --prepackaged $unpacked --config.electronVersion=39.8.10
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "electron-builder --prepackaged failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Host "Server node_modules already present in win-unpacked" -ForegroundColor DarkGray
}

Pop-Location

$dist = Join-Path $root "apps\desktop\release"
Write-Host ""
Write-Host "Done. Output:" -ForegroundColor Green
Get-ChildItem $dist -ErrorAction SilentlyContinue | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,2)}}, LastWriteTime

$setup = Get-ChildItem $dist -Filter "LOLCallout-Setup*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$portable = Join-Path $dist "LOLCallout.exe"
Write-Host ""
Write-Host "Installers ready:" -ForegroundColor Green
if ($setup) {
  Write-Host "  Desktop installer (recommended): $($setup.FullName)"
  Write-Host "  -> Creates Desktop + Start Menu shortcut with logo"
}
if (Test-Path $portable) {
  Write-Host "  Portable: $portable"
}
Write-Host "Upload to GitHub Releases and update the site download link."
