/**
 * Combat intelligence from legal Live Client events + scoreboard.
 * Powers death coaching, fight green/red lights, and convert callouts.
 */

import type { GameContext, GameEvent, PlayerScoreline } from "./index.js";
import { buildFieldState, type FieldState } from "./fieldState.js";
import { getChampKit } from "./champKnowledge.js";

export type FightLight = "green" | "yellow" | "red";

export interface KillFeedItem {
  gameTime: number;
  killer?: string;
  victim?: string;
  /** Raw event message */
  raw: string;
}

export interface CombatIntel {
  /** Parsed recent kills (newest last) */
  killFeed: KillFeedItem[];
  /** Most recent kill involving anyone */
  lastKill: KillFeedItem | null;
  /** If you just died, best-effort killer from feed */
  yourLastKiller: string | null;
  /** Enemies that died in last ~45s of game clock */
  recentEnemyDeaths: string[];
  /** Allies that died in last ~45s */
  recentAllyDeaths: string[];
  /** Estimated remaining respawn for first dead enemy (heuristic) */
  enemyRespawnEstSec: number | null;
  /** Green / yellow / red fight recommendation */
  fightLight: FightLight;
  fightReason: string;
  /** One convert line when green */
  convertLine: string | null;
  /** One hold line when red */
  holdLine: string | null;
  field: FieldState | null;
  /** Dense AI block */
  summaryLines: string[];
}

function teamOfYou(ctx: GameContext): "ORDER" | "CHAOS" | "UNKNOWN" {
  const you = ctx.you;
  if (!you) return "UNKNOWN";
  return (
    ctx.scoreboard.find(
      (p) =>
        p.championName === you.championName &&
        p.kills === you.kills &&
        p.deaths === you.deaths
    )?.team ||
    ctx.scoreboard.find((p) => p.championName === you.championName)?.team ||
    "UNKNOWN"
  );
}

function champSet(scoreboard: PlayerScoreline[]): Map<string, PlayerScoreline> {
  const m = new Map<string, PlayerScoreline>();
  for (const p of scoreboard) {
    m.set(p.championName.toLowerCase(), p);
    // also bare keys without spaces
    m.set(p.championName.replace(/\s+/g, "").toLowerCase(), p);
  }
  return m;
}

