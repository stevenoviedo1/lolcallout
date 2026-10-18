# LOLCallout

**Vanguard-safe** live AI coach for League of Legends (SR · ARAM · Arena).

**Pricing (launch):** Pro **$100/mo** · Founders **$50 first month** (then $100).

| Feature | Status |
|---------|--------|
| Live Client Data HUD | ✅ |
| Streaming coach chat (local AI via Ollama — free, on your PC) | ✅ |
| Quick chips | ✅ |
| Proactive callouts (death / gold / HP / objectives) | ✅ |
| Death review intent | ✅ |
| Post-game summary + history | ✅ |
| Compact layout | ✅ |
| Screen capture vision | ⏸ disabled with local AI |
| Browser push-to-talk (Chrome/Edge) | ✅ |
| No memory injection | ✅ |

> RiftCoach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.

## Quick start

```bash
cd riftcoach
npm install
cp .env.example .env
# Local AI (free): install Ollama, then
# ollama pull qwen2.5:3b-instruct   (see docs/LOCAL_AI.md)
npm run build -w @riftcoach/shared
npm run build -w @riftcoach/prompts
npm run dev
```

Open **http://127.0.0.1:5173**

| Service | URL |
|---------|-----|
| Desktop UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 |
| Agent | http://127.0.0.1:3847 |

## How to use in game

1. Start RiftCoach (`npm run dev`)
2. Start League — agent switches from mock → **Live**
3. Keep the companion window on a second monitor (or **Compact** mode)
4. Ask “What now?” or enable **Callouts** for automatic death / gold / HP tips
5. After the match ends, a **post-game summary** is generated automatically
6. Open **History** to reopen past sessions

### Vision

- Disabled while AI runs locally (small text-only model). No screenshots are captured or sent.

### Voice

- **Mic** button uses Web Speech API (Chrome/Edge)
- Speaks a question → sent as coach chat

## Architecture

```
League Live Client :2999
        ↓ poll (agent)
  Event detector → signals (death, gold, etc.)
        ↓
  Desktop UI ←→ Agent /ai/* ←→ Ollama on this PC (lolcoach / qwen2.5:3b-instruct)
        ↓
  Account API (auth · Stripe · sessions/history — no AI)
```

See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Env

```env
LOLCOACH_MODEL=lolcoach
LOLCOACH_FALLBACK_MODEL=qwen2.5:3b-instruct
AGENT_USE_MOCK=true
```

Without Ollama (or without a pulled model), built-in coach lines still work using live/mock stats.
See [docs/LOCAL_AI.md](docs/LOCAL_AI.md).

## Monorepo

```
apps/desktop   React companion UI
apps/api       Account API: auth, Stripe, sessions, stored summaries (no AI)
apps/agent     Live Client + events + local AI coach (Ollama)
packages/shared
packages/prompts
docs/COMPLIANCE.md
data/          session history (gitignored)
```

## Scripts

```bash
npm run dev
npm run dev:api
npm run dev:agent
npm run dev:desktop
npm run build
```

## Not in this build (later)

- True Tauri/Electron installers (needs packaging pass)
- Click-through in-game overlay window
- Riot RSO account login / official match-V5 deep history
- Always-on voice TTS callouts
