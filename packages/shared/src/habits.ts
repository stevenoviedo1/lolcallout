/**
 * Cross-game habit memory. Pure logic only: the agent stores the profile at
 * ~/.lolcallout/profile.json on the player's PC. Never sent to the server.
 */
import type { GameContext } from "./index.js";
import { estimateTeamGold, farmBenchmark, guessRole, type Role } from "./gameState.js";
import { normKey } from "./knowledge.js";

export const HIGH_GOLD_DEATH = 1500;
export const PROFILE_MAX_GAMES = 20;

export interface GameHabitRecord {
  endedAt: string;
  champion: string;
  role: Role;
  durationSec: number;
  deaths: number;
  deathsWhileAhead: number;
  deathsBeforeObjective: number;
  deathsAfterObjective: number;
  csPerMin: number;
  csTarget: number;
  controlWardsBought: number;
  /** Deaths with ≥1500 unspent gold */
  highGoldDeaths: number;
  avgGoldAtDeath: number;
}

export type HabitId =
  | "high_gold_deaths"
  | "deaths_while_ahead"
  | "deaths_before_objective"
  | "deaths_after_objective"
  | "low_cs"
  | "low_vision";

export interface Habit {
  id: HabitId;
  /** Games (of the window) where it happened */
  games: number;
  /** Total occurrences in the window */
  count: number;
  window: number;
  score: number;
  line: string;
  fix: string;
}

export interface HabitProfile {
  version: 1;
  games: GameHabitRecord[];
  rolling: {
    games: number;
    avgDeaths: number;
    avgCsPerMin: number;
    avgControlWards: number;
    avgGoldAtDeath: number;
    highGoldDeathsPerGame: number;
    deathsWhileAheadPerGame: number;
    deathsNearObjectivePerGame: number;
  };
  top: Habit[];
  updatedAt: string;
}

