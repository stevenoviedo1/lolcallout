/** Built-in seed replies (no AI). Used when Ollama isn't running or no model is pulled. */
import type { ChatRequest, GameContext } from "@riftcoach/shared";
import {
  buildDeathCoachBrief,
  computeMatchAnalytics,
  flavorLine,
  gradeMatch,
  parseCoachPersonality,
  strategyNextAction,
} from "@riftcoach/shared";

export function isDeathCoaching(req: ChatRequest, context?: GameContext): boolean {
  if (req.intent === "why_die") return true;
  if (context?.you?.isDead) return true;
  const msg = req.message || "";
  if (/death review|just died|CAUSE\/FIX|player just died|DEATH COACHING/i.test(msg)) {
    return true;
  }
  return false;
}

/** Offline fallback when Ollama/model is unavailable — still real coaching, never pure narration */
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
        ? `CALLOUT: Low HP and ${g} unspent. Base is an option.\nNOTE: Staying risks a shutdown — your call.`
        : `CALLOUT: Health is critical. Resetting or max range are options.\nNOTE: All-ins at this HP are risky.`;
    }
    if (/gold|item spike|base/i.test(req.message) && you) {
      return `CALLOUT: ${Math.round(you.currentGold)}g unspent — basing for the item spike is an option.\nNOTE: Wave state matters for timing.`;
    }
    if (/shutdown|protect lead|fed|ult/i.test(req.message)) {
      return `CALLOUT: Their fed threat is alive — vision and numbers are worth checking.\nNOTE: You decide which fights to take.`;
    }
    if (/level/i.test(req.message) && you) {
      return `CALLOUT: Level ${you.level} — trading, shoving, or roaming are options.\nNOTE: Your call.`;
    }
    return `CALLOUT: Check the alive count — with numbers, objectives open up; without, holding is an option.`;
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
NOTE: Built-in summary — start local AI (Ollama) for a richer narrative.`;
  }

  if (req.intent === "champ_select") {
    return `PLAN: Play safe first 3 levels — trade only with advantage.
MATCHUP: Respect enemy kits; don't ego all-in level 2 without vision.
BAN/NOTE: Built-in champ-select assist (start local AI for live plans).`;
  }

  if (!context?.inGame) {
    return `VERDICT: N/A
ACTION: Queue into a game (or enable agent mock) so I can see live stats.
NOTE: Local AI offline — built-in coach lines only.`;
  }
  if (!you) {
    const top = context.scoreboard?.[0];
    return `VERDICT: Wait
ACTION: Live scoreboard detected (${context.gameMode} @ ${Math.floor(context.gameTime)}s)${top ? ` — e.g. ${top.championName}` : ""}. Identifying your champ next poll.
NOTE: Local AI offline — built-in coach lines only.`;
  }

  if (req.intent === "item" || /item|buy|shop/i.test(req.message)) {
    return `VERDICT: Yes
ACTION: Spend ~${Math.round(you.currentGold)}g on your next major component — don't sit on gold past a full item spike.
NOTE: Built-in reply (local AI offline).`;
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
NOTE: Local AI offline — run: ollama pull qwen2.5:3b-instruct.`;
}
