import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import type {
  CalloutRequest,
  ChatRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  PushContextRequest,
  SessionSummary,
} from "@riftcoach/shared";
import {
  addMessage,
  createSession,
  deleteSession,
  endSession,
  getSession,
  getSummary,
  listMessages,
  listSessions,
  loadFromDisk,
  pruneEmptySessions,
  pushContext,
  setSummary,
} from "./store.js";
import { gradeMatch, DEFAULT_GOALS, type SessionGoal } from "@riftcoach/shared";
import { coachAiStatus, parseSummaryBullets, streamCoachReply } from "./coach.js";
import { synthesizeSpeech, ttsStatus, type TtsProvider } from "./tts.js";
import {
  applyCheckoutEntitlement,
  createCheckoutSession,
  isEntitled,
  listEntitled,
  markEntitled,
  stripeEnabled,
  // handleStripeWebhook loaded dynamically in raw route
} from "./stripe.js";
import { authMiddleware, registerAuthRoutes, type AuthedRequest } from "./authRoutes.js";
import {
  bootstrapPaidEmails,
  countFoundersSeatsTaken,
  getAuthStoreInfo,
  publicUser,
  userHasAccess,
} from "./authStore.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config();

// Cloud hosts (Railway/Render) set PORT. Bind 0.0.0.0 in production so the internet can reach us.
const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
const HOST =
  process.env.API_HOST ||
  (process.env.NODE_ENV === "production" || process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
/** Desktop may bind UI on any free localhost port if 5179 is busy */
const CORS_ALLOW_LOCALHOST = process.env.CORS_ALLOW_LOCALHOST === "1";

loadFromDisk();

const authStoreInfo = getAuthStoreInfo();
console.log(
  `[auth] dataDir=${authStoreInfo.dataDir} writable=${authStoreInfo.writable} ` +
    `fromEnv=${authStoreInfo.dataDirFromEnv} users=${authStoreInfo.userCount}`
);
if (
  (process.env.NODE_ENV === "production" || process.env.PORT) &&
  !authStoreInfo.dataDirFromEnv
) {
  console.warn(
    "[auth] WARNING: DATA_DIR is not set. User accounts may be wiped on every deploy. " +
      "Attach a Railway volume and set DATA_DIR=/data"
  );
}
if (!authStoreInfo.writable) {
  console.error("[auth] ERROR: account data directory is not writable:", authStoreInfo.dataDir);
}

// Optional env-only Pro restore (BOOTSTRAP_PRO_EMAILS=a@x.com:24)
try {
  bootstrapPaidEmails();
} catch (e) {
  console.warn("[auth] bootstrapPaidEmails failed", e);
}

const app = express();
const staticCorsOrigins = new Set([
  CORS_ORIGIN,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5179",
  "http://localhost:5179",
  "https://lolcallout.com",
  "https://www.lolcallout.com",
]);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (staticCorsOrigins.has(origin)) return cb(null, true);
      if (
        CORS_ALLOW_LOCALHOST &&
        /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)
      ) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  })
);

// Stripe webhooks need raw body for signature verification (before json parser)
app.post(
  "/v1/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const { handleStripeWebhook } = await import("./stripe.js");
      const sig = req.headers["stripe-signature"];
      const raw = req.body as Buffer;
      const result = await handleStripeWebhook(
        raw,
        typeof sig === "string" ? sig : Array.isArray(sig) ? sig[0] : undefined
      );
      if (!result.ok) {
        console.error("[stripe webhook]", result.error);
        return res.status(400).json({ error: result.error });
      }
      res.json({ received: true, handled: result.handled });
    } catch (e) {
      console.error("[stripe webhook]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "webhook failed" });
    }
  }
);

app.use(express.json({ limit: "6mb" }));
app.use(authMiddleware);

registerAuthRoutes(app);

