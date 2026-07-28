/**
 * Premium live-match analytics from legal Live Client data.
 * No fog invent — only scoreboard, you-stats, events, death patterns.
 */

import type { ActiveYou, GameContext, GameMode, PlayerScoreline } from "./index.js";
import { phaseForTime } from "./deaths.js";
import { isAramMode, isArenaMode, isNoRecallMode } from "./coachBrief.js";
import { nextCoachAction } from "./coachLines.js";

export type MacroPhase = "early" | "mid" | "late";
export type Pressure = "winning" | "even" | "losing";
export type WinCon =
  | "scale"
  | "snowball"
  | "protect_carry"
  | "pick"
  | "siege"
  | "teamfight"
  | "stabilize"
  | "close_game";

export interface TeamTotals {
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  levels: number;
  alive: number;
  dead: number;
}

export interface MatchAnalytics {
  mode: GameMode;
  aram: boolean;
  arena: boolean;
  noRecall: boolean;
  clockSec: number;
  clockLabel: string;
  phase: MacroPhase;
  /** Approximate minute for objective windows */
  minute: number;

  you: {
    champ: string;
    level: number;
    kda: string;
    cs: number;
    cspm: number;
    gold: number;
    hpPct: number | null;
    isDead: boolean;
    items: string[];
    roleHint: "SUPPORT" | "CARRY" | "JUNGLE" | "FLEX";
    powerSpike: string | null;
  };

  team: TeamTotals;
  enemy: TeamTotals;
  /** Positive = your team ahead on kills */
  killLead: number;
  /** Rough CS lead for you vs avg enemy laner heuristic */
  csLeadVsBoard: number;
  levelLead: number;
  pressure: Pressure;
  pressureScore: number; // -100..100

  fedAllies: string[];
  fedEnemies: string[];
  allyDeadNames: string[];
  enemyDeadNames: string[];

