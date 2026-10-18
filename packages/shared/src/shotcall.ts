/**
 * Shotcall synthesizer — what a top coach would do:
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
  // Riot policy: no respawn countdowns (seconds-to-act). Just say how many are dead.
  const deadCount = a.enemyDeadNames.length;
  const respTag = deadCount > 0 ? `(${deadCount} enem${deadCount === 1 ? "y" : "ies"} dead)` : "";
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
          ? `${c}: ${hp}% HP holding ${g}g — max range or backing off are options.`
          : `${c}: ${hp}% HP — engaging at this HP is risky; backline is an option.`;
      return {
        line: clip(line),
        score: 98,
        why: "critical HP ARAM/no-recall",
      };
    }
    const line =
      g >= 700
        ? `${c}: low HP (${hp}%) and ${g} unspent. Base is an option.`
        : `${c}: ${hp}% HP — staying on the wave is risky; leaving it is an option.`;
    return { line: clip(line), score: 98, why: "critical HP SR" };
  }

  // ── 2. Ace / cleanup — convert is the IQ play ──
  if (phase === "cleanup" || (man >= 4 && dead.length >= 2) || a.enemy.alive === 0) {
    if (noRecall) {
      return {
        line: clip(`${c}: their side is dead — pushing for plates is an option.`),
        score: 95,
        why: "ace convert ARAM",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(
          deadStr
            ? `${c}: ${deadStr} dead ${respTag} — an objective, camps, or a gank are options.`
            : `${c}: map is open — the objective or camps are options.`
        ),
        score: 96,
        why: "jg post-fight obj",
      };
    }
    const line =
      g >= 1400 && man >= 3
        ? `${c}: ${deadStr || "they're"} dead ${respTag} — a tower or a base with ${g}g are options.`
        : `${c}: ${deadStr || "they're"} dead ${respTag} — plates, inhib, or an objective are options.`;
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
            ? `${c}: ${threat} is the fed threat near ${carry} — peeling or backing off are options.`
            : `${c}: fight is ${a.team.alive}v${a.enemy.alive} — peeling ${carry} or backing off are options.`
        ),
        score: 93,
        why: "support losing peel",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(`${c}: ${a.team.alive}v${a.enemy.alive} against you — backing off or farming the opposite side are options.`),
        score: 92,
        why: "jg lose path",
      };
    }
    const line = threat
      ? `${c}: ${a.team.alive}v${a.enemy.alive} — ${threat} is the fed threat here; staying or backing off is your call.`
      : `${c}: ${a.team.alive}v${a.enemy.alive} against you — disengaging is an option.`;
    return { line: clip(line), score: 94, why: "losing disengage" };
  }

  // ── 4. Active fight — shotcall the NEXT action ──
  if (phase === "teamfight" || phase === "skirmish" || phase === "winning") {
    // Winning fight with bodies down: finish + convert in one breath
    if ((phase === "winning" || man >= 1) && deadStr && focus) {
      if (role === "CARRY") {
        return {
          line: clip(`${c}: ${deadStr} dead — ${focus} is the lowest-HP/fed threat in this fight; the tower is also open.`),
          score: 94,
          why: "adc win fight",
        };
      }
      if (role === "SUPPORT") {
        return {
          line: clip(`${c}: ${deadStr} dead — ${focus} is the lowest-HP/fed threat in this fight; zoning or peeling are options.`),
          score: 93,
          why: "sup win fight",
        };
      }
      if (role === "JUNGLE") {
        return {
          line: clip(`${c}: ${deadStr} dead — ${focus} is the lowest-HP/fed threat in this fight; an objective is also open.`),
          score: 95,
          why: "jg win fight",
        };
      }
      // mid/flex — kit opener
      if (opener) {
        return {
          line: clip(
            `${c}: ${deadStr} dead — ${focus} is the lowest-HP/fed threat in this fight; ${opener} is in your kit.`
          ),
          score: 95,
          why: "mid win fight kit",
        };
      }
      return {
        line: clip(`${c}: ${deadStr} dead — ${focus} is the lowest-HP/fed threat in this fight; the tower is also open.`),
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
            ? `${c}: ${threat} is the fed threat and ${carry} is your carry — peel or zone are options.`
            : `${c}: teamfight — peeling ${carry} or zoning are options.`
        ),
        score: 92,
        why: "sup teamfight",
      };
    }
    if (role === "CARRY") {
      return {
        line: clip(
          threat
            ? `${c}: ${threat} is the fed threat in this fight; your range vs them matters.`
            : `${c}: even fight — your position decides what's safe to hit.`
        ),
        score: 91,
        why: "adc teamfight",
      };
    }
    if (role === "JUNGLE") {
      return {
        line: clip(
          focus
            ? `${c}: ${focus} is the lowest-HP/fed threat in this fight.`
            : `${c}: several targets in range — HP and threat level are the variables.`
        ),
        score: 92,
        why: "jg teamfight",
      };
    }
    // mid
    if (opener && focus) {
      return {
        line: clip(
          `${c}: ${focus} is the lowest-HP/fed threat in this fight; ${opener} is in your kit.`
        ),
        score: 93,
        why: "mid teamfight kit",
      };
    }
    if (focus) {
      return {
        line: clip(`${c}: ${focus} is the lowest-HP/fed threat in this fight.`),
        score: 90,
        why: "mid teamfight",
      };
    }
  }

  // ── 5. Green board, no active brawl — pure convert ──
  if (a.fightLight === "green" && deadStr) {
    if (role === "JUNGLE") {
      return {
        line: clip(`${c}: ${deadStr} dead ${respTag} — an objective or camps are options.`),
        score: 90,
        why: "green jg",
      };
    }
    return {
      line: clip(
        g >= 1300 && !noRecall
          ? `${c}: ${deadStr} dead ${respTag} — plates or a base with ${g}g are options.`
          : `${c}: ${deadStr} dead ${respTag} — plates or an objective are options.`
      ),
      score: 90,
      why: "green convert",
    };
  }

  // ── 6. Sitting on a buy while soft ──
  if (!noRecall && g >= 1400 && hp != null && hp < 55 && phase === "idle") {
    return {
      line: clip(`${c}: ${g}g unspent at ${hp}% HP — base is an option.`),
      score: 78,
      why: "gold sit soft",
    };
  }

  // ── 7. Threat respect out of fight ──
  if (threat && a.enemiesUltUnlockedAlive.includes(threat) && (hp == null || hp < 50)) {
    return {
      line: clip(`${c}: ${threat} is level 6+ with ult unlocked and you're at ${hp ?? "low"}% HP — worth knowing before you walk up.`),
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
