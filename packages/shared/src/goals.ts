/**
 * Session goals + post-game grading.
 * Letter scale mirrors League client: S+ … D (no F).
 * Curves differ by mode family (ranked SR, normal SR, ARAM, Arena, URF).
 */

import {
  detectModeProfile,
  type CoachModeFamily,
} from "./modes.js";
import type { PlayerScoreline } from "./index.js";

export type GoalId =
  | "cs_pace"
  | "deaths_cap"
  | "kda_floor"
  | "survive_early"
  | "kp_floor";

export interface SessionGoal {
  id: GoalId;
  label: string;
  /** Target value depending on goal */
  target: number;
}

export interface GoalResult {
  id: GoalId;
  label: string;
  target: number;
  actual: number;
  passed: boolean;
  detail: string;
}

/** League-style grade letters (client scale). */
export type LolGradeLetter =
  | "S+"
  | "S"
  | "S-"
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D";

export interface MatchGrade {
  letter: LolGradeLetter;
  /** 0–100 performance index used to place the letter */
  score: number;
  summary: string;
  goals: GoalResult[];
  habits: string[];
  modeFamily: CoachModeFamily;
  modeLabel: string;
  /** e.g. "Ranked SR curve · KP/CS/deaths weighted like live" */
  scaleNote: string;
}

/** Default learning objectives (Summoner's Rift / ranked habits). */
export const DEFAULT_GOALS: SessionGoal[] = [
  { id: "cs_pace", label: "Learning: CS pace (per 10)", target: 70 },
  { id: "deaths_cap", label: "Learning: deaths under", target: 5 },
  { id: "survive_early", label: "Learning: deaths before 14:00 under", target: 2 },
];

/** Mode-native checklist for post-game (used when caller doesn't pass custom goals). */
export function goalsForMode(family: CoachModeFamily): SessionGoal[] {
  switch (family) {
    case "SR_RANKED":
      return [
        { id: "cs_pace", label: "CS / 10", target: 70 },
        { id: "deaths_cap", label: "Deaths under", target: 5 },
        { id: "survive_early", label: "Early deaths (pre-14) under", target: 2 },
        { id: "kp_floor", label: "Kill participation", target: 0.45 },
      ];
    case "SR_NORMAL":
    case "SR_UNKNOWN":
      return [
        { id: "cs_pace", label: "CS / 10", target: 65 },
        { id: "deaths_cap", label: "Deaths under", target: 6 },
        { id: "survive_early", label: "Early deaths (pre-14) under", target: 2 },
        { id: "kp_floor", label: "Kill participation", target: 0.4 },
      ];
    case "ARAM":
      return [
        { id: "kp_floor", label: "Kill participation", target: 0.55 },
        { id: "kda_floor", label: "KDA floor", target: 2.0 },
        { id: "deaths_cap", label: "Deaths under", target: 8 },
      ];
    case "ARENA":
      return [
        { id: "kda_floor", label: "KDA floor", target: 1.4 },
        { id: "deaths_cap", label: "Deaths under", target: 6 },
        { id: "kp_floor", label: "Round participation (K+A share)", target: 0.5 },
      ];
    case "URF":
      return [
        { id: "kda_floor", label: "KDA floor", target: 2.5 },
        { id: "deaths_cap", label: "Deaths under", target: 10 },
        { id: "cs_pace", label: "CS / 10", target: 55 },
      ];
    default:
      return [
        { id: "kda_floor", label: "KDA floor", target: 2.0 },
        { id: "deaths_cap", label: "Deaths under", target: 6 },
      ];
  }
}

