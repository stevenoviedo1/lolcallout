# LOLCallout

**Vanguard-safe** live AI coach for League of Legends (SR · ARAM · Arena).

**Pricing (launch):** Pro **$100/mo** · Founders **$50 first month** (then $100).

| Feature | Status |
|---------|--------|
| Live Client Data HUD | ✅ |
| Streaming coach chat (SpaceXAI) | ✅ |
| Quick chips | ✅ |
| Proactive callouts (death / gold / HP / objectives) | ✅ |
| Death review intent | ✅ |
| Post-game summary + history | ✅ |
| Compact layout | ✅ |
| Optional screen capture vision | ✅ |
| Browser push-to-talk (Chrome/Edge) | ✅ |
| No memory injection | ✅ |

> RiftCoach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.

## Quick start

```bash
cd riftcoach
npm install
cp .env.example .env
# Optional but recommended:
# XAI_API_KEY=... from https://console.x.ai
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

### Vision (opt-in)

- **Analyze screen** — one capture of the primary monitor via local agent
- Settings → attach capture on every ask (heavier / privacy tradeoff)
- No game process injection

### Voice

- **Mic** button uses Web Speech API (Chrome/Edge)
- Speaks a question → sent as coach chat

## Architecture

```
League Live Client :2999
        ↓ poll (agent)
  Event detector → signals (death, gold, etc.)
        ↓
  Desktop UI ←→ Coach API ←→ SpaceXAI (grok-4.5)
        ↓
  data/sessions.json (history)
```

See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Env

```env
XAI_API_KEY=
XAI_MODEL=grok-4.5
AGENT_USE_MOCK=true
AGENT_CAPTURE=true
```

Without `XAI_API_KEY`, demo coach replies still stream using live/mock stats.

## Monorepo

```
apps/desktop   React companion UI
apps/api       Coach API + sessions + summaries
apps/agent     Live Client + events + capture
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