/** Parse "ChampionKill: X → Y" style messages */
export function parseKillEvent(e: GameEvent): KillFeedItem | null {
  if (e.type !== "DEATH" && !/kill|blood/i.test(e.message || "")) {
    // still try payload
  }
  const msg = e.message || "";
  const raw = msg || e.type;
  let killer: string | undefined;
  let victim: string | undefined;

  // "ChampionKill: Name → Name" or "X → Y"
  const arrow = msg.match(/([^:>\n]+?)\s*→\s*([^(\n]+)/);
  if (arrow) {
    killer = cleanName(arrow[1].replace(/.*:/, ""));
    victim = cleanName(arrow[2]);
  } else if (e.payload) {
    const p = e.payload as Record<string, unknown>;
    killer = cleanName(String(p.KillerName || p.killerName || ""));
    victim = cleanName(String(p.VictimName || p.victimName || ""));
  }

  if (!killer && !victim && e.type !== "DEATH") return null;
  return { gameTime: e.gameTime, killer: killer || undefined, victim: victim || undefined, raw };
}

function cleanName(s: string): string {
  return s
    .replace(/ChampionKill/gi, "")
    .replace(/#\w+/g, "")
    .replace(/\(.*?\)/g, "")
    .trim();
}

function estimateRespawnSec(level: number, gameTime: number): number {
  // Rough SR formula approximation: base grows with time + level
  const base = 10 + level * 2.5;
  const timeAdd = Math.min(30, Math.floor(gameTime / 60) * 1.2);
  return Math.round(Math.min(60, base + timeAdd));
}

export function buildCombatIntel(ctx: GameContext): CombatIntel | null {
  if (!ctx.inGame) return null;
  const field = buildFieldState(ctx);
  const team = teamOfYou(ctx);
  const youName = ctx.you?.championName || "";
  const byName = champSet(ctx.scoreboard);

  const killFeed: KillFeedItem[] = [];
  for (const e of ctx.recentEvents || []) {
    const k = parseKillEvent(e);
    if (k) killFeed.push(k);
  }

  const lastKill = killFeed.length ? killFeed[killFeed.length - 1] : null;

  let yourLastKiller: string | null = null;
  if (ctx.you?.isDead || (lastKill && namesMatch(lastKill.victim, youName))) {
    for (let i = killFeed.length - 1; i >= 0; i--) {
      if (namesMatch(killFeed[i].victim, youName) && killFeed[i].killer) {
        yourLastKiller = killFeed[i].killer || null;
        break;
      }
    }
  }

  const window = 45;
  const t = ctx.gameTime;
  const recentEnemyDeaths: string[] = [];
  const recentAllyDeaths: string[] = [];

  for (const k of killFeed) {
    if (t - k.gameTime > window || t - k.gameTime < -2) continue;
    if (!k.victim) continue;
    const p = resolvePlayer(k.victim, byName);
    if (!p) continue;
    if (team !== "UNKNOWN" && p.team !== team && p.team !== "UNKNOWN") {
      if (!recentEnemyDeaths.includes(p.championName)) recentEnemyDeaths.push(p.championName);
    } else if (team !== "UNKNOWN" && p.team === team) {
      if (!recentAllyDeaths.includes(p.championName)) recentAllyDeaths.push(p.championName);
    }
  }

  // Also use current dead list if feed is thin
  if (field) {
    for (const n of field.enemiesDead) {
      if (!recentEnemyDeaths.includes(n)) recentEnemyDeaths.push(n);
    }
    for (const n of field.alliesDead) {
      if (n !== youName && !recentAllyDeaths.includes(n)) recentAllyDeaths.push(n);
    }
  }

  let enemyRespawnEstSec: number | null = null;
  if (field?.enemiesDead[0]) {
    const deadP = ctx.scoreboard.find((p) => p.championName === field.enemiesDead[0]);
    if (deadP) enemyRespawnEstSec = estimateRespawnSec(deadP.level, ctx.gameTime);
  }

  const man = field?.manAdvantage ?? 0;
  const hp = ctx.you
    ? ctx.you.maxHealth && ctx.you.currentHealth != null
      ? (ctx.you.currentHealth / ctx.you.maxHealth) * 100
      : 100
    : 100;
  const gold = ctx.you?.currentGold ?? 0;
  const c = youName || "You";

  let fightLight: FightLight = "yellow";
  let fightReason = "Even board — only take high-% angles.";
  let convertLine: string | null = null;
  let holdLine: string | null = null;

  if (ctx.you?.isDead) {
    fightLight = "red";
    fightReason = "You are dead — next spawn plan only.";
    holdLine = yourLastKiller
      ? `${c}: next spawn respect ${yourLastKiller} — don't repeat the same entry.`
      : `${c}: next spawn wave first; wait for two allies before re-fighting.`;
  } else if (hp < 28) {
    fightLight = "red";
    fightReason = "Critical HP — reset or max range only.";
    holdLine = `${c}: ${Math.round(hp)}% HP — leave or max range; don't all-in.`;
  } else if (man <= -2 || (field && field.alliesDead.length >= 2)) {
    fightLight = "red";
    fightReason = `Numbers down (${man}).`;
    const dead = field?.alliesDead.slice(0, 2).join(" and ") || "allies";
    holdLine = `${c}: ${dead} down — red light; hold tower, wait spawns.`;
  } else if (man >= 2 || (field && field.enemiesDead.length >= 2)) {
    fightLight = "green";
    fightReason = `Man advantage ${man >= 0 ? "+" : ""}${man}.`;
    const dead = field?.enemiesDead.slice(0, 2).join(" and ") || "enemies";
    const resp = enemyRespawnEstSec ? ` ~${enemyRespawnEstSec}s` : "";
    convertLine = `${c}: ${dead} down${resp} — green light plates or obj, not ego chase.`;
  } else if (man >= 1 && hp >= 55) {
    fightLight = "green";
    fightReason = "Slight numbers + healthy.";
    convertLine = `${c}: ${field ? `${field.alliesAlive.length}v${field.enemiesAlive.length}` : "numbers up"} — short fight or shove, then move.`;
  } else if (
    field?.priorityThreats[0] &&
    field.enemiesUltUnlockedAlive.some((n) => field.priorityThreats[0].startsWith(n))
  ) {
    fightLight = "yellow";
    const threat = field.priorityThreats[0].split(" ")[0];
    fightReason = `${threat} ult unlocked and alive.`;
    holdLine = `${c}: ${threat} ult unlocked — no free walk-up; wait for peel/numbers.`;
  } else if (gold >= 1600 && hp < 60) {
    fightLight = "yellow";
    fightReason = "Big gold + soft HP — base competes with fight.";
    holdLine = `${c}: ${Math.round(gold)}g — crash then base before the next skirmish.`;
  }

  // Threat-aware yellow when fed enemy alive and even numbers
  if (fightLight === "yellow" && field?.priorityThreats[0] && man <= 0) {
    const threat = field.priorityThreats[0].split(" ")[0];
    const kit = getChampKit(threat);
    fightReason = kit
      ? `Respect ${threat} (${kit.identity.split("—")[0].trim()}).`
      : `Respect ${threat}.`;
  }

  const summaryLines = [
    `FIGHT_LIGHT: ${fightLight.toUpperCase()} — ${fightReason}`,
    convertLine ? `CONVERT: ${convertLine}` : "",
    holdLine ? `HOLD: ${holdLine}` : "",
    yourLastKiller ? `YOUR_LAST_KILLER: ${yourLastKiller}` : "",
    recentEnemyDeaths.length
      ? `RECENT_ENEMY_DEATHS: ${recentEnemyDeaths.join(", ")}`
      : "RECENT_ENEMY_DEATHS: none",
    recentAllyDeaths.length ? `RECENT_ALLY_DEATHS: ${recentAllyDeaths.join(", ")}` : "",
    enemyRespawnEstSec != null ? `ENEMY_RESPAWN_EST_SEC: ~${enemyRespawnEstSec}` : "",
    lastKill
      ? `LAST_KILL: t=${Math.floor(lastKill.gameTime)} ${lastKill.killer || "?"} → ${lastKill.victim || "?"}`
      : "",
  ].filter(Boolean);

  return {
    killFeed: killFeed.slice(-12),
    lastKill,
    yourLastKiller,
    recentEnemyDeaths,
    recentAllyDeaths,
    enemyRespawnEstSec,
    fightLight,
    fightReason,
    convertLine,
    holdLine,
    field,
    summaryLines,
  };
}

function namesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.replace(/\s+/g, "").toLowerCase();
  const nb = b.replace(/\s+/g, "").toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
}

function resolvePlayer(
  name: string,
  byName: Map<string, PlayerScoreline>
): PlayerScoreline | undefined {
  const k = name.replace(/\s+/g, "").toLowerCase();
  return byName.get(name.toLowerCase()) || byName.get(k);
}

export function formatCombatIntelForAi(intel: CombatIntel | null): string {
  if (!intel) return "";
  return ["## Combat intel", ...intel.summaryLines.map((l) => `- ${l}`)].join("\n");
}