/** Weights / anchors per mode — calibrated so a solid average game lands ~B. */
interface ModeGradeCurve {
  scaleNote: string;
  /** Weight 0–1 for economy (CS) */
  wCs: number;
  /** Weight for combat (KDA + KP) */
  wCombat: number;
  /** Weight for survivability */
  wSurvive: number;
  /** CS/10 that scores ~80 on economy (A-ish farm) */
  csPer10Good: number;
  /** CS/10 that scores ~55 (mediocre) */
  csPer10Ok: number;
  /** KDA that scores ~80 combat baseline */
  kdaGood: number;
  /** KDA that scores ~50 */
  kdaOk: number;
  /** KP (0–1) that scores ~80 */
  kpGood: number;
  /** Per-death penalty on survive subscore (0–100 scale) */
  deathCost: number;
  /** Per early death extra cost */
  earlyDeathCost: number;
  /** Soft floor for very short games (minutes) before full curve */
  minMinutes: number;
}

function curveFor(family: CoachModeFamily): ModeGradeCurve {
  switch (family) {
    case "SR_RANKED":
      return {
        scaleNote: "Ranked SR · CS, KP, deaths (client-style)",
        wCs: 0.28,
        wCombat: 0.42,
        wSurvive: 0.3,
        csPer10Good: 78,
        csPer10Ok: 58,
        kdaGood: 4.2,
        kdaOk: 2.0,
        kpGood: 0.55,
        deathCost: 7.5,
        earlyDeathCost: 5,
        minMinutes: 12,
      };
    case "SR_NORMAL":
      return {
        scaleNote: "Normal SR · slightly looser than ranked",
        wCs: 0.26,
        wCombat: 0.42,
        wSurvive: 0.32,
        csPer10Good: 72,
        csPer10Ok: 52,
        kdaGood: 3.8,
        kdaOk: 1.8,
        kpGood: 0.5,
        deathCost: 6.5,
        earlyDeathCost: 4.5,
        minMinutes: 12,
      };
    case "SR_UNKNOWN":
      return {
        scaleNote: "Summoner's Rift · default SR curve",
        wCs: 0.27,
        wCombat: 0.42,
        wSurvive: 0.31,
        csPer10Good: 75,
        csPer10Ok: 55,
        kdaGood: 4.0,
        kdaOk: 1.9,
        kpGood: 0.52,
        deathCost: 7,
        earlyDeathCost: 4.5,
        minMinutes: 12,
      };
    case "ARAM":
      // CS is weak signal; KP + not inting + KDA dominate (how ARAM "feels" graded)
      return {
        scaleNote: "ARAM · KP / KDA / deaths (farm de-emphasized)",
        wCs: 0.08,
        wCombat: 0.55,
        wSurvive: 0.37,
        csPer10Good: 45,
        csPer10Ok: 25,
        kdaGood: 3.5,
        kdaOk: 1.6,
        kpGood: 0.65,
        deathCost: 4.2,
        earlyDeathCost: 2.5,
        minMinutes: 8,
      };
    case "ARENA":
      // No waves — pure fight efficiency; deaths per lobby hurt less than ranked SR
      return {
        scaleNote: "Arena · fight KDA & participation (no CS)",
        wCs: 0,
        wCombat: 0.62,
        wSurvive: 0.38,
        csPer10Good: 0,
        csPer10Ok: 0,
        kdaGood: 2.8,
        kdaOk: 1.2,
        kpGood: 0.55,
        deathCost: 5.5,
        earlyDeathCost: 0,
        minMinutes: 5,
      };
    case "URF":
      return {
        scaleNote: "URF · high-kill combat curve",
        wCs: 0.15,
        wCombat: 0.55,
        wSurvive: 0.3,
        csPer10Good: 60,
        csPer10Ok: 40,
        kdaGood: 4.5,
        kdaOk: 2.0,
        kpGood: 0.55,
        deathCost: 3.5,
        earlyDeathCost: 2,
        minMinutes: 8,
      };
    default:
      return {
        scaleNote: "General · balanced combat/survive",
        wCs: 0.15,
        wCombat: 0.5,
        wSurvive: 0.35,
        csPer10Good: 65,
        csPer10Ok: 45,
        kdaGood: 3.5,
        kdaOk: 1.5,
        kpGood: 0.5,
        deathCost: 6,
        earlyDeathCost: 3,
        minMinutes: 10,
      };
  }
}

