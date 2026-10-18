/**
 * Local coach: same prompts + payload builders as the old hosted coach,
 * streamed from a small model on the player's PC via Ollama.
 */
import type { Express, Response } from "express";
import type { CalloutRequest, ChampSelectState, ChatRequest, GameContext, HabitProfile } from "@riftcoach/shared";
import {
  buildCompactUserPayload,
  buildUserPayload,
  COACH_SYSTEM_PROMPT_SMALL,
  LOLCOACH_SYSTEM_PROMPT_TINY,
} from "@riftcoach/prompts";

/**
 * Fine-tuned models (trained on training/lolcoach_train.jsonl) get the compact
 * payload they were trained on. Opt in with LOLCALLOUT_COMPACT_PAYLOAD=1 or a
 * model tag containing "-ft" (e.g. lolcoach-ft). Base models keep the full payload.
 */
export function useCompactPayload(model?: string): boolean {
  if (process.env.LOLCALLOUT_COMPACT_PAYLOAD === "1") return true;
  return !!model && /-ft\b/.test(model);
}
import { localAiStatus, streamOllamaChat, type LocalAiStatus } from "./ollama.js";
import { isDeathCoaching, offlineCoachReply } from "./offline.js";
import { logPair } from "./pairLog.js";

type Turn = { role: "user" | "assistant"; content: string };

/** Per-intent generation params (carried over unchanged from the hosted coach). */
export function generationParams(req: ChatRequest, context?: GameContext) {
  const liveIntent =
    req.intent === "callout" ||
    req.intent === "what_now" ||
    req.intent === "item" ||
    req.intent === "roam" ||
    req.intent === "objective" ||
    req.intent === "why_die";
  const death = isDeathCoaching(req, context);
  const bro = req.personality === "hype";
  const isLiveCue =
    req.intent === "callout" ||
    req.intent === "what_now" ||
    req.intent === "why_die" ||
    /KIND:|LIVE TEMPO|Situation brief|DEATH COACHING/i.test(req.message || "");
  const maxTokens =
    req.intent === "summary"
      ? 700
      : death || req.intent === "why_die"
        ? bro ? 380 : 280
        : req.intent === "what_now" || req.intent === "free"
          ? bro ? 360 : 300
          : isLiveCue
            ? bro ? 260 : 180
            : liveIntent
              ? bro ? 320 : 240
              : 400;
  const temperature =
    req.intent === "summary"
      ? 0.35
      : req.intent === "callout"
        ? bro ? 0.62 : 0.3
        : isLiveCue
          ? bro ? 0.55 : 0.25
          : bro ? 0.58 : 0.35;
  // Small model + small context window: keep history shorter than the hosted coach did.
  const historyTurns =
    req.intent === "callout" ? 2 : req.intent === "summary" ? 0 : liveIntent ? 4 : 8;
  return { maxTokens, temperature, historyTurns };
}

export function buildMessages(req: ChatRequest, history: Turn[], context?: GameContext, model?: string) {
  const { historyTurns } = generationParams(req, context);
  // Vision is disabled in local mode: strip any frame so the payload never mentions one.
  const textOnly: ChatRequest = { ...req, frameBase64: undefined, frameMime: undefined };
  const compact = useCompactPayload(model);
  const full = { ...textOnly, context: req.context ?? context };
  const user = compact ? buildCompactUserPayload(full) : buildUserPayload(full);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: compact ? LOLCOACH_SYSTEM_PROMPT_TINY : COACH_SYSTEM_PROMPT_SMALL },
    ...(historyTurns ? history.slice(-historyTurns) : []),
    { role: "user", content: user },
  ];
  return { messages, user };
}

export async function* streamLocalCoach(
  req: ChatRequest,
  history: Turn[],
  model: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const context = req.context;
  const { maxTokens, temperature } = generationParams(req, context);
  const { messages, user } = buildMessages(req, history, context, model);
  let full = "";
  for await (const t of streamOllamaChat({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    signal,
  })) {
    full += t;
    yield t;
  }
  logPair({
    intent: req.intent,
    model,
    system: messages[0].content,
    history: messages.slice(1, -1),
    user,
    response: full,
  });
}

// ---- tiny in-memory chat history (local only) ----
const histories = new Map<string, Turn[]>();
function historyFor(id: string): Turn[] {
  let h = histories.get(id);
  if (!h) {
    h = [];
    histories.set(id, h);
    if (histories.size > 20) histories.delete(histories.keys().next().value as string);
  }
  return h;
}

/** One generation at a time so a mid-range GPU isn't hammered during fights. */
let busy = false;

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
const send = (res: Response, payload: Record<string, unknown>) =>
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

async function streamSeed(res: Response, text: string, status: LocalAiStatus) {
  send(res, { type: "meta", source: "seed", hint: status.hint });
  send(res, { type: "token", text });
  send(res, { type: "done", text, source: "seed" });
  res.end();
}

