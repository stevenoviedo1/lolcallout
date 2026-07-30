/**
 * Tactical brain — second-order fight intelligence.
 * Ranks threats, opens combo windows, estimates convert timers,
 * flags shutdown / lead-protect moments. Legal Live Client only.
 */

import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";
import { getChampKit } from "./champKnowledge.js";

export interface ThreatEntry {
  name: string;
  score: number;
  why: string;
}

export interface TacticalBrain {
  /** Enemies ranked by live threat (fed + level + ult + role) */
  threatRank: ThreatEntry[];
  primaryThreat: string | null;
  /** Your kit opener when a fight window is live */
  comboWindow: string | null;
  /** Rough seconds left on convert (enemy respawn estimate) */
  convertSeconds: number | null;
  /** You're a high-value shutdown target */
  shutdownRisk: boolean;
  /** Ahead — protect lead over inventing */
  leadProtect: boolean;
  /** Optional speakable line when tactical edge is high */
  speak: string | null;
  score: number;
  forAi: string;
}

function roleThreatWeight(role: string | undefined): number {
  if (!role) return 0;
  const r = role.toLowerCase();
  if (/assassin|mid assassin/.test(r)) return 14;
  if (/adc|carry|marksman/.test(r)) return 10;
  if (/mage|control/.test(r)) return 8;
  if (/engage|tank|support/.test(r)) return 6;
  if (/jungle/.test(r)) return 7;
  return 4;
}

/**
 * Rank enemy threats from scoreboard + kits (no fog invent).
 */
export function rankThreats(a: MatchAnalytics): ThreatEntry[] {
  const fedSet = new Set(a.fedEnemies.map((f) => f.split("(")[0]));
  // Reconstruct rough enemy list from fed + dead + ult unlocked names
  const names = new Set<string>();
  for (const f of a.fedEnemies) names.add(f.split("(")[0]);
  for (const n of a.enemyDeadNames) names.add(n);
  for (const n of a.enemiesUltUnlockedAlive) names.add(n);
  if (a.battleThreat) names.add(a.battleThreat);
  if (a.battleFocus) names.add(a.battleFocus);
  if (a.yourLastKiller) names.add(a.yourLastKiller);

  const out: ThreatEntry[] = [];
  for (const name of names) {
    if (!name) continue;
    let score = 20;
    const why: string[] = [];
    if (fedSet.has(name)) {
      score += 28;
      why.push("fed");
    }
    if (a.enemiesUltUnlockedAlive.includes(name)) {
      score += 16;
      why.push("ult unlocked");
    }
    if (a.enemyDeadNames.includes(name)) {
      score -= 40;
      why.push("dead");
    }
    if (a.yourLastKiller === name) {
      score += 12;
      why.push("last killer");
    }
    if (a.battleThreat === name || a.battleFocus === name) {
      score += 10;
      why.push("battle focus");
    }
    const kit = getChampKit(name);
    score += roleThreatWeight(kit?.role);
    if (kit?.role) why.push(kit.role.split("/")[0].trim());
    // Level proxy: if enemy team is up, bump slightly
    if (a.levelLead <= -1) score += 4;
    out.push({ name, score, why: why.join(", ") || "board" });
  }
  out.sort((x, y) => y.score - x.score);
  return out.filter((t) => t.score > 0).slice(0, 5);
}

/**
 * Combo window string from your kit when fight is live.
 */
export function comboWindowFor(a: MatchAnalytics): string | null {
  if (a.you.isDead) return null;
  const kit = getChampKit(a.you.champ);
  if (!kit?.combos?.[0]) return null;
  const hot =
    a.battlePhase === "teamfight" ||
    a.battlePhase === "skirmish" ||
    a.battlePhase === "winning" ||
    a.fightLight === "green" ||
    a.battleHeat >= 40;
  if (!hot) return null;
  // Short opener only
  const raw = kit.combos[0];
  const short = raw.split(/[.—]/)[0].trim();
  if (short.length < 6 || short.length > 48) return null;
  return short;
}