app.get("/health", (_req, res) => {
  const store = getAuthStoreInfo();
  const ai = coachAiStatus();
  res.json({
    ok: true,
    service: "lolcallout-api",
    aiConfigured: ai.configured,
    model: ai.reasonModel,
    ai,
    tts: ttsStatus(),
    stripe: stripeEnabled(),
    auth: true,
    accounts: {
      userCount: store.userCount,
      persistent: store.dataDirFromEnv && store.writable,
      dataDirConfigured: store.dataDirFromEnv,
      writable: store.writable,
    },
    founders: {
      priceUsd: 50,
      interval: "month",
      rateMonths: Number(process.env.FOUNDERS_ACCESS_MONTHS || 6),
      standardUsd: 100,
      seats: 100,
      note: "$50/mo for 6 months from activation; 12 months at $50/mo if founders sell out",
    },
  });
});

/** Grade a finished (or live) performance — mode-aware LoL letter scale */
app.post("/v1/grade", (req, res) => {
  const body = req.body || {};
  // Empty goals array → let gradeMatch pick mode-native goals
  const rawGoals = body.goals as SessionGoal[] | undefined;
  const goals =
    Array.isArray(rawGoals) && rawGoals.length > 0 ? rawGoals : undefined;
  const grade = gradeMatch({
    kills: Number(body.kills ?? 0),
    deaths: Number(body.deaths ?? 0),
    assists: Number(body.assists ?? 0),
    creeps: Number(body.creeps ?? 0),
    gameTimeSec: Number(body.gameTimeSec ?? body.gameTime ?? 0),
    earlyDeaths: Number(body.earlyDeaths ?? 0),
    goals,
    repeatDeathPattern: body.repeatDeathPattern || null,
    gameMode: body.gameMode || body.context?.gameMode,
    mapName: body.mapName || body.context?.mapName,
    queueType: body.queueType || body.context?.queueType,
    gameQueueConfigId: body.gameQueueConfigId ?? body.context?.gameQueueConfigId,
    scoreboard: body.scoreboard || body.context?.scoreboard,
    team: body.team,
  });
  res.json({ grade });
});

app.get("/v1/goals/default", (_req, res) => {
  res.json({ goals: DEFAULT_GOALS });
});

/** Stripe Checkout — Founders $50/mo (6 mo rate window) or standard $100/mo */
app.post("/v1/billing/checkout", async (req: AuthedRequest, res) => {
  const email = String(req.body?.email || req.user?.email || "").trim();
  const founders = Boolean(req.body?.founders);
  if (!email) return res.status(400).json({ error: "email required — sign in first or pass email" });
  const result = await createCheckoutSession({ email, founders });
  if ("error" in result) return res.status(503).json(result);
  res.json(result);
});

app.get("/v1/billing/status", (req: AuthedRequest, res) => {
  const email = String(req.query.email || req.user?.email || "");
  res.json({
    stripeEnabled: stripeEnabled(),
    entitled: email ? isEntitled(email) : req.user ? userHasAccess(req.user) : false,
    user: req.user ? publicUser(req.user) : null,
    founders: {
      priceUsd: 50,
      interval: "month",
      rateMonths: Number(process.env.FOUNDERS_ACCESS_MONTHS || 6),
      standardUsd: 100,
      seats: 100,
    },
  });
});

/** Public founders seat counter — cached ~24h (refreshes at most once/day per process) */
let foundersCache: {
  at: number;
  taken: number;
  remaining: number;
  seats: number;
} | null = null;
const FOUNDERS_CACHE_MS = 24 * 60 * 60 * 1000;

function getFoundersSeatSnapshot() {
  const seats = Number(process.env.FOUNDERS_SEATS || 100);
  const now = Date.now();
  if (!foundersCache || now - foundersCache.at > FOUNDERS_CACHE_MS) {
    const taken = Math.min(seats, Math.max(0, countFoundersSeatsTaken()));
    foundersCache = {
      at: now,
      taken,
      remaining: Math.max(0, seats - taken),
      seats,
    };
  }
  return {
    seats: foundersCache.seats,
    taken: foundersCache.taken,
    remaining: foundersCache.remaining,
    updatedAt: new Date(foundersCache.at).toISOString(),
    nextRefreshAt: new Date(foundersCache.at + FOUNDERS_CACHE_MS).toISOString(),
    priceUsd: 50,
    interval: "month" as const,
    rateMonths: Number(process.env.FOUNDERS_ACCESS_MONTHS || 6),
  };
}

app.get("/v1/billing/founders-seats", (_req, res) => {
  res.json(getFoundersSeatSnapshot());
});