async function runStream(
  res: Response,
  req: ChatRequest,
  sessionKey: string,
  model: string,
  timeoutMs: number
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  busy = true;
  sseHeaders(res);
  send(res, { type: "meta", source: "local-ai", model });
  const hist = historyFor(sessionKey);
  let full = "";
  try {
    for await (const t of streamLocalCoach(req, hist, model, ctrl.signal)) {
      full += t;
      send(res, { type: "token", text: t });
    }
    if (req.intent !== "callout") hist.push({ role: "user", content: req.message });
    hist.push({ role: "assistant", content: full });
    if (hist.length > 16) hist.splice(0, hist.length - 16);
    send(res, { type: "done", text: full });
  } catch (e) {
    const fallback = offlineCoachReply(req, req.context);
    console.warn("[agent] local AI failed:", e instanceof Error ? e.message : e);
    send(res, { type: "meta", source: "seed", hint: "Local AI error — used built-in line." });
    send(res, { type: "done", text: full.trim() ? full : fallback, source: full ? "local-ai" : "seed" });
  } finally {
    clearTimeout(timer);
    busy = false;
    res.end();
  }
}

export function calloutToChat(body: CalloutRequest): ChatRequest {
  const isDeath = body.signal.kind === "death";
  return {
    message: isDeath
      ? body.signal.coachPrompt
      : `${body.signal.title}${body.signal.detail ? ` — ${body.signal.detail}` : ""}\n\n${body.signal.coachPrompt}`,
    intent: isDeath ? "why_die" : "callout",
    context: body.context,
    personality: body.personality,
    recentCallouts: body.recentCallouts,
    matchMemory: body.matchMemory,
    deathReport: body.context?.deathReport
      ? { ...body.context.deathReport, records: [] }
      : undefined,
  };
}

export interface CoachRouteDeps {
  champSelect?: () => ChampSelectState | null;
  habits?: () => HabitProfile | null;
}

/** Attach local-only state the desktop doesn't send (champ select, habit profile). */
export function enrichRequest(body: ChatRequest, deps: CoachRouteDeps): ChatRequest {
  const out = { ...body };
  if (out.intent === "champ_select" && !out.champSelect && deps.champSelect) out.champSelect = deps.champSelect();
  if ((out.intent === "champ_select" || out.intent === "summary") && !out.habits && deps.habits) out.habits = deps.habits();
  return out;
}

export function registerCoachRoutes(app: Express, deps: CoachRouteDeps = {}) {
  app.get("/ai/status", async (req, res) => {
    const s = await localAiStatus(req.query.refresh === "1");
    res.json({ ...s, mode: "local", vision: false, busy });
  });

  app.post("/ai/chat", async (req, res) => {
    const body = enrichRequest((req.body || {}) as ChatRequest, deps) as ChatRequest & { sessionId?: string };
    if (!body.message?.trim()) return res.status(400).json({ error: "message required" });
    const status = await localAiStatus();
    if (!status.model) {
      sseHeaders(res);
      const seed = offlineCoachReply(body, body.context);
      return streamSeed(res, `${seed}\nNOTE: ${status.hint}`, status);
    }
    if (busy) {
      // Wait briefly for an in-flight callout to finish rather than double-loading the GPU.
      for (let i = 0; i < 40 && busy; i++) await new Promise((r) => setTimeout(r, 250));
    }
    await runStream(res, body, body.sessionId || "local", status.model, 45_000);
  });

  app.post("/ai/callout", async (req, res) => {
    const body = (req.body || {}) as CalloutRequest & { sessionId?: string };
    if (!body.signal) return res.status(400).json({ error: "signal required" });
    const status = await localAiStatus();
    if (!status.model) {
      return res.status(503).json({
        code: "LOCAL_AI_UNAVAILABLE",
        error: status.hint,
        setupCommands: status.setupCommands,
      });
    }
    if (busy) return res.status(429).json({ code: "LOCAL_AI_BUSY", error: "Local AI busy" });
    await runStream(res, calloutToChat(body), body.sessionId || "local", status.model, 8_000);
  });

  /** Post-game summary — returns JSON (raw text) so the desktop can store it. */
  app.post("/ai/summary", async (req, res) => {
    const context = req.body?.context as GameContext | undefined;
    const chat: ChatRequest = enrichRequest(
      { message: "Generate post-game summary for this match.", intent: "summary", context },
      deps
    );
    const status = await localAiStatus();
    if (!status.model || busy) {
      return res.json({ raw: offlineCoachReply(chat, context), source: "seed", hint: status.hint });
    }
    busy = true;
    let raw = "";
    try {
      for await (const t of streamLocalCoach(chat, [], status.model, AbortSignal.timeout(60_000))) {
        raw += t;
      }
    } catch {
      raw = "";
    } finally {
      busy = false;
    }
    if (!raw.trim()) {
      return res.json({ raw: offlineCoachReply(chat, context), source: "seed" });
    }
    res.json({ raw, source: "local-ai", model: status.model });
  });
}
