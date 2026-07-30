import OpenAI from "openai";
import type { ChatRequest, GameContext } from "@riftcoach/shared";
import {
  buildDeathCoachBrief,
  computeMatchAnalytics,
  flavorLine,
  gradeMatch,
  parseCoachPersonality,
  strategyNextAction,
} from "@riftcoach/shared";
import { buildUserPayload, COACH_SYSTEM_PROMPT } from "@riftcoach/prompts";

function client(): OpenAI {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not set. Add it to .env (see .env.example).");
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  });
}

/** Premium dual-model routing (state of the art) */
export type ReasoningEffort = "low" | "medium" | "high";

export function coachModelConfig(intent?: ChatRequest["intent"]): {
  model: string;
  reasoningEffort: ReasoningEffort | null;
  tier: "callout" | "reason";
} {
  // Fast path: live automatic callouts (~sub-second)
  // Default non-reasoning 4.20 for latency; override with XAI_CALLOUT_MODEL
  if (intent === "callout") {
    return {
      model:
        process.env.XAI_CALLOUT_MODEL ||
        process.env.XAI_FAST_MODEL ||
        "grok-4.20-0309-non-reasoning",
      reasoningEffort: null,
      tier: "callout",
    };
  }

  // Deep path: what_now / death / summary / free — flagship + reasoning effort
  const hard =
    intent === "summary" ||
    intent === "why_die" ||
    intent === "what_now" ||
    intent === "champ_select";
  const effort = (
    process.env.XAI_REASONING_EFFORT ||
    (hard ? "high" : "medium")
  ).toLowerCase() as ReasoningEffort;
  const safeEffort: ReasoningEffort =
    effort === "low" || effort === "medium" || effort === "high" ? effort : "high";

  return {
    model: process.env.XAI_REASON_MODEL || process.env.XAI_MODEL || "grok-4.5",
    // grok-4.5 accepts reasoning_effort on chat completions
    reasoningEffort: process.env.XAI_DISABLE_REASONING === "1" ? null : safeEffort,
    tier: "reason",
  };
}

const model = (intent?: ChatRequest["intent"]) => coachModelConfig(intent).model;

function isDeathCoaching(req: ChatRequest, context?: GameContext): boolean {
  if (req.intent === "why_die") return true;
  if (context?.you?.isDead) return true;
  const msg = req.message || "";
  if (/death review|just died|CAUSE\/FIX|player just died|DEATH COACHING/i.test(msg)) {
    return true;
  }
  return false;
}

