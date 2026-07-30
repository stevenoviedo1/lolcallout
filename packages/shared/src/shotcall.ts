/**
 * Shotcall synthesizer — what Grok would do:
 * One maximum-IQ line. No corporate coaching. No filler.
 * Merge battle + convert + HP + threat into a single Discord-quality call.
 */

import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";
import { getChampKit } from "./champKnowledge.js";
import { toNaturalTalk, type CoachPersonality } from "./personality.js";

export interface Shotcall {
  line: string;
  score: number;
  why: string;
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function clip(s: string, maxWords = 28): string {
  const w = s.trim().split(/\s+/);
  if (w.length <= maxWords) return s.trim().replace(/\s+/g, " ");
  // Prefer first full sentence if we have one
  const m = s.match(/^(.+?[.!?])(?:\s|$)/);
  if (m && m[1].split(/\s+/).length >= 8 && m[1].split(/\s+/).length <= maxWords + 4) {
    return m[1].trim();
  }
  return w.slice(0, maxWords).join(" ").replace(/[,;:]$/, "") + ".";
}

/**
 * Produce the single best live line for this frame.
 */
export function makeShotcall(
  a: MatchAnalytics,
  mode: ModeProfile,
  personality: CoachPersonality
): Shotcall | null {
  if (!a || a.you.isDead) return null;

  const c = a.you.champ;
  const hp = a.you.hpPct != null ? Math.round(a.you.hpPct) : null;
  const g = a.you.gold;
  const dead = a.enemyDeadNames.slice(0, 2);
  const deadStr = dead.join(" + ") || null;
  const allyDead = a.allyDeadNames.slice(0, 2);
  const threat = a.battleThreat || a.fedEnemies[0]?.split("(")[0] || null;
  const focus = a.battleFocus || threat;
  const kit = getChampKit(c);
  const opener = kit?.combos[0]?.split("→")[0]?.trim();
  const resp = a.enemyRespawnEstSec;
  const respTag = resp != null ? `~${resp}s` : "";
  const role = a.you.roleHint;
  const noRecall = mode.noRecall || a.noRecall;
  const phase = a.battlePhase;
  const man = a.manAdvantage;
  const hype = personality === "hype";

  // ── 1. You're about to die — no poetry ──
  if (hp != null && hp < 28) {
    if (noRecall) {
      const line =
        g >= 1000
          ? `${c}: ${hp}% holding ${g}g — max range, shop on death. Don't donate.`
          : `${c}: ${hp}% — backline only. You're not the engage.`;
      return {
        line: clip(line),
        score: 98,
        why: "critical HP ARAM/no-recall",
      };
    }
    const line =
      g >= 700
        ? `${c}: ${hp}% ${g}g — BASE. That gold is a shutdown if you stay.`
        : `${c}: ${hp}% — leave the wave. Staying is free LP for them.`;
    return { line: clip(line), score: 98, why: "critical HP SR" };
  }

  // ── 2. Ace / cleanup — convert is the IQ play ──
  if (phase === "cleanup" || (man >= 4 && dead.length >= 2) || a.enemy.alive === 0) {
    if (noRecall) {
      return {
        line: clip(`${c}: dead side — mid shove for plates. No fountain heroics.`),
        score: 95,
        why: "ace convert ARAM",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(
          deadStr
            ? `${c}: ${deadStr} down ${respTag} — you start obj, they crash. Go.`
            : `${c}: map open — start the obj, don't solo invade fog.`
        ),
        score: 96,
        why: "jg post-fight obj",
      };
    }
    const line =
      g >= 1400 && man >= 3
        ? `${c}: ${deadStr || "them"} down ${respTag} — one tower then base ${g}g. No fog.`
        : `${c}: ${deadStr || "them"} down ${respTag} — plates/inhib/obj. Chase = throw.`;
    return {
      line: clip(line),
      score: 96,
      why: "post-fight convert",
    };
  }

  // ── 3. Disengage / losing hard ──
  if (phase === "disengage" || phase === "losing" || man <= -2) {
    if (role === "SUPPORT" && a.battleJob === "peel") {
      const carry = a.fedAllies[0]?.split("(")[0] || "your carry";
      return {
        line: clip(
          threat
            ? `${c}: peel ${carry}. ${threat} is the delete button — not your all-in.`
            : `${c}: peel ${carry}. You don't win this fight first-in.`
        ),
        score: 93,
        why: "support losing peel",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(`${c}: ${man} — drop the river. Opposite camps. Live.`),
        score: 92,
        why: "jg lose path",
      };
    }
    const line = threat
      ? `${c}: ${a.team.alive}v${a.enemy.alive} — leave. ${threat} farms you if you stay.`
      : `${c}: ${a.team.alive}v${a.enemy.alive} — disengage. Flash is for living.`;
    return { line: clip(line), score: 94, why: "losing disengage" };
  }

  // ── 4. Active fight — shotcall the NEXT action ──
  if (phase === "teamfight" || phase === "skirmish" || phase === "winning") {
    // Winning fight with bodies down: finish + convert in one breath
    if ((phase === "winning" || man >= 1) && deadStr && focus) {
      if (role === "CARRY") {
        return {
          line: clip(`${c}: ${deadStr} down — DPS ${focus} max range, then tower.`),
          score: 94,
          why: "adc win fight",
        };
      }
      if (role === "SUPPORT") {
        return {
          line: clip(`${c}: ${deadStr} down — zone ${focus}, keep ADC alive, then plates.`),
          score: 93,
          why: "sup win fight",
        };
      }
      if (role === "JUNGLE") {
        return {
          line: clip(`${c}: ${deadStr} down — collapse ${focus}, then YOU start obj.`),
          score: 95,
          why: "jg win fight",
        };
      }
      // mid/flex — kit opener
      if (opener) {
        return {
          line: clip(
            `${c}: ${deadStr} down — ${opener} ${focus}, then plates. Don't overstay.`
          ),
          score: 95,
          why: "mid win fight kit",
        };
      }
      return {
        line: clip(`${c}: ${deadStr} down — finish ${focus}, take tower. No fog.`),
        score: 94,
        why: "win fight generic",
      };
    }

    // Even/skirmish teamfight
    if (role === "SUPPORT") {
      const carry = a.fedAllies[0]?.split("(")[0] || "ADC";
      return {
        line: clip(
          threat
            ? `${c}: bodyblock for ${carry}. ${threat} is hunting — you are the wall.`
            : `${c}: peel ${carry}. Face-checking is not your job.`
        ),
        score: 92,
        why: "sup teamfight",
      };
    }
    if (role === "CARRY") {
      return {
        line: clip(
          threat
            ? `${c}: max range only. ${threat} wants you first — don't gift it.`
            : `${c}: attack what's free. Never flash first in a 50/50.`
        ),
        score: 91,
        why: "adc teamfight",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(
          focus
            ? `${c}: path ${focus}. Flash only if the kill is free.`
            : `${c}: hit highest value in range. No random smite fights.`
        ),
        score: 92,
        why: "jg teamfight",
      };
    }
    // mid
    if (opener && focus) {
      return {
        line: clip(
          `${c}: ${opener} on ${focus} — if they turn, you leave. Secondary only.`
        ),
        score: 93,
        why: "mid teamfight kit",
      };
    }
    if (focus) {
      return {
        line: clip(`${c}: secondary on ${focus}. First-in is how you int this.`),
        score: 90,
        why: "mid teamfight",
      };
    }
  }

  // ── 5. Green board, no active brawl — pure convert ──
  if (a.fightLight === "green" && deadStr) {
    if (role === "JUNGLE") {
      return {
        line: clip(`${c}: ${deadStr} ${respTag} — set the obj. You're the tempo.`),
        score: 90,
        why: "green jg",
      };
    }
    return {
      line: clip(
        g >= 1300 && !noRecall
          ? `${c}: ${deadStr} ${respTag} — plates then base ${g}g.`
          : `${c}: ${deadStr} ${respTag} — plates/obj. Free map, take it.`
      ),
      score: 90,
      why: "green convert",
    };
  }

  // ── 6. Sitting on a buy while soft ──
  if (!noRecall && g >= 1400 && hp != null && hp < 55 && phase === "idle") {
    return {
      line: clip(`${c}: ${g}g at ${hp}% — crash one wave, base. Stop walking a shutdown.`),
      score: 78,
      why: "gold sit soft",
    };
  }

  // ── 7. Threat respect out of fight ──
  if (threat && a.enemiesUltUnlockedAlive.includes(threat) && (hp == null || hp < 50)) {
    return {
      line: clip(`${c}: ${threat} ult unlocked and you're soft — don't walk up first.`),
      score: 68,
      why: "ult respect soft",
    };
  }

  return null;
}

/** Always expand to full human sentences (friend + bro). */
export function polishShotcall(line: string, personality: CoachPersonality): string {
  let s = line.trim();
  s = s
    .replace(/\bbest option is\b/gi, "")
    .replace(/\bgreen light\b/gi, "")
    .replace(/\bKeep your head\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return toNaturalTalk(s, personality, { seed: words(s) });
}