/**
 * Full tactical snapshot.
 */
export function computeTacticalBrain(
  a: MatchAnalytics,
  mode: ModeProfile
): TacticalBrain {
  const threatRank = rankThreats(a);
  const primaryThreat =
    threatRank.find((t) => !a.enemyDeadNames.includes(t.name))?.name ||
    threatRank[0]?.name ||
    null;
  const comboWindow = comboWindowFor(a);
  const convertSeconds =
    a.enemy.dead >= 1 && a.enemyRespawnEstSec != null ? a.enemyRespawnEstSec : null;

  const deaths = Number((a.you.kda || "0/0/0").split("/")[1]) || 0;
  const kills = Number((a.you.kda || "0/0/0").split("/")[0]) || 0;
  const shutdownRisk =
    !a.you.isDead &&
    (kills >= 4 || a.you.gold >= 1400 || (a.pressure === "winning" && kills >= 2)) &&
    (a.you.hpPct == null || a.you.hpPct < 55 || a.manAdvantage <= 0);

  const leadProtect =
    !a.you.isDead &&
    a.pressure === "winning" &&
    a.killLead >= 3 &&
    deaths <= kills &&
    a.fightLight !== "green";

  let speak: string | null = null;
  let score = 0;
  const c = a.you.champ;

  // Priority tactical lines (only when they add beyond battle reader)
  if (!a.you.isDead && shutdownRisk && a.you.hpPct != null && a.you.hpPct < 40) {
    const g = a.you.gold;
    speak = mode.noRecall
      ? `${c}: you're a shutdown — max range only${g >= 1000 ? `, ${g}g shop on death` : ""}.`
      : `${c}: you're a shutdown${g >= 800 ? ` + ${g}g` : ""} — leave, don't gift it.`;
    score = 78;
  } else if (!a.you.isDead && leadProtect && primaryThreat && a.manAdvantage < 1) {
    speak = `${c}: lead is real — respect ${primaryThreat}, only force with numbers.`;
    score = 58;
  } else if (
    !a.you.isDead &&
    comboWindow &&
    (a.battlePhase === "teamfight" || a.battlePhase === "skirmish") &&
    a.fightLight !== "red"
  ) {
    const focus = a.battleFocus || primaryThreat;
    speak = focus
      ? `${c}: ${comboWindow} — focus ${focus}.`
      : `${c}: window open — ${comboWindow}.`;
    score = 74;
  } else if (
    !a.you.isDead &&
    convertSeconds != null &&
    convertSeconds <= 25 &&
    a.enemy.dead >= 2 &&
    a.fightLight === "green"
  ) {
    speak = `${c}: ~${convertSeconds}s on dead side — finish plate/obj before spawn.`;
    score = 80;
  }

  const forAi = [
    "## Tactical brain",
    primaryThreat ? `PRIMARY_THREAT: ${primaryThreat}` : "",
    threatRank.length
      ? `THREAT_RANK: ${threatRank.map((t) => `${t.name}(${t.score}:${t.why})`).join(" > ")}`
      : "",
    comboWindow ? `COMBO_WINDOW: ${comboWindow}` : "",
    convertSeconds != null ? `CONVERT_SECONDS: ~${convertSeconds}` : "",
    shutdownRisk ? "SHUTDOWN_RISK: yes — protect yourself / gold" : "",
    leadProtect ? "LEAD_PROTECT: yes — high-% only, no invent" : "",
    speak ? `SPEAK_SEED: ${speak}` : "",
    "INSTRUCTION: Prefer named threats + combo windows over generic fight advice.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    threatRank,
    primaryThreat,
    comboWindow,
    convertSeconds,
    shutdownRisk,
    leadProtect,
    speak,
    score,
    forAi,
  };
}

export function formatTacticalForAi(t: TacticalBrain | null): string {
  if (!t) return "";
  return t.forAi;
}