/** Dev-only: grant Founders */
app.post("/v1/billing/dev-entitle", (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_ENTITLE !== "1") {
    return res.status(403).json({ error: "disabled" });
  }
  const email = String(req.body?.email || "").trim();
  if (!email) return res.status(400).json({ error: "email required" });
  const user = markEntitled(email);
  res.json({
    ok: true,
    email,
    user: publicUser(user as import("./authStore.js").User),
    months: Number(process.env.FOUNDERS_ACCESS_MONTHS || 6),
  });
});

/** Confirm checkout session and grant access (until webhooks) */
app.post("/v1/billing/confirm", async (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId || !stripeEnabled()) {
    return res.status(400).json({ error: "sessionId required and Stripe must be configured" });
  }
  try {
    const { getStripe } = await import("./stripe.js");
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Stripe unavailable" });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return res.status(400).json({ error: "Payment not complete" });
    }
    const email =
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.email ||
      "";
    if (!email) return res.status(400).json({ error: "No email on session" });
    const plan = session.metadata?.plan === "founders" ? "founders" : "pro";
    const monthsMeta = Number(
      session.metadata?.founders_rate_months || session.metadata?.months || 0
    );
    const user = applyCheckoutEntitlement({
      email,
      plan,
      months: plan === "founders" && monthsMeta > 0 ? monthsMeta : undefined,
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : undefined,
    });
    res.json({ ok: true, user: user ? publicUser(user) : null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "confirm failed" });
  }
});

app.get("/v1/tts/status", (_req, res) => {
  res.json(ttsStatus());
});

/** Cloud TTS — natural xAI voices or your cloned ElevenLabs voice */
app.post("/v1/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "");
    const provider = req.body?.provider as TtsProvider | undefined;
    const voice = req.body?.voice as string | undefined;
    if (!text.trim()) return res.status(400).json({ error: "text required" });

    const { buffer, mime, spoken, provider: used } = await synthesizeSpeech({
      text,
      provider,
      voice,
    });

    res.setHeader("Content-Type", mime);
    res.setHeader("X-RiftCoach-Provider", used);
    res.setHeader("X-RiftCoach-Spoken", encodeURIComponent(spoken.slice(0, 200)));
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    console.error("[tts]", msg);
    res.status(502).json({ error: msg });
  }
});

app.post("/v1/sessions", (req, res) => {
  const body = (req.body || {}) as CreateSessionRequest;
  const session = createSession({
    champion: body.champion,
    mode: body.mode,
  });
  addMessage(
    session.id,
    "system",
    "Session started. Live coaching + callouts ready when the agent sees League.",
    { kind: "session_start" }
  );
  const response: CreateSessionResponse = { session };
  res.status(201).json(response);
});

app.get("/v1/history", (req, res) => {
  const all = req.query.all === "1" || req.query.all === "true";
  pruneEmptySessions();
  res.json({ sessions: listSessions({ all }) });
});

