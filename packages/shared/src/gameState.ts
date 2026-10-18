/**
 * Deterministic game-state analysis (pure). The model only phrases these facts.
 * Everything here is derived from scoreboard-visible data (items, levels, alive
 * state, objective events). No hidden-info tracking, no enemy cooldowns.
 */
import type { GameContext, GameEvent, PlayerScoreline } from "./index.js";
import {
  buildMatchupCard,
  getChampion,
  getItem,
  isCompletedItem,
  normKey,
  type MatchupCard,
} from "./knowledge.js";

export type Team = "ORDER" | "CHAOS";
export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export function normRole(r: string | undefined | null): Role | null {
  const s = String(r ?? "").toUpperCase();
  if (s.startsWith("TOP")) return "TOP";
  if (s.startsWith("JUNG") || s === "JG") return "JUNGLE";
  if (s.startsWith("MID")) return "MIDDLE";
  if (s.startsWith("BOT") || s === "ADC" || s === "CARRY") return "BOTTOM";
  if (s.startsWith("SUP") || s === "UTILITY") return "UTILITY";
  return null;
}

export function playerItems(p: { items?: string[]; itemIds?: number[] }): (string | number)[] {
  return p.itemIds?.length ? p.itemIds : p.items ?? [];
}

/** Your team from the scoreboard (matches champion + KDA). */
export function teamOf(ctx: GameContext): Team | null {
  const y = ctx.you;
  if (!y) return null;
  const hit =
    ctx.scoreboard.find((p) => p.championName === y.championName && p.kills === y.kills && p.deaths === y.deaths) ||
    ctx.scoreboard.find((p) => normKey(p.championName) === normKey(y.championName));
  return hit && hit.team !== "UNKNOWN" ? hit.team : null;
}

function isYou(ctx: GameContext, p: PlayerScoreline): boolean {
  return !!ctx.you && normKey(p.championName) === normKey(ctx.you.championName);
}

// ---------------------------------------------------------------- gold

/** Gold value of a set of items (Data Dragon total cost). Unknown items count 0. */
export function itemGoldValue(items: (string | number)[] = []): number {
  let g = 0;
  for (const i of items) g += getItem(i)?.cost ?? 0;
  return g;
}

export interface GoldEstimate {
  ally: number;
  enemy: number;
  /** ally − enemy, item value only (enemy unspent gold is hidden) */
  diff: number;
  label: string;
}

export function estimateTeamGold(ctx: GameContext): GoldEstimate | null {
  const team = teamOf(ctx);
  if (!team) return null;
  let ally = 0;
  let enemy = 0;
  for (const p of ctx.scoreboard) {
    const v = itemGoldValue(playerItems(p));
    if (p.team === team) ally += v;
    else if (p.team !== "UNKNOWN") enemy += v;
  }
  const diff = ally - enemy;
  const k = (n: number) => `${(Math.abs(n) / 1000).toFixed(1)}k`;
  const label = Math.abs(diff) < 1000 ? "even on items" : diff > 0 ? `ahead ~${k(diff)} on items` : `behind ~${k(diff)} on items`;
  return { ally, enemy, diff, label };
}

// ---------------------------------------------------------------- spikes

export interface PlayerSpikeState {
  championName: string;
  team: Team | "UNKNOWN";
  ally: boolean;
  isYou: boolean;
  level: number;
  completed: string[];
  /** 0 below 6, 1 at 6+, 2 at 11+, 3 at 16+ */
  ultRank: number;
}

export interface PowerSpike {
  championName: string;
  ally: boolean;
  isYou: boolean;
  kind: "item" | "level";
  detail: string;
}

export function ultRankForLevel(level: number): number {
  return level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0;
}

export function spikeStates(ctx: GameContext): PlayerSpikeState[] {
  const team = teamOf(ctx);
  return ctx.scoreboard.map((p) => {
    const completed = playerItems(p)
      .map((i) => getItem(i))
      .filter(isCompletedItem)
      .map((it) => it!.name);
    return {
      championName: getChampion(p.championName)?.name ?? p.championName,
      team: p.team,
      ally: !!team && p.team === team,
      isYou: isYou(ctx, p),
      level: p.level,
      completed,
      ultRank: ultRankForLevel(p.level),
    };
  });
}