export function emptyHabitProfile(): HabitProfile {
  return {
    version: 1,
    games: [],
    rolling: {
      games: 0, avgDeaths: 0, avgCsPerMin: 0, avgControlWards: 0, avgGoldAtDeath: 0,
      highGoldDeathsPerGame: 0, deathsWhileAheadPerGame: 0, deathsNearObjectivePerGame: 0,
    },
    top: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/** Accepts anything JSON-parsed; returns a valid profile. */
export function sanitizeHabitProfile(raw: unknown): HabitProfile {
  const p = raw as Partial<HabitProfile> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.games)) return emptyHabitProfile();
  return recomputeProfile({ ...emptyHabitProfile(), games: p.games.filter((g) => g && typeof g.champion === "string").slice(-PROFILE_MAX_GAMES) });
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

export function computeHabits(games: GameHabitRecord[], window = 5): Habit[] {
  const w = games.slice(-window);
  const n = w.length;
  if (!n) return [];
  const mk = (id: HabitId, per: (g: GameHabitRecord) => number, line: (c: number, g: number) => string, fix: string, weight = 1): Habit => {
    const counts = w.map(per);
    const count = counts.reduce((a, b) => a + b, 0);
    const gamesHit = counts.filter((c) => c > 0).length;
    return { id, games: gamesHit, count, window: n, score: (gamesHit / n) * weight + count / (n * 4), line: line(count, gamesHit), fix };
  };
  const habits = [
    mk("high_gold_deaths", (g) => g.highGoldDeaths,
      (c) => `Last ${n} games you died with ${HIGH_GOLD_DEATH}+ gold ${c} time${c === 1 ? "" : "s"}`,
      "consider basing earlier when you have an item's worth of gold", 1.2),
    mk("deaths_while_ahead", (g) => g.deathsWhileAhead,
      (c, gh) => `You died while your team was ahead ${c} times across ${gh} of your last ${n} games`,
      "with a lead, fights with vision and numbers are the safer way to use it", 1.1),
    mk("deaths_before_objective", (g) => g.deathsBeforeObjective,
      (c) => `${c} deaths in the minute before an objective in your last ${n} games`,
      "being alive and reset before dragon/baron spawns gives your team the numbers", 1.1),
    mk("deaths_after_objective", (g) => g.deathsAfterObjective,
      (c) => `${c} deaths right after an objective in your last ${n} games`,
      "after an objective, resetting or taking safe waves keeps the lead", 0.8),
    mk("low_cs", (g) => (g.csTarget > 2 && g.csPerMin < g.csTarget * 0.8 ? 1 : 0),
      (_c, gh) => `CS/min was below the ${w[w.length - 1].role} benchmark in ${gh} of your last ${n} games (avg ${avg(w.map((g) => g.csPerMin))})`,
      "catching side waves between fights is the easiest gold", 1),
    mk("low_vision", (g) => (g.durationSec > 900 && g.controlWardsBought < 2 ? 1 : 0),
      (_c, gh) => `You bought fewer than 2 control wards in ${gh} of your last ${n} games`,
      "a control ward on each back is cheap map info", 0.9),
  ];
  return habits.filter((h) => h.count > 0 && h.games >= Math.min(2, n)).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function recomputeProfile(p: HabitProfile): HabitProfile {
  const g = p.games;
  const deaths = g.flatMap((x) => (x.deaths ? [x.avgGoldAtDeath] : []));
  return {
    ...p,
    rolling: {
      games: g.length,
      avgDeaths: avg(g.map((x) => x.deaths)),
      avgCsPerMin: avg(g.map((x) => x.csPerMin)),
      avgControlWards: avg(g.map((x) => x.controlWardsBought)),
      avgGoldAtDeath: Math.round(avg(deaths)),
      highGoldDeathsPerGame: avg(g.map((x) => x.highGoldDeaths)),
      deathsWhileAheadPerGame: avg(g.map((x) => x.deathsWhileAhead)),
      deathsNearObjectivePerGame: avg(g.map((x) => x.deathsBeforeObjective + x.deathsAfterObjective)),
    },
    top: computeHabits(g),
  };
}

export function recordGame(p: HabitProfile, rec: GameHabitRecord): HabitProfile {
  return recomputeProfile({ ...p, games: [...p.games, rec].slice(-PROFILE_MAX_GAMES), updatedAt: rec.endedAt });
}

export function formatHabitsForAi(p: HabitProfile | null | undefined): string {
  if (!p || !p.top.length) return "";
  return [
    `## PLAYER HABITS (local, last ${p.top[0].window} games)`,
    ...p.top.map((h, i) => `${i + 1}. ${h.line} — ${h.fix}`),
  ].join("\n");
}

/** One pre-game plan line for champ select. */
export function habitPlanLine(p: HabitProfile | null | undefined): string | null {
  const h = p?.top[0];
  return h ? `${h.line} — ${h.fix}.` : null;
}

// ---------------------------------------------------------------- tracker

interface DeathMark {
  t: number;
  gold: number;
  ahead: boolean;
}

/**
 * Feeds on live GameContext ticks (1 Hz). Purely in-memory until finish().
 */
export class GameHabitTracker {
  private deaths: DeathMark[] = [];
  private lastDeaths = 0;
  private lastGold = 0;
  private wards = 0;
  private lastWardSlots = 0;
  private objectiveTimes: number[] = [];
  private last: GameContext | null = null;

  reset() {
    this.deaths = [];
    this.lastDeaths = 0;
    this.lastGold = 0;
    this.wards = 0;
    this.lastWardSlots = 0;
    this.objectiveTimes = [];
    this.last = null;
  }

  get active(): boolean {
    return !!this.last;
  }

  ingest(ctx: GameContext) {
    const y = ctx.you;
    if (!ctx.inGame || !y) return;
    // Joined mid-game (agent restart): don't count deaths we didn't see.
    if (!this.last) this.lastDeaths = y.deaths;
    if (y.deaths > this.lastDeaths) {
      // Gold at death: Live Client updates after the kill, use the last alive tick too.
      const gold = Math.max(y.currentGold, this.lastGold);
      const g = estimateTeamGold(ctx);
      const ahead = (g?.diff ?? 0) >= 1500 || y.kills - y.deaths >= 3;
      for (let i = this.lastDeaths; i < y.deaths; i++) this.deaths.push({ t: ctx.gameTime, gold, ahead });
    }
    this.lastDeaths = y.deaths;
    if (!y.isDead) this.lastGold = y.currentGold;
    const wardSlots = (y.items ?? []).filter((n) => /control ward/i.test(n)).length + (y.itemIds ?? []).filter((id) => id === 2055).length;
    const slots = Math.max(wardSlots, 0);
    if (slots > this.lastWardSlots) this.wards += slots - this.lastWardSlots;
    this.lastWardSlots = slots;
    for (const e of [...(ctx.objectiveEvents ?? []), ...ctx.recentEvents]) {
      if ((e.type === "DRAGON" || e.type === "BARON" || e.type === "HERALD") && !this.objectiveTimes.some((t) => Math.abs(t - e.gameTime) < 2)) {
        this.objectiveTimes.push(e.gameTime);
      }
    }
    this.last = ctx;
  }

  finish(now = new Date()): GameHabitRecord | null {
    const ctx = this.last;
    const y = ctx?.you;
    if (!ctx || !y || ctx.gameTime < 300) return null;
    const role = guessRole(ctx);
    const farm = farmBenchmark(role, y.creeps, ctx.gameTime);
    const before = this.deaths.filter((d) => this.objectiveTimes.some((t) => t - d.t > 0 && t - d.t <= 60)).length;
    const after = this.deaths.filter((d) => this.objectiveTimes.some((t) => d.t - t >= 0 && d.t - t <= 45)).length;
    return {
      endedAt: now.toISOString(),
      champion: y.championName,
      role,
      durationSec: Math.round(ctx.gameTime),
      deaths: this.deaths.length,
      deathsWhileAhead: this.deaths.filter((d) => d.ahead).length,
      deathsBeforeObjective: before,
      deathsAfterObjective: after,
      csPerMin: farm?.csPerMin ?? 0,
      csTarget: farm?.csTarget ?? 0,
      controlWardsBought: this.wards,
      highGoldDeaths: this.deaths.filter((d) => d.gold >= HIGH_GOLD_DEATH).length,
      avgGoldAtDeath: this.deaths.length ? Math.round(this.deaths.reduce((a, d) => a + d.gold, 0) / this.deaths.length) : 0,
    };
  }
}

export function sameChampion(a: string, b: string) {
  return normKey(a) === normKey(b);
}