/** Offline fallback when no API key — still real coaching, never pure narration */
export function offlineCoachReply(req: ChatRequest, context?: GameContext): string {
  const you = context?.you;

  if (isDeathCoaching(req, context) || (req.intent === "callout" && /death|died/i.test(req.message))) {
    const brief = context ? buildDeathCoachBrief(context) : null;
    if (brief) {
      return `LIVE: ${brief.lines.live}\nNEXT: ${brief.lines.next}`;
    }
    return `LIVE: Next spawn — one job: nearest wave or stack with two allies.\nNEXT: Buy if needed, then rejoin with info.`;
  }

  if (req.intent === "callout") {
    // Prefer combat/field-aware local lines
    if (context) {
      const a = computeMatchAnalytics(context);
      const personality = parseCoachPersonality(req.personality);
      const seed = Math.floor(context.gameTime);
      if (a?.convertHint && a.fightLight === "green") {
        return `CALLOUT: ${flavorLine(a.convertHint, personality, seed)}`;
      }
      if (a?.holdHint && a.fightLight === "red") {
        return `CALLOUT: ${flavorLine(a.holdHint, personality, seed)}`;
      }
      if (a) {
        const line = strategyNextAction(a);
        if (line) {
          return `CALLOUT: ${flavorLine(line, personality, seed)}`;
        }
      }
    }
    if (/low hp|play safe|reset/i.test(req.message) && you) {
      const g = Math.round(you.currentGold);
      return g >= 1000
        ? `CALLOUT: BASE now — low health with ~${g}g in pocket.\nNOTE: Don't gift a free shutdown.`
        : `CALLOUT: RESET or max range only — health is critical.\nNOTE: No all-ins until topped up.`;
    }
    if (/gold|item spike|base/i.test(req.message) && you) {
      return `CALLOUT: BASE for your item spike — ~${Math.round(you.currentGold)}g unspent.\nNOTE: Crash wave first if safe.`;
    }
    if (/shutdown|protect lead|fed|ult/i.test(req.message)) {
      return `CALLOUT: Respect the threat — vision first, no free walk-ups.\nNOTE: Only high-% fights.`;
    }
    if (/level/i.test(req.message) && you) {
      return `CALLOUT: Level ${you.level} spike — short trade or shove, then move.\nNOTE: Spend the tempo before it decays.`;
    }
    return `CALLOUT: Play the next high-% decision — convert if numbers, hold if not.\nNOTE: Set XAI_API_KEY for richer live coaching.`;
  }

  if (req.intent === "summary") {
    const line = you
      ? `${you.championName} ${you.kills}/${you.deaths}/${you.assists} · ${you.creeps} CS`
      : "No final scoreline";
    const g = gradeMatch({
      kills: you?.kills ?? 0,
      deaths: you?.deaths ?? 0,
      assists: you?.assists ?? 0,
      creeps: you?.creeps ?? 0,
      gameTimeSec: context?.gameTime ?? 0,
      earlyDeaths: context?.deathReport?.early ?? 0,
      goals: req.goals,
      repeatDeathPattern: context?.deathReport?.dominant,
      gameMode: context?.gameMode,
      mapName: context?.mapName,
      queueType: context?.queueType,
      gameQueueConfigId: context?.gameQueueConfigId,
      scoreboard: context?.scoreboard,
    });
    return `POST-GAME SUMMARY
Grade: ${g.letter} (${g.score}/100) · ${g.modeLabel}
Scale: ${g.scaleNote}
Scoreline: ${line}
Goals:
${g.goals.map((x) => `${x.passed ? "PASS" : "FAIL"} — ${x.detail}`).join("\n")}
• ${g.habits[0] || "Stack leads into objectives."}
• ${g.habits[1] || "Track death patterns."}
• ${g.habits[2] || "Base with gold."}
NOTE: Demo summary — set XAI_API_KEY for richer narrative.`;
  }

  if (req.intent === "champ_select") {
    return `PLAN: Play safe first 3 levels — trade only with advantage.
MATCHUP: Respect enemy kits; don't ego all-in level 2 without vision.
BAN/NOTE: Demo champ-select assist (set XAI_API_KEY for live plans).`;
  }

  if (!context?.inGame) {
    return `VERDICT: N/A
ACTION: Queue into a game (or enable agent mock) so I can see live stats.
NOTE: Demo mode — set XAI_API_KEY for real coaching.`;
  }
  if (!you) {
    const top = context.scoreboard?.[0];
    return `VERDICT: Wait
ACTION: Live scoreboard detected (${context.gameMode} @ ${Math.floor(context.gameTime)}s)${top ? ` — e.g. ${top.championName}` : ""}. Identifying your champ next poll.
NOTE: Demo mode — set XAI_API_KEY for full coaching.`;
  }

  if (req.intent === "item" || /item|buy|shop/i.test(req.message)) {
    return `VERDICT: Yes
ACTION: Spend ~${Math.round(you.currentGold)}g on your next major component — don't sit on gold past a full item spike.
NOTE: Demo reply (no XAI_API_KEY).`;
  }

  if (req.intent === "why_die" || /die|died|death/i.test(req.message)) {
    const brief = context ? buildDeathCoachBrief(context) : null;
    if (brief) return brief.formatted;
    return `CAUSE: Missing info — vision, numbers, or cooldowns were wrong.
FIX: Next fight only with a clear win condition.
AVOID: Facechecking without summs when behind tempo.
NEXT: Safe wave first, then group for the next objective.`;
  }

  return `VERDICT: Wait
ACTION: As ${you.championName} L${you.level} (${you.kills}/${you.deaths}/${you.assists}, ${you.creeps} CS) play for the next wave and track jungle.
NOTE: Demo mode — add XAI_API_KEY for live AI coaching.`;
}