/**
 * Map 0–100 performance → League letter.
 * Anchored so ~70 ≈ B, ~80 ≈ A, ~90+ ≈ S-range (client-like rarity).
 */
export function scoreToLolLetter(score: number): LolGradeLetter {
  const s = Math.max(0, Math.min(100, score));
  if (s >= 97) return "S+";
  if (s >= 93) return "S";
  if (s >= 89) return "S-";
  if (s >= 85) return "A+";
  if (s >= 80) return "A";
  if (s >= 76) return "A-";
  if (s >= 72) return "B+";
  if (s >= 68) return "B";
  if (s >= 64) return "B-";
  if (s >= 59) return "C+";
  if (s >= 54) return "C";
  if (s >= 48) return "C-";
  return "D";
}

/** Linear map value between lo→hi onto score band. */
function lerpScore(value: number, lo: number, hi: number, scoreLo: number, scoreHi: number): number {
  if (hi <= lo) return scoreLo;
  const t = (value - lo) / (hi - lo);
  return scoreLo + Math.max(0, Math.min(1, t)) * (scoreHi - scoreLo);
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function killParticipation(opts: {
  kills: number;
  assists: number;
  scoreboard?: PlayerScoreline[];
  /** Your team id if known */
  team?: PlayerScoreline["team"];
}): number {
  const ka = opts.kills + opts.assists;
  const board = opts.scoreboard || [];
  if (!board.length) {
    // No board: soft proxy — treat raw K+A as involvement signal
    if (ka <= 0) return 0;
    // ~10 K+A ≈ 50% proxy, ~20 ≈ 80%
    return clamp100(lerpScore(ka, 0, 22, 0, 100)) / 100;
  }

  let team = opts.team;
  if (!team || team === "UNKNOWN") {
    // Infer from player with matching KDA if possible
    const match = board.find(
      (p) => p.kills === opts.kills && p.deaths !== undefined && p.assists === opts.assists
    );
    team = match?.team;
  }
  const allies =
    team && team !== "UNKNOWN"
      ? board.filter((p) => p.team === team)
      : board.slice(0, Math.ceil(board.length / 2));

  const teamKills = allies.reduce((s, p) => s + (p.kills || 0), 0);
  if (teamKills <= 0) return ka > 0 ? 1 : 0;
  // Cap at 100% for display/goals; combat scoring allows slight over-participation noise
  return Math.min(1.15, ka / teamKills);
}

function evaluateGoals(
  goals: SessionGoal[],
  stats: {
    csPer10: number;
    deaths: number;
    earlyDeaths: number;
    kda: number;
    kp: number;
    family: CoachModeFamily;
  }
): GoalResult[] {
  return goals.map((g) => {
    if (g.id === "cs_pace") {
      // ARAM/Arena: CS goal is weak — still report if present
      const actual = Math.round(stats.csPer10 * 10) / 10;
      const passed = actual >= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual,
        passed,
        detail: `${actual} CS/10 (target ${g.target})`,
      };
    }
    if (g.id === "deaths_cap") {
      const passed = stats.deaths <= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual: stats.deaths,
        passed,
        detail: `${stats.deaths} deaths (cap ${g.target})`,
      };
    }
    if (g.id === "survive_early") {
      const passed = stats.earlyDeaths <= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual: stats.earlyDeaths,
        passed,
        detail: `${stats.earlyDeaths} deaths before 14:00 (cap ${g.target})`,
      };
    }
    if (g.id === "kp_floor") {
      const actual = Math.round(stats.kp * 1000) / 1000;
      const pct = Math.round(stats.kp * 100);
      const passed = stats.kp >= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual,
        passed,
        detail: `${pct}% KP (target ${Math.round(g.target * 100)}%)`,
      };
    }
    // kda_floor
    const actual = Math.round(stats.kda * 100) / 100;
    const passed = actual >= g.target;
    return {
      id: g.id,
      label: g.label,
      target: g.target,
      actual,
      passed,
      detail: `KDA ${actual} (target ${g.target})`,
    };
  });
}