/** New spikes between two snapshots: finished items, level 6/11/16. */
export function detectPowerSpikes(prev: GameContext | null, cur: GameContext): PowerSpike[] {
  const before = new Map((prev ? spikeStates(prev) : []).map((s) => [normKey(s.championName) + s.team, s]));
  const out: PowerSpike[] = [];
  for (const s of spikeStates(cur)) {
    const b = before.get(normKey(s.championName) + s.team);
    const prevItems = new Set(b?.completed ?? []);
    for (const it of s.completed) {
      if (!b || !prevItems.has(it)) {
        if (!b && !prev) continue; // first snapshot: report via spikeStates, not as "new"
        out.push({ championName: s.championName, ally: s.ally, isYou: s.isYou, kind: "item", detail: `finished ${it}` });
      }
    }
    if (b && s.ultRank > b.ultRank) {
      out.push({ championName: s.championName, ally: s.ally, isYou: s.isYou, kind: "level", detail: `hit level ${s.level}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- objectives

export interface ObjectiveState {
  dragons: { ORDER: string[]; CHAOS: string[] };
  /** Team at 4 dragons (soul) */
  soul: Team | null;
  /** Team at 3 dragons (soul point) */
  soulPoint: Team | null;
  elder: { ORDER: number; CHAOS: number };
  baron: { ORDER: number; CHAOS: number };
  herald: { ORDER: number; CHAOS: number };
  /** Towers LOST per team per lane */
  towersLost: { ORDER: Record<string, number>; CHAOS: Record<string, number> };
  inhibsLost: { ORDER: number; CHAOS: number };
  lastBaronAt: number | null;
  lastDragonAt: number | null;
}

/** Turret_T1_L_03_A → { team: ORDER, lane: top } */
export function parseTurret(id: string): { team: Team; lane: "top" | "mid" | "bot" | "base" } | null {
  const m = /Turret_T([12])_([LCR])_(\d+)/i.exec(id || "");
  if (!m) return null;
  const team: Team = m[1] === "1" ? "ORDER" : "CHAOS";
  const pos = Number(m[3]);
  const lane = m[2] === "L" ? "top" : m[2] === "R" ? "bot" : pos <= 2 && m[2] === "C" && /_0[12]_/.test(id) ? "base" : "mid";
  return { team, lane };
}

function killerTeam(ctx: GameContext, killer: unknown): Team | null {
  const k = String(killer ?? "");
  if (!k) return null;
  if (/_T100|T1_/i.test(k) && /minion|turret/i.test(k)) return "ORDER";
  if (/_T200|T2_/i.test(k) && /minion|turret/i.test(k)) return "CHAOS";
  const p = ctx.scoreboard.find(
    (s) => normKey(s.riotIdGameName) === normKey(k) || normKey(s.riotIdGameName?.split("#")[0]) === normKey(k.split("#")[0]) || normKey(s.championName) === normKey(k)
  );
  return p && p.team !== "UNKNOWN" ? p.team : null;
}

export function objectiveState(ctx: GameContext): ObjectiveState {
  const st: ObjectiveState = {
    dragons: { ORDER: [], CHAOS: [] },
    soul: null,
    soulPoint: null,
    elder: { ORDER: 0, CHAOS: 0 },
    baron: { ORDER: 0, CHAOS: 0 },
    herald: { ORDER: 0, CHAOS: 0 },
    towersLost: { ORDER: {}, CHAOS: {} },
    inhibsLost: { ORDER: 0, CHAOS: 0 },
    lastBaronAt: null,
    lastDragonAt: null,
  };
  const seen = new Set<string>();
  const events: GameEvent[] = [...(ctx.objectiveEvents ?? []), ...ctx.recentEvents];
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const key = `${p.EventID ?? ""}:${e.type}:${Math.round(e.gameTime)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(p.EventName ?? "");
    if (/TurretKilled/i.test(name) || (e.type === "TURRET" && p.TurretKilled)) {
      const t = parseTurret(String(p.TurretKilled ?? ""));
      if (t) st.towersLost[t.team][t.lane] = (st.towersLost[t.team][t.lane] ?? 0) + 1;
      continue;
    }
    if (/InhibKilled/i.test(name)) {
      const id = String(p.InhibKilled ?? "");
      if (/T1/.test(id)) st.inhibsLost.ORDER++;
      else if (/T2/.test(id)) st.inhibsLost.CHAOS++;
      continue;
    }
    const team = killerTeam(ctx, p.KillerName);
    if (e.type === "DRAGON") {
      st.lastDragonAt = e.gameTime;
      const kind = String(p.DragonType ?? "Dragon");
      if (!team) continue;
      if (/elder/i.test(kind)) st.elder[team]++;
      else st.dragons[team].push(kind);
    } else if (e.type === "BARON") {
      st.lastBaronAt = e.gameTime;
      if (team) st.baron[team]++;
    } else if (e.type === "HERALD") {
      if (team) st.herald[team]++;
    }
  }
  for (const t of ["ORDER", "CHAOS"] as const) {
    if (st.dragons[t].length >= 4) st.soul = t;
    else if (st.dragons[t].length === 3 && !st.soulPoint) st.soulPoint = t;
  }
  return st;
}

// ---------------------------------------------------------------- numbers

export interface FightNumbers {
  alliesAlive: number;
  enemiesAlive: number;
  advantage: number;
  label: string;
  deadEnemies: string[];
  deadAllies: string[];
}

export function fightNumbers(ctx: GameContext): FightNumbers | null {
  const team = teamOf(ctx);
  if (!team) return null;
  const allies = ctx.scoreboard.filter((p) => p.team === team);
  const enemies = ctx.scoreboard.filter((p) => p.team !== team && p.team !== "UNKNOWN");
  const a = allies.filter((p) => !(isYou(ctx, p) ? ctx.you?.isDead ?? p.isDead : p.isDead));
  const e = enemies.filter((p) => !p.isDead);
  return {
    alliesAlive: a.length,
    enemiesAlive: e.length,
    advantage: a.length - e.length,
    label: `${a.length}v${e.length}`,
    deadEnemies: enemies.filter((p) => p.isDead).map((p) => p.championName),
    deadAllies: allies.filter((p) => p.isDead).map((p) => p.championName),
  };
}

// ---------------------------------------------------------------- farm

export const FARM_BENCHMARKS: Record<Role, { cs: number; gpm: number }> = {
  TOP: { cs: 7.0, gpm: 390 },
  JUNGLE: { cs: 5.5, gpm: 370 },
  MIDDLE: { cs: 7.5, gpm: 410 },
  BOTTOM: { cs: 8.0, gpm: 420 },
  UTILITY: { cs: 1.2, gpm: 260 },
};

export interface FarmRating {
  role: Role;
  csPerMin: number;
  csTarget: number;
  gpm: number | null;
  gpmTarget: number;
  rating: "behind" | "on pace" | "ahead";
}

export function farmBenchmark(role: Role, creeps: number, gameTimeSec: number, totalGold?: number): FarmRating | null {
  const min = gameTimeSec / 60;
  if (min < 3) return null;
  const b = FARM_BENCHMARKS[role];
  const cspm = Math.round((creeps / min) * 10) / 10;
  const gpm = totalGold ? Math.round(totalGold / min) : null;
  const ratio = cspm / b.cs;
  return {
    role,
    csPerMin: cspm,
    csTarget: b.cs,
    gpm,
    gpmTarget: b.gpm,
    rating: ratio < 0.8 ? "behind" : ratio > 1.1 ? "ahead" : "on pace",
  };
}

/** Role from Live Client position, else champion tags + CS/spells heuristic. */
export function guessRole(ctx: GameContext): Role {
  const y = ctx.you;
  const explicit = normRole(y?.laneRole) ?? normRole(ctx.inferredRole);
  if (explicit) return explicit;
  if (y?.summonerSpells?.some((s) => /smite/i.test(s))) return "JUNGLE";
  const c = getChampion(y?.championName);
  const cspm = y && ctx.gameTime > 180 ? y.creeps / (ctx.gameTime / 60) : 5;
  if (c?.tags[0] === "Support" || (cspm < 2 && ctx.gameTime > 300)) return "UTILITY";
  if (c?.tags[0] === "Marksman") return "BOTTOM";
  if (c?.tags.includes("Mage") || c?.tags[0] === "Assassin") return "MIDDLE";
  return "TOP";
}

function laneOpponent(ctx: GameContext, role: Role): PlayerScoreline | null {
  const team = teamOf(ctx);
  if (!team) return null;
  const enemies = ctx.scoreboard.filter((p) => p.team !== team && p.team !== "UNKNOWN");
  const byPos = enemies.find((p) => normRole(p.laneRole) === role);
  if (byPos) return byPos;
  // Heuristic by champion class when Live Client omits positions.
  const want: Record<Role, string[]> = {
    TOP: ["Fighter", "Tank"], JUNGLE: [], MIDDLE: ["Mage", "Assassin"], BOTTOM: ["Marksman"], UTILITY: ["Support"],
  };
  if (role === "JUNGLE") {
    return enemies.find((p) => p.summonerSpells?.some((s) => /smite/i.test(s))) ?? null;
  }
  return enemies.find((p) => want[role].includes(getChampion(p.championName)?.tags[0] ?? "")) ?? null;
}

// ---------------------------------------------------------------- summary

export interface SituationSummary {
  clock: string;
  phase: "early" | "mid" | "late";
  mode: string;
  role: Role;
  you: {
    champion: string;
    level: number;
    hpPct: number | null;
    gold: number;
    dead: boolean;
    completed: string[];
  } | null;
  gold: GoldEstimate | null;
  numbers: FightNumbers | null;
  objectives: ObjectiveState;
  farm: FarmRating | null;
  matchup: MatchupCard | null;
  /** Visible spike facts (ally + enemy) */
  spikes: string[];
  /** Short, policy-safe fact lines for the model to phrase */
  facts: string[];
}

export function buildSituationSummary(ctx: GameContext, prev: GameContext | null = null): SituationSummary {
  const t = ctx.gameTime;
  const m = Math.floor(t / 60);
  const clock = `${m}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const phase = t < 840 ? "early" : t < 1680 ? "mid" : "late";
  const y = ctx.you;
  const role = guessRole(ctx);
  const team = teamOf(ctx);
  const gold = estimateTeamGold(ctx);
  const numbers = fightNumbers(ctx);
  const objectives = objectiveState(ctx);
  const farm = y ? farmBenchmark(role, y.creeps, t, y.totalGold ?? (itemGoldValue(playerItems(y)) + y.currentGold)) : null;
  const opp = laneOpponent(ctx, role);
  const enemies = ctx.scoreboard.filter((p) => team && p.team !== team && p.team !== "UNKNOWN");
  const matchup = y && enemies.length
    ? buildMatchupCard({
        you: y.championName,
        youItems: playerItems(y),
        opponent: opp?.championName,
        enemies: enemies.map((e) => ({ championName: e.championName, items: playerItems(e) })),
      })
    : null;
  const states = spikeStates(ctx);
  const youState = states.find((s) => s.isYou);
  const spikes: string[] = [];
  for (const s of states) {
    if (s.isYou) continue;
    if (s.completed.length >= 1 && !s.ally) spikes.push(`${s.championName} (enemy) L${s.level}, ${s.completed.length} items: ${s.completed.join(", ")}`);
  }
  for (const sp of detectPowerSpikes(prev, ctx)) {
    spikes.unshift(`NEW: ${sp.isYou ? "you" : `${sp.championName} (${sp.ally ? "ally" : "enemy"})`} ${sp.detail}`);
  }

  const facts: string[] = [];
  const hpPct = y?.maxHealth ? Math.round(((y.currentHealth ?? 0) / y.maxHealth) * 100) : null;
  if (numbers && numbers.advantage !== 0) {
    facts.push(`${numbers.label} alive${numbers.deadEnemies.length ? ` (${numbers.deadEnemies.join(", ")} dead)` : ""}`);
  }
  if (gold) facts.push(`Team ${gold.label}`);
  if (team) {
    const enemyTeam: Team = team === "ORDER" ? "CHAOS" : "ORDER";
    const d = objectives.dragons;
    if (d[team].length || d[enemyTeam].length) facts.push(`Dragons ${d[team].length}-${d[enemyTeam].length}${objectives.soulPoint ? ` (${objectives.soulPoint === team ? "your team" : "enemy"} on soul point)` : ""}${objectives.soul ? ` (${objectives.soul === team ? "your team" : "enemy"} has soul)` : ""}`);
    const lost = (tm: Team) => Object.values(objectives.towersLost[tm]).reduce((a, b) => a + b, 0);
    if (lost(team) || lost(enemyTeam)) facts.push(`Towers taken ${lost(enemyTeam)}-${lost(team)}`);
    if (objectives.baron[team] || objectives.baron[enemyTeam]) facts.push(`Baron ${objectives.baron[team]}-${objectives.baron[enemyTeam]}`);
  }
  if (farm && farm.rating !== "on pace") facts.push(`CS ${farm.csPerMin}/min (${role} benchmark ${farm.csTarget}) — ${farm.rating}`);
  if (y && y.currentGold >= 1300 && !y.isDead) facts.push(`${Math.round(y.currentGold)} gold unspent`);
  if (hpPct != null && hpPct < 35 && !y?.isDead) facts.push(`You at ${hpPct}% HP`);
  for (const n of matchup?.itemNotes ?? []) facts.push(n);

  return {
    clock,
    phase,
    mode: ctx.gameMode,
    role,
    you: y
      ? { champion: getChampion(y.championName)?.name ?? y.championName, level: y.level, hpPct, gold: Math.round(y.currentGold), dead: !!y.isDead, completed: youState?.completed ?? [] }
      : null,
    gold,
    numbers,
    objectives,
    farm,
    matchup,
    spikes: spikes.slice(0, 5),
    facts,
  };
}

/** Compact text (≈ 10 lines) for small local models. */
export function formatSituationSummary(s: SituationSummary): string {
  const L: string[] = [`## SITUATION SUMMARY (computed — phrase it, don't re-analyze)`];
  L.push(`CLOCK ${s.clock} ${s.phase} · ${s.mode} · ROLE ${s.role}`);
  if (s.you) {
    L.push(`YOU ${s.you.champion} L${s.you.level}${s.you.hpPct != null ? ` HP ${s.you.hpPct}%` : ""} gold ${s.you.gold}${s.you.dead ? " DEAD" : ""}${s.you.completed.length ? ` items: ${s.you.completed.join(", ")}` : ""}`);
  }
  if (s.numbers) L.push(`NUMBERS ${s.numbers.label}${s.numbers.deadEnemies.length ? ` · enemy dead: ${s.numbers.deadEnemies.join(", ")}` : ""}${s.numbers.deadAllies.length ? ` · ally dead: ${s.numbers.deadAllies.join(", ")}` : ""}`);
  if (s.gold) L.push(`GOLD (items) ${s.gold.label}`);
  if (s.farm) L.push(`FARM ${s.farm.csPerMin} cs/min vs ${s.farm.csTarget} (${s.farm.rating})${s.farm.gpm ? ` · ${s.farm.gpm} gpm vs ${s.farm.gpmTarget}` : ""}`);
  if (s.matchup) {
    const c = s.matchup;
    L.push(`MATCHUP ${c.you} (${c.youType})${c.opponent ? ` vs ${c.opponent} (${c.opponentType}, ${c.rangeNote ?? ""})` : ""} · enemy AP ${c.threats.AP}/AD ${c.threats.AD}/TANK ${c.threats.TANK} · heal ${c.healers.length} shield ${c.shielders.length}`);
  }
  for (const sp of s.spikes.slice(0, 3)) L.push(`SPIKE ${sp}`);
  if (s.facts.length) L.push(`FACTS: ${s.facts.join(" | ")}`);
  return L.join("\n");
}

/**
 * Policy-safe seed line from the summary: one visible fact + options.
 * Used by localFallbackLine and the training-data generator.
 */
export function summarySeedLine(s: SituationSummary, kind: string): string | null {
  if (!s.you) return null;
  const n = s.numbers;
  const card = s.matchup;
  if (kind === "base" || kind === "item") {
    const note = card?.itemNotes[0];
    if (note && s.you.gold >= 900) return `${s.you.gold} gold unspent. ${note}`;
    if (s.you.gold >= 1300) return `${s.you.gold} gold unspent — basing for the next item is an option if the wave allows it.`;
    return null;
  }
  if ((kind === "kill" || kind === "numbers") && n && n.advantage >= 2) {
    const soul = s.objectives.soulPoint ? " with soul point on the board" : "";
    return `${n.label} with ${n.deadEnemies.slice(0, 2).join(" and ")} dead${soul} — an objective, towers or a reset are all options.`;
  }
  if ((kind === "kill" || kind === "numbers") && n && n.advantage <= -2) {
    return `It's ${n.label} at the moment — holding near tower or clearing a safe wave are options until allies are back.`;
  }
  if (kind === "level_up" && s.you.level === 6) {
    return card?.opponent
      ? `You hit 6 against ${card.opponent} — your all-in got stronger; trading, shoving or roaming are options.`
      : `You hit 6 — trading, shoving or roaming are options.`;
  }
  if (kind === "tempo" || kind === "generic") {
    const enemyBig = s.spikes.find((x) => /NEW: .*\(enemy\) finished/.test(x));
    if (enemyBig) return `${enemyBig.replace(/^NEW: /, "").replace(" (enemy)", "")} — that's a visible spike; fighting around it or playing for vision are options.`;
    if (s.farm?.rating === "behind" && s.phase !== "late") {
      return `You're at ${s.farm.csPerMin} CS a minute against a ${s.farm.csTarget} benchmark — side waves between fights are an option.`;
    }
    if (card?.itemNotes[0]) return card.itemNotes[0];
  }
  return null;
}