function buildVisionUserContent(
  text: string,
  frameBase64?: string,
  frameMime?: string
): OpenAI.Chat.ChatCompletionContentPart[] | string {
  if (!frameBase64) return text;
  const mime = frameMime || "image/jpeg";
  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${frameBase64}`,
      },
    },
  ];
}

export async function* streamCoachReply(
  req: ChatRequest,
  history: { role: "user" | "assistant"; content: string }[],
  context?: GameContext
): AsyncGenerator<string> {
  if (!process.env.XAI_API_KEY) {
    const text = offlineCoachReply(req, context);
    for (const ch of text) {
      yield ch;
      await new Promise((r) => setTimeout(r, 3));
    }
    return;
  }

  const openai = client();
  const userText = buildUserPayload({ ...req, context: req.context ?? context });
  const userContent = buildVisionUserContent(userText, req.frameBase64, req.frameMime);

  const liveIntent =
    req.intent === "callout" ||
    req.intent === "what_now" ||
    req.intent === "item" ||
    req.intent === "roam" ||
    req.intent === "objective" ||
    req.intent === "why_die";

  // More history = more brain (pattern continuity). Callouts still lighter for speed.
  const historySlice =
    req.intent === "callout"
      ? history.slice(-3)
      : req.intent === "summary"
        ? history.slice(-12)
        : liveIntent
          ? history.slice(-6)
          : history.slice(-14);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    ...historySlice.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  const death = isDeathCoaching(req, context);
  const bro = req.personality === "hype";
  const isLiveCue =
    req.intent === "callout" ||
    req.intent === "what_now" ||
    req.intent === "why_die" ||
    /KIND:|LIVE TEMPO|Situation brief|DEATH COACHING/i.test(req.message || "");
  // Higher ceilings = deeper answers (still capped for voice latency on callouts)
  const maxTokens =
    req.intent === "summary"
      ? 700
      : death || req.intent === "why_die"
        ? bro
          ? 380
          : 280
        : req.intent === "what_now" || req.intent === "free"
          ? bro
            ? 360
            : 300
          : isLiveCue
            ? bro
              ? 260
              : 180
            : liveIntent
              ? bro
                ? 320
                : 240
              : 400;

  // Lower temp on hard decisions; slightly higher for bro chat flavor
  const temperature =
    req.intent === "summary"
      ? 0.35
      : req.intent === "callout"
        ? bro
          ? 0.5
          : 0.3
        : isLiveCue
          ? bro
            ? 0.4
            : 0.25
          : bro
            ? 0.5
            : 0.35;

  const cfg = coachModelConfig(req.intent);
  // Build request with xAI-specific premium fields (typed loosely for vendor params)
  const createParams: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  // Premium: enable xAI reasoning effort on the deep path (grok-4.5+)
  if (cfg.reasoningEffort) {
    createParams.reasoning_effort = cfg.reasoningEffort;
  }

  // Sticky cache key for better prompt-cache hits across coach requests
  if (process.env.XAI_PROMPT_CACHE !== "0") {
    createParams.prompt_cache_key =
      process.env.XAI_PROMPT_CACHE_KEY || "lolcallout-coach-v2";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await openai.chat.completions.create(createParams as any);

  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Public model routing snapshot for /health */
export function coachAiStatus() {
  const callout = coachModelConfig("callout");
  const reason = coachModelConfig("what_now");
  return {
    configured: Boolean(process.env.XAI_API_KEY),
    calloutModel: callout.model,
    reasonModel: reason.model,
    reasoningEffort: reason.reasoningEffort,
    premium: true,
    brains: [
      "oracle",
      "deep_reason",
      "tactical",
      "battle_reader",
      "elite",
      "match_memory",
    ] as const,
  };
}

export function parseSummaryBullets(raw: string): {
  bullets: string[];
  focusAreas: string[];
} {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"))
    .map((l) => l.replace(/^[-•*]\s*/, ""))
    .slice(0, 6);
  const focusAreas = bullets.slice(0, 3);
  if (bullets.length === 0) {
    return {
      bullets: [raw.slice(0, 280)],
      focusAreas: ["Review VOD of first death", "CS consistency", "Objective timers"],
    };
  }
  return { bullets, focusAreas };
}