function buildHabits(
  family: CoachModeFamily,
  input: {
    deaths: number;
    earlyDeaths: number;
    csPer10: number;
    kda: number;
    kp: number;
    repeatDeathPattern?: string | null;
    letter: LolGradeLetter;
  }
): string[] {
  const habits: string[] = [];
  if (input.repeatDeathPattern) {
    habits.push(`Repeat death loop: ${input.repeatDeathPattern} — subtract that pattern next game.`);
  }

  if (family === "ARAM") {
    if (input.deaths >= 9) {
      habits.push("ARAM: stop solo recommitting — wait for 2+ allies after every death.");
    }
    if (input.kp < 0.45) {
      habits.push("ARAM: low KP — group for waves/fights; don't side-clear while team fights.");
    }
    if (input.kda < 1.5) {
      habits.push("ARAM: poke and chip before all-in; shop spikes on death only.");
    }
  } else if (family === "ARENA") {
    if (input.deaths >= 6) {
      habits.push("Arena: bail lost rounds earlier — reset for next fight with cooldowns.");
    }
    if (input.kda < 1.2) {
      habits.push("Arena: play for round win con (augment/item spike), not every trade.");
    }
  } else if (family === "URF") {
    if (input.deaths >= 10) {
      habits.push("URF: spacing still wins — don't greed when your team is dead.");
    }
  } else {
    // SR
    if (input.deaths >= 6) {
      habits.push("Man advantage first: most throws are low-% into bad numbers.");
    }
    if (input.earlyDeaths >= 3) {
      habits.push("Survive to 14: only high-% with allies/info — comfort with inaction.");
    }
    if (input.csPer10 < 60) {
      habits.push("Logistics: crash before base — high-% gold over ego trades.");
    }
    if (input.kp < 0.4 && input.kda < 3) {
      habits.push("Move for plays: look mid/scuttle/obj when wave is pushed.");
    }
  }

  if (!habits.length) {
    if (input.letter.startsWith("S") || input.letter.startsWith("A")) {
      habits.push("Keep the same standards — convert leads, don't gift shutdowns.");
    } else {
      habits.push("Only high-% plays you can explain (numbers, HP, CDs, allies).");
    }
  }
  if (habits.length < 3) {
    habits.push("Review one structural mistake — not only the final scoreboard.");
  }
  if (habits.length < 3) {
    habits.push("Next game: one sticky learning objective, track it every death/base.");
  }
  return habits.slice(0, 3);
}

