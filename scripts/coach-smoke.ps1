# Smoke: AI coach callout path on local API
$ErrorActionPreference = "Stop"
$api = "http://127.0.0.1:8787"

Write-Host "==> Health" -ForegroundColor Cyan
$h = Invoke-RestMethod "$api/health"
if (-not $h.aiConfigured) { throw "XAI_API_KEY not configured" }
Write-Host "AI ok model=$($h.model)"

Write-Host "==> Session" -ForegroundColor Cyan
$sess = Invoke-RestMethod "$api/v1/sessions" -Method POST -ContentType "application/json" -Body "{}"
$id = $sess.session.id

$json = @'
{
  "signal": {
    "id": "smoke-1",
    "kind": "tempo",
    "severity": "info",
    "gameTime": 420,
    "title": "Coach",
    "detail": "Base for spike",
    "coachPrompt": "KIND: tempo\nMODE: CLASSIC\nCLOCK: 7:00 (early)\nYOU: Aurelion Sol L6 2/1/1 CS40\nGOLD: 1800g unspent | HP: 66% | DEAD: no\nFED_ENEMIES: Orianna\nFALLBACK: Base for spike - 1800 gold unspent.\n\nLIVE TEMPO. One speakable sentence max 18 words. Name Asol. Action first. Never say you died.",
    "spokenFallback": "Base for spike - 1800 gold unspent.",
    "createdAt": "2026-07-28T00:00:00.000Z"
  },
  "context": {
    "source": "live",
    "inGame": true,
    "gameTime": 420,
    "gameMode": "CLASSIC",
    "mapName": "Map11",
    "you": {
      "championName": "Aurelion Sol",
      "level": 6,
      "currentGold": 1800,
      "kills": 2,
      "deaths": 1,
      "assists": 1,
      "creeps": 40,
      "isDead": false,
      "items": ["World Atlas", "Tear of the Goddess", "Amplifying Tome"],
      "currentHealth": 800,
      "maxHealth": 1200
    },
    "scoreboard": [
      {"championName":"Aurelion Sol","team":"ORDER","level":6,"kills":2,"deaths":1,"assists":1,"creeps":40,"isDead":false},
      {"championName":"Orianna","team":"CHAOS","level":7,"kills":3,"deaths":0,"assists":1,"creeps":60,"isDead":false}
    ],
    "recentEvents": [],
    "deathReport": {"total":1,"early":1,"mid":0,"late":0,"dominant":null},
    "updatedAt": "2026-07-28T00:00:00.000Z"
  }
}
'@

Write-Host "==> Callout stream" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$resp = Invoke-WebRequest "$api/v1/sessions/$id/callout" -Method POST -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 40
$sw.Stop()
$text = (
  $resp.Content -split "`n" |
  Where-Object { $_ -match '^data: ' } |
  ForEach-Object {
    try { ($_.Substring(6) | ConvertFrom-Json).text } catch { $null }
  }
) -join ""
Write-Host "latencyMs=$($sw.ElapsedMilliseconds)"
Write-Host "REPLY: $text"
if (-not $text -or $text.Length -lt 8) { throw "Empty coach reply" }
if ($text -match 'you died') { throw "Narration leak" }

Write-Host "==> TTS" -ForegroundColor Cyan
$ttsBody = '{"text":"Asol base now for your spike then stack Q.","provider":"xai","voice":"leo"}'
$tts = Invoke-WebRequest "$api/v1/tts" -Method POST -ContentType "application/json" -Body $ttsBody -TimeoutSec 30
Write-Host "tts status=$($tts.StatusCode) bytes=$($tts.RawContentLength)"

Write-Host "SMOKE OK" -ForegroundColor Green