  /** Next objective window labels (SR only, clock-based heuristics) */
  objectiveWindows: string[];
  /** Strategic one-liners for the model */
  insights: string[];
  winCon: WinCon;
  riskFlags: string[];
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
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

function sumTeam(players: PlayerScoreline[]): TeamTotals {
  return {
    kills: players.reduce((s, p) => s + p.kills, 0),
    deaths: players.reduce((s, p) => s + p.deaths, 0),
    assists: players.reduce((s, p) => s + p.assists, 0),
    creeps: players.reduce((s, p) => s + p.creeps, 0),
    levels: players.reduce((s, p) => s + p.level, 0),
    alive: players.filter((p) => !p.isDead).length,
    dead: players.filter((p) => p.isDead).length,
  };
}

function roleHint(you: ActiveYou, mode: GameMode, gameTime: number): MatchAnalytics["you"]["roleHint"] {
  const items = (you.items || []).join(" ").toLowerCase();
  if (/atlas|relic|frostfang|spellthief|watchful|bounty|celestial/.test(items)) return "SUPPORT";
  if (/smite|scorchclaw|mosstomper|gustwalker|scryer|jungle/.test(items)) return "JUNGLE";
  const cspm = gameTime > 60 ? you.creeps / (gameTime / 60) : 0;
  if (mode === "CLASSIC" && gameTime > 180 && cspm < 3.5) return "SUPPORT";
  if (cspm >= 5.5 || you.kills + you.assists >= 5) return "CARRY";
  return "FLEX";
}

function powerSpike(you: ActiveYou): string | null {
  if (you.level === 6) return "level 6 ult spike";
  if (you.level === 11) return "level 11 ult rank";
  if (you.level === 16) return "level 16 max ult";
  const gold = you.currentGold;
  if (gold >= 1300 && gold < 1600) return "near component buy";
  if (gold >= 1600) return "full item/component gold ready";
  const items = (you.items || []).filter(Boolean);
  if (items.length >= 3 && items.length < 4) return "approaching 2-item spike";
  return null;
}

function objectiveWindows(minute: number, mode: GameMode, aram: boolean): string[] {
  if (aram || mode === "ARENA") return [];
  const w: string[] = [];
  // Heuristic windows (not exact API timers — Live Client may not expose all)
  if (minute >= 4 && minute <= 6) w.push("first scuttle / early river fight window");
  if (minute >= 5 && minute < 6) w.push("~5:00 grubs/dragon setup depending on patch map");
  if (minute >= 8 && minute <= 10) w.push("second objective rotation window");
  if (minute >= 14 && minute <= 16) w.push("herald/dragon mid rotate");
  if (minute >= 19 && minute <= 22) w.push("pre-baron / late dragon soul path");
  if (minute >= 25) w.push("baron/elder threat phase — group for next major");
  if (minute % 5 === 0) w.push("wave crash timer — good moment to move");
  return w;
}

function deriveWinCon(a: {
  phase: MacroPhase;
  pressure: Pressure;
  role: MatchAnalytics["you"]["roleHint"];
  aram: boolean;
  killLead: number;
  deaths: number;
}): WinCon {
  if (a.aram) return a.pressure === "losing" ? "stabilize" : "teamfight";
  if (a.phase === "late") return a.pressure === "winning" ? "close_game" : "pick";
  if (a.role === "SUPPORT") return a.pressure === "losing" ? "protect_carry" : "pick";
  if (a.killLead >= 4 || a.pressure === "winning") return a.phase === "early" ? "snowball" : "siege";
  if (a.deaths >= 3 || a.pressure === "losing") return "stabilize";
  if (a.role === "CARRY") return "scale";
  return "teamfight";
}

/** Compute premium analytics snapshot from live context. */
export function computeMatchAnalytics(ctx: GameContext): MatchAnalytics | null {
  if (!ctx.inGame || !ctx.you) return null;
  const you = ctx.you;
  const teamId = teamOfYou(ctx);
  const allies = ctx.scoreboard.filter((p) => p.team === teamId && teamId !== "UNKNOWN");
  const enemies = ctx.scoreboard.filter((p) => p.team !== teamId && p.team !== "UNKNOWN");
  // fallback if team unknown: split by first half
  const allyList = allies.length ? allies : ctx.scoreboard.slice(0, 5);
  const enemyList = enemies.length ? enemies : ctx.scoreboard.slice(5);

  const team = sumTeam(allyList);
  const enemy = sumTeam(enemyList);
  const phase = phaseForTime(ctx.gameTime);
  const minute = Math.floor(ctx.gameTime / 60);
  const aram = isAramMode(ctx);
  const arena = isArenaMode(ctx);
  const killLead = team.kills - enemy.kills;
  const avgEnemyLv = enemyList.length
    ? enemyList.reduce((s, p) => s + p.level, 0) / enemyList.length
    : you.level;
  const levelLead = you.level - avgEnemyLv;
  const avgEnemyCs = enemyList.length
    ? enemyList.reduce((s, p) => s + p.creeps, 0) / enemyList.length
    : you.creeps;
  const csLeadVsBoard = you.creeps - avgEnemyCs;
  const cspm = ctx.gameTime > 60 ? you.creeps / (ctx.gameTime / 60) : 0;
  const hpPct =
    you.maxHealth && you.maxHealth > 0 && you.currentHealth != null
      ? (you.currentHealth / you.maxHealth) * 100
      : null;

  // Pressure score: kills + levels + your personal KDA/gold
  let pressureScore =
    killLead * 12 +
    (team.levels - enemy.levels) * 2 +
    (you.kills - you.deaths) * 6 +
    Math.min(20, you.currentGold / 100) -
    (you.deaths >= 3 ? 15 : 0);
  pressureScore = Math.max(-100, Math.min(100, pressureScore));
  const pressure: Pressure =
    pressureScore >= 18 ? "winning" : pressureScore <= -18 ? "losing" : "even";

  const fed = (list: PlayerScoreline[]) =>
    list
      .filter((p) => p.kills >= 3 && p.kills > p.deaths)
      .sort((a, b) => b.kills - a.kills)
      .map((p) => `${p.championName}(${p.kills}/${p.deaths})`)
      .slice(0, 3);

  const role = roleHint(you, ctx.gameMode, ctx.gameTime);
  const spike = powerSpike(you);
  const objs = objectiveWindows(minute, ctx.gameMode, aram);
  const winCon = deriveWinCon({
    phase,
    pressure,
    role,
    aram,
    killLead,
    deaths: you.deaths,
  });

  const insights: string[] = [];
  insights.push(
    `Pressure ${pressure} (score ${Math.round(pressureScore)}), kill lead ${killLead >= 0 ? "+" : ""}${killLead}.`
  );
  insights.push(
    `You ${you.championName} L${you.level} ${you.kills}/${you.deaths}/${you.assists}, ${cspm.toFixed(1)} CS/m, ${Math.round(you.currentGold)}g pocket.`
  );
  if (levelLead <= -1.5) insights.push(`XP deficit ~${Math.abs(levelLead).toFixed(1)} levels vs enemy avg — stabilize.`);
  if (levelLead >= 1.5) insights.push(`XP advantage ~${levelLead.toFixed(1)} — look to convert.`);
  if (team.dead >= 2) insights.push(`Allies dead: ${team.dead} — play for next wave, not 1vX.`);
  if (enemy.dead >= 2) insights.push(`Enemies dead: ${enemy.dead} — convert plates/obj now.`);
  if (spike) insights.push(`Power spike: ${spike}.`);
  if (objs[0]) insights.push(`Clock window: ${objs[0]}.`);
  if (ctx.deathReport?.dominant) insights.push(`Death habit: ${ctx.deathReport.dominant}.`);
  insights.push(`Win condition now: ${winCon.replace(/_/g, " ")}.`);

  const riskFlags: string[] = [];
  if (hpPct != null && hpPct < 30 && !you.isDead) riskFlags.push("critical_hp");
  if (!isNoRecallMode(ctx) && you.currentGold >= 1500 && !you.isDead) riskFlags.push("gold_in_pocket");
  if (you.deaths >= 3) riskFlags.push("tilt_deaths");
  if (fed(enemyList).length) riskFlags.push("fed_enemy");
  if (team.dead >= 3) riskFlags.push("team_bleeding");

  return {
    mode: ctx.gameMode,
    aram,
    arena,
    noRecall: isNoRecallMode(ctx),
    clockSec: ctx.gameTime,
    clockLabel: fmtClock(ctx.gameTime),
    phase,
    minute,
    you: {
      champ: you.championName,
      level: you.level,
      kda: `${you.kills}/${you.deaths}/${you.assists}`,
      cs: you.creeps,
      cspm,
      gold: Math.round(you.currentGold),
      hpPct,
      isDead: Boolean(you.isDead),
      items: (you.items || []).filter(Boolean).slice(0, 6),
      roleHint: role,
      powerSpike: spike,
    },
    team,
    enemy,
    killLead,
    csLeadVsBoard,
    levelLead,
    pressure,
    pressureScore,
    fedAllies: fed(allyList),
    fedEnemies: fed(enemyList),
    allyDeadNames: allyList.filter((p) => p.isDead).map((p) => p.championName),
    enemyDeadNames: enemyList.filter((p) => p.isDead).map((p) => p.championName),
    objectiveWindows: objs,
    insights,
    winCon,
    riskFlags,
  };
}

/** Dense analytics block for the LLM. */
export function formatAnalyticsForAi(a: MatchAnalytics): string {
  return [
    `ANALYTICS @ ${a.clockLabel} (${a.phase}) mode=${a.mode}${a.aram ? " ARAM" : ""}`,
    `PRESSURE: ${a.pressure} (${Math.round(a.pressureScore)}) killLead=${a.killLead} levelLead=${a.levelLead.toFixed(1)}`,
    `YOU: ${a.you.champ} ${a.you.roleHint} L${a.you.level} ${a.you.kda} CS${a.you.cs} (${a.you.cspm.toFixed(1)}/m) gold=${a.you.gold} HP=${a.you.hpPct != null ? Math.round(a.you.hpPct) + "%" : "?"}`,
    a.you.powerSpike ? `SPIKE: ${a.you.powerSpike}` : "",
    `TEAM: ${a.team.kills}/${a.team.deaths} alive=${a.team.alive} dead=${a.team.dead}`,
    `ENEMY: ${a.enemy.kills}/${a.enemy.deaths} alive=${a.enemy.alive} dead=${a.enemy.dead}`,
    a.fedEnemies.length ? `FED_ENEMY: ${a.fedEnemies.join(", ")}` : "FED_ENEMY: none",
    a.fedAllies.length ? `FED_ALLY: ${a.fedAllies.join(", ")}` : "",
    a.objectiveWindows.length ? `OBJ_WINDOWS: ${a.objectiveWindows.join("; ")}` : "",
    `WIN_CON: ${a.winCon}`,
    a.riskFlags.length ? `RISKS: ${a.riskFlags.join(", ")}` : "",
    "INSIGHTS:",
    ...a.insights.map((i) => `- ${i}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Strategy line for the next 20–40s from analytics alone. */
export function strategyNextAction(a: MatchAnalytics): string {
  const kind = a.you.isDead
    ? "death"
    : a.riskFlags.includes("critical_hp")
      ? "low_hp"
      : a.riskFlags.includes("gold_in_pocket") && !a.noRecall
        ? "base"
        : a.team.dead >= 2 || a.enemy.dead >= 2
          ? "numbers"
          : "wincon_change";
  return nextCoachAction(a, kind);
}