app.delete("/v1/sessions/:id", (req, res) => {
  const ok = deleteSession(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

app.post("/v1/history/prune", (_req, res) => {
  const removed = pruneEmptySessions();
  res.json({ removed, sessions: listSessions() });
});

app.get("/v1/sessions/:id", (req, res) => {
  const rec = getSession(req.params.id);
  if (!rec) return res.status(404).json({ error: "session not found" });
  res.json({
    session: rec.session,
    messages: rec.messages,
    summary: rec.summary,
  });
});

app.post("/v1/sessions/:id/context", (req, res) => {
  const body = (req.body || {}) as PushContextRequest;
  if (!body.context) return res.status(400).json({ error: "context required" });
  const ok = pushContext(req.params.id, body.context);
  if (!ok) return res.status(404).json({ error: "session not found" });
  res.json({ ok: true });
});

app.get("/v1/sessions/:id/messages", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  res.json({ messages: listMessages(req.params.id) });
});

async function streamChatHandler(
  sessionId: string,
  body: ChatRequest,
  res: express.Response,
  opts?: { role?: "assistant" | "callout"; skipUserMessage?: boolean }
) {
  const rec = getSession(sessionId);
  if (!rec) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const message = (body.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "message required" });
    return;
  }

  if (body.context) pushContext(sessionId, body.context);
  const context = body.context ?? rec.lastContext;

  if (!opts?.skipUserMessage) {
    addMessage(sessionId, "user", message, { intent: body.intent });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const history = rec.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, opts?.skipUserMessage ? undefined : -1)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  let full = "";
  try {
    for await (const token of streamCoachReply(body, history, context)) {
      full += token;
      res.write(`data: ${JSON.stringify({ type: "token", text: token })}\n\n`);
    }
    const role = opts?.role || "assistant";
    addMessage(sessionId, role, full, { intent: body.intent });
    res.write(`data: ${JSON.stringify({ type: "done", text: full })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "coach failed";
    console.error("[api] chat error", msg);
    const fallback = `VERDICT: N/A\nACTION: Coach error — ${msg}\nNOTE: Check XAI_API_KEY and network.`;
    addMessage(sessionId, "assistant", fallback, { error: true });
    res.write(`data: ${JSON.stringify({ type: "error", text: fallback })}\n\n`);
    res.end();
  }
}

/** SSE streaming chat */
app.post("/v1/sessions/:id/chat", async (req, res) => {
  await streamChatHandler(req.params.id, (req.body || {}) as ChatRequest, res);
});

/** Proactive callout from agent signal */
app.post("/v1/sessions/:id/callout", async (req, res) => {
  const body = (req.body || {}) as CalloutRequest;
  if (!body.signal) return res.status(400).json({ error: "signal required" });

  // Death uses full death-review intent so the model coaches, not narrates
  const isDeath = body.signal.kind === "death";
  const chatBody: ChatRequest = {
    message: isDeath
      ? body.signal.coachPrompt
      : `${body.signal.title}${body.signal.detail ? ` — ${body.signal.detail}` : ""}\n\n${body.signal.coachPrompt}`,
    intent: isDeath ? "why_die" : "callout",
    context: body.context,
    personality: body.personality,
    recentCallouts: body.recentCallouts,
    matchMemory: body.matchMemory,
    deathReport: body.context?.deathReport
      ? {
          total: body.context.deathReport.total,
          early: body.context.deathReport.early,
          mid: body.context.deathReport.mid,
          late: body.context.deathReport.late,
          dominant: body.context.deathReport.dominant,
          records: [],
        }
      : undefined,
  };

  await streamChatHandler(req.params.id, chatBody, res, {
    role: "callout",
    skipUserMessage: true,
  });
});

/** End match + generate summary */
app.post("/v1/sessions/:id/end", async (req, res) => {
  const rec = getSession(req.params.id);
  if (!rec) return res.status(404).json({ error: "session not found" });

  const result = (req.body?.result as "win" | "loss" | "unknown" | undefined) || "unknown";
  const context = req.body?.context ?? rec.lastContext;

  const chatBody: ChatRequest = {
    message: "Generate post-game summary for this match.",
    intent: "summary",
    context,
  };

  let full = "";
  try {
    for await (const token of streamCoachReply(chatBody, [], context)) {
      full += token;
    }
  } catch (err) {
    full = `POST-GAME SUMMARY\n• Review failed: ${err instanceof Error ? err.message : "error"}`;
  }

  const parsed = parseSummaryBullets(full);
  const you = context?.you;
  const summary: SessionSummary = {
    sessionId: req.params.id,
    bullets: parsed.bullets,
    focusAreas: parsed.focusAreas,
    scoreline: you
      ? `${you.championName} ${you.kills}/${you.deaths}/${you.assists} · CS ${you.creeps}`
      : undefined,
    createdAt: new Date().toISOString(),
    raw: full,
  };

  setSummary(req.params.id, summary);
  addMessage(req.params.id, "system", full, { kind: "summary" });
  const session = endSession(req.params.id, result, summary);
  res.json({ session, summary });
});

app.get("/v1/sessions/:id/summary", (req, res) => {
  const summary = getSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: "no summary" });
  res.json({ summary });
});

app.listen(PORT, HOST, () => {
  console.log(`[api] listening on http://${HOST}:${PORT}`);
  console.log(`[api] AI key configured: ${Boolean(process.env.XAI_API_KEY)}`);
});
