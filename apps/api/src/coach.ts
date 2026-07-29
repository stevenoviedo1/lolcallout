import OpenAI from "openai";
import type { ChatRequest, GameContext } from "@riftcoach/shared";
import { buildDeathCoachBrief, gradeMatch } from "@riftcoach/shared";
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

const model = (intent?: ChatRequest["intent"]) => {
  if (intent === "callout") {
    return process.env.XAI_CALLOUT_MODEL || process.env.XAI_MODEL || "grok-4.5";
  }
  return process.env.XAI_MODEL || "grok-4.5";
};

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
    return `LIVE: Next spawn — one job, farm safe or group.\nNEXT: Buy if needed, safe wave first.`;
  }

  if (req.intent === "callout") {
    // Prefer actionable local lines over echoing the signal title
    if (/low hp|play safe|reset/i.test(req.message) && you) {
      const g = Math.round(you.currentGold);
      return g >= 1000
        ? `CALLOUT: BASE now — low health with ~${g}g in pocket.\nNOTE: Don't gift a free shutdown.`
        : `CALLOUT: RESET or max range only — health is critical.\nNOTE: No all-ins until topped up.`;
    }
    if (/gold|item spike|base/i.test(req.message) && you) {
      return `CALLOUT: BASE for your item spike — ~${Math.round(you.currentGold)}g unspent.\nNOTE: Crash wave first if safe.`;
    }
    if (/shutdown|protect lead|fed/i.test(req.message)) {
      return `CALLOUT: Protect the lead — vision first, no fog walks.\nNOTE: You're worth too much gold.`;
    }
    if (/level/i.test(req.message) && you) {
      return `CALLOUT: Level ${you.level} spike — short trade or shove, then move.\nNOTE: Spend the tempo before it decays.`;
    }
    return `CALLOUT: Play the next wave with intention — farm, base, or group.\nNOTE: Set XAI_API_KEY for richer live coaching.`;
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

  // Live path: almost no history so first token arrives faster
  const historySlice = liveIntent ? history.slice(-2) : history.slice(-8);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    ...historySlice.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  const death = isDeathCoaching(req, context);
  const isLiveCue =
    req.intent === "callout" ||
    req.intent === "what_now" ||
    req.intent === "why_die" ||
    /KIND:|LIVE TEMPO|Situation brief|DEATH COACHING/i.test(req.message || "");
  const maxTokens =
    req.intent === "summary"
      ? 450
      : death || req.intent === "why_die"
        ? 160
        : isLiveCue
          ? 140
          : liveIntent
            ? 180
            : 300;

  const stream = await openai.chat.completions.create({
    model: model(req.intent),
    stream: true,
    temperature: isLiveCue ? 0.35 : 0.5,
    max_tokens: maxTokens,
    messages,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
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