export function gradeMatch(input: {
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  gameTimeSec: number;
  earlyDeaths: number;
  goals?: SessionGoal[];
  repeatDeathPattern?: string | null;
  /** Mode detection fields */
  gameMode?: string;
  mapName?: string;
  queueType?: string;
  gameQueueConfigId?: number | string;
  /** Optional scoreboard for real KP */
  scoreboard?: PlayerScoreline[];
  team?: PlayerScoreline["team"];
}): MatchGrade {
  const profile = detectModeProfile({
    gameMode: input.gameMode,
    mapName: input.mapName,
    queueType: input.queueType,
    gameQueueConfigId: input.gameQueueConfigId,
  });
  const family = profile.family;
  const curve = curveFor(family);

  const minutes = Math.max(input.gameTimeSec / 60, 1);
  const csPer10 = (input.creeps / minutes) * 10;
  const kda =
    input.deaths === 0
      ? input.kills + input.assists
      : (input.kills + input.assists) / Math.max(input.deaths, 1);
  const kp = killParticipation({
    kills: input.kills,
    assists: input.assists,
    scoreboard: input.scoreboard,
    team: input.team,
  });

  // --- Sub-scores (0–100), then weighted blend ---
  // Economy
  let economy = 55;
  if (curve.wCs > 0) {
    if (csPer10 >= curve.csPer10Good) {
      economy = lerpScore(csPer10, curve.csPer10Good, curve.csPer10Good * 1.25, 80, 96);
    } else if (csPer10 >= curve.csPer10Ok) {
      economy = lerpScore(csPer10, curve.csPer10Ok, curve.csPer10Good, 55, 80);
    } else {
      economy = lerpScore(csPer10, 0, curve.csPer10Ok, 15, 55);
    }
  } else {
    economy = 70; // unused weight
  }

  // Combat: blend KDA + KP
  let kdaScore: number;
  if (kda >= curve.kdaGood) {
    kdaScore = lerpScore(kda, curve.kdaGood, curve.kdaGood * 2.2, 80, 98);
  } else if (kda >= curve.kdaOk) {
    kdaScore = lerpScore(kda, curve.kdaOk, curve.kdaGood, 50, 80);
  } else {
    kdaScore = lerpScore(kda, 0, curve.kdaOk, 12, 50);
  }
  let kpScore: number;
  if (kp >= curve.kpGood) {
    kpScore = lerpScore(kp, curve.kpGood, 1.0, 80, 96);
  } else {
    kpScore = lerpScore(kp, 0, curve.kpGood, 18, 80);
  }
  // ARAM/Arena lean harder on KP; SR balanced
  const combatMix =
    family === "ARAM" || family === "ARENA"
      ? 0.45 * kdaScore + 0.55 * kpScore
      : 0.55 * kdaScore + 0.45 * kpScore;

  // Survivability
  let survive = 88;
  survive -= input.deaths * curve.deathCost;
  if (family !== "ARENA") {
    survive -= input.earlyDeaths * curve.earlyDeathCost;
  }
  // Clean games boost
  if (input.deaths === 0 && minutes >= curve.minMinutes) survive += 8;
  else if (input.deaths <= 2 && minutes >= curve.minMinutes) survive += 4;
  // Very long games: normalize death cost slightly (more fight volume)
  if (minutes > 40 && family.startsWith("SR")) {
    survive += Math.min(8, (minutes - 40) * 0.4);
  }
  if (family === "ARAM" && minutes > 22) {
    survive += Math.min(6, (minutes - 22) * 0.5);
  }
  survive = clamp100(survive);

  // Normalize weights if CS weight is 0
  let wCs = curve.wCs;
  let wCombat = curve.wCombat;
  let wSurvive = curve.wSurvive;
  const wSum = wCs + wCombat + wSurvive || 1;
  wCs /= wSum;
  wCombat /= wSum;
  wSurvive /= wSum;

  let score = economy * wCs + combatMix * wCombat + survive * wSurvive;

  // Short games: pull toward B- so 3-minute remakes don't S+ or D randomly
  if (minutes < curve.minMinutes) {
    const t = minutes / curve.minMinutes;
    score = score * t + 66 * (1 - t);
  }

  // Tiny goal bonus/penalty (learning checklist — not the main grade driver)
  const goals =
    input.goals && input.goals.length > 0 ? input.goals : goalsForMode(family);
  const results = evaluateGoals(goals, {
    csPer10,
    deaths: input.deaths,
    earlyDeaths: input.earlyDeaths,
    kda,
    kp,
    family,
  });
  const passedCount = results.filter((r) => r.passed).length;
  const goalRatio = results.length ? passedCount / results.length : 0.5;
  score += (goalRatio - 0.5) * 6; // ±3 max influence

  score = Math.round(clamp100(score));
  const letter = scoreToLolLetter(score);

  const habits = buildHabits(family, {
    deaths: input.deaths,
    earlyDeaths: input.earlyDeaths,
    csPer10,
    kda,
    kp,
    repeatDeathPattern: input.repeatDeathPattern,
    letter,
  });

  const kpPct = Math.round(kp * 100);
  const summary = `${letter} (${score}/100) · ${profile.label} · ${input.kills}/${input.deaths}/${input.assists} · ${input.creeps} CS · ${kpPct}% KP · ${passedCount}/${results.length} goals`;

  return {
    letter,
    score,
    summary,
    goals: results,
    habits,
    modeFamily: family,
    modeLabel: profile.label,
    scaleNote: curve.scaleNote,
  };
}
