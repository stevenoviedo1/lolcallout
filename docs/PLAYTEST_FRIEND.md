# Friend playtest — LOLCallout

Your friend needs **their own PC** running League.  
Game data **cannot** be read from your computer (Live Client is local only).

**Preferred:** one portable `.exe` (no Node).

Download (latest):  
https://github.com/stevenoviedo1/lolcallout/releases/download/playtest-v0.2.0/LOLCallout-Playtest.exe  

Site: https://lolcallout.com/#download  

---

## What they need

- Windows 10/11 PC (64-bit)  
- League of Legends installed  
- For the **.exe**: nothing else  
- For **dev Option A/B** only: Node.js 20+ → https://nodejs.org  

---

## Option 0 — Portable exe (recommended)

1. Download **LOLCallout-Playtest.exe** from the link above  
2. Double-click (SmartScreen → More info → Run anyway)  
3. Sign in with magic link **or** Dev: continue without login  
4. Click **Test voice** once, turn **Voice ON**, set volume  
5. Start League — status turns **Live**; use **Compact** on second monitor  

---

## Option A — Dev stack if you’re online together

**You** host the API (AI brain + login) on your machine and share it with a tunnel.  
**They** only run the **agent + desktop UI** pointing at your API.

### On YOUR PC (host)

1. Start LOLCallout as usual:

```powershell
cd C:\Users\steve\riftcoach
npm run dev
```

2. In a **new** terminal, share port **8787** (API) with a tunnel, e.g. [ngrok](https://ngrok.com):

```powershell
ngrok http 8787
```

3. Copy the HTTPS URL ngrok prints, e.g. `https://abc123.ngrok-free.app`  
4. Send your friend:
   - That **API URL**
   - The **zip or repo** (see Option B for files)
   - Word that this is a **private playtest**, not public

> Keep ngrok running the whole time they playtest. When you close it, their coach loses AI.

### On THEIR PC

1. Get the project (zip from you, or git clone).  
2. Open PowerShell:

```powershell
cd path\to\riftcoach
npm install
npm run build -w @riftcoach/shared
npm run build -w @riftcoach/prompts
```

3. Create `apps\desktop\.env`:

```env
VITE_API_URL=https://YOUR-NGROK-URL-HERE
VITE_AGENT_URL=http://127.0.0.1:3847
```

4. Create `apps\agent\.env` (or root `.env` for agent):

```env
AGENT_USE_MOCK=false
AGENT_PORT=3847
```

5. Start **only agent + desktop** (not your full monorepo if API is remote):

```powershell
npm run dev -w @riftcoach/agent
```

New terminal:

```powershell
npm run dev -w @riftcoach/desktop
```

6. Open http://127.0.0.1:5173  
7. Sign in with **email** (magic link).  
   - If email isn’t configured on your API, you can **Dev: continue without login** for playtest  
   - Or you grant them Founders: on your API PC run (or ask you to run):

```powershell
# on YOUR machine (API host)
curl -X POST http://127.0.0.1:8787/v1/auth/dev-grant-founders -H "Content-Type: application/json" -d "{\"email\":\"friend@email.com\"}"
```

8. Queue League. Status should go **Live**.

---

## Option B — They run everything alone (no tunnel)

They need your **repo** + a copy of **env without sharing secrets carelessly**.

1. You create a playtest `.env` with:
   - `XAI_API_KEY` (your key — **they will use your AI credits**)
   - `AUTH_DEV_RETURN_LINK=1` so magic links appear on screen if no email

2. They:

```powershell
cd path\to\riftcoach
npm install
npm run build -w @riftcoach/shared
npm run build -w @riftcoach/prompts
# put .env in repo root
npm run dev
```

3. Open http://127.0.0.1:5173 → login or Dev bypass → play League.

**Downside:** Your API key is on their machine. Only trust close friends; rotate the key after playtest if worried.

---

## Option C — You sit together / remote desktop

They play League on their PC; you don’t need to install LOLCallout for them.  
Or they Remote Desktop to **your** PC and play there (awkward for ranked).

Not great for real playtest of *their* setup.

---

## Checklist for them

- [ ] Node installed  
- [ ] `npm install` succeeded  
- [ ] Agent running (port 3847)  
- [ ] Desktop UI open  
- [ ] API reachable (your ngrok or their local)  
- [ ] Voice-over ON, Cost Saver ON  
- [ ] League in a match → status **Live**  
- [ ] Optional: Compact layout on side of ultrawide  

---

## What you should tell them

> LOLCallout is a side window that coaches you during League.  
> No cheats, no inject.  
> Use Compact mode, Voice ON.  
> If something’s wrong, note the time + what you clicked.

---

## After playtest

- Stop ngrok  
- Consider rotating `XAI_API_KEY` if you shared a full `.env`  
- Collect feedback: spammy? silent? useful? voice ok?

---

## Later (real product)

- Hosted API at `api.lolcallout.com`  
- Windows installer (no Node for them)  
- Real magic-link email (Resend)  
- Stripe Founders $50 / 3 months  

That’s when “download + login + play” is one-click for friends.
