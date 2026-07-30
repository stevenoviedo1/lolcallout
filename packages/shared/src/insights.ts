/**
 * Human-like coaching: speak only when insight score clears threshold.
 * No timer filler. Silence is a feature.
 * All spoken lines go through craftCoachLine — never obvious platitudes.
 */

import type { CalloutKind, DetectedSignal, GameContext } from "./index.js";
import { computeMatchAnalytics, type MatchAnalytics, type Pressure, type WinCon } from "./analytics.js";
import { detectModeProfile, type ModeProfile } from "./modes.js";
import { craftCoachLine, polishLine } from "./coachLines.js";
import { computeCoachBrain } from "./coachBrain.js";
import { buildFieldState } from "./fieldState.js";
import { flavorLine, parseCoachPersonality, type CoachPersonality } from "./personality.js";
import {
  emptyMatchMemory,
  updateMatchMemory,
  type MatchMemory,
} from "./matchMemory.js";
import { synthesizeEliteCallouts, pickEliteCallout } from "./eliteCoach.js";

export type InsightKind =
  | CalloutKind
  | "pressure_flip"
  | "wincon_change"
  | "fed_enemy_new"
  | "death_pattern"
  | "gold_sit"
  | "behind_farm"
  | "tempo_flip"
  | "brain_risk"
  | "brain_window"
  | "ult_threat"
  | "field_alert"
  | "lane_pressure"
  | "fight_window"
  | "hold_window"
  | "objective_clock"
  | "battle"
  | "disengage"
  | "focus_fire";

export interface CoachInsight {
  kind: InsightKind;
  score: number;
  /** Why this is worth speaking */
  reason: string;
  /** Local speak line */
  line: string;
  /** Signature for anti-repeat (wincon+job) */
  signature: string;
  severity: "info" | "warn" | "urgent";
}

export interface CoachWatchState {
  lastPressure?: Pressure;
  lastWinCon?: WinCon;
  lastFedEnemies: string[];
  lastDeathDominant: string | null;
  lastGoldBucket: number;
  lastLevel: number;
  lastKills: number;
  lastAssists: number;
  lastAllyDead: number;
  lastEnemyDead: number;
  lastHpBucket: number; // 0=ok 1=soft 2=crit
  seenMatchStart: boolean;
  lastSpokenAt: number;
  lastSignatures: string[];
  /** Gold was high continuously */
  goldHighSince: number | null;
  /** Tempo band for flip detection: owning | even | reacting */
  lastTempo?: string;
  /** Last high-risk kind spoken (anti-spam) */
  lastBrainRiskKind?: string | null;
  /** Last priority threat fingerprint (anti-spam ult callouts) */
  lastThreatSig?: string | null;
  /** Last man-advantage bucket */
  lastManAdv?: number;
  /** Last fight light */
  lastFightLight?: string;
  /** Last objective window minute spoken */
  lastObjMinute?: number;
  /** Last battle phase signature */
  lastBattleSig?: string | null;
}

export function emptyWatchState(): CoachWatchState {
  return {
    lastFedEnemies: [],
    lastDeathDominant: null,
    lastGoldBucket: 0,
    lastLevel: 0,
    lastKills: 0,
    lastAssists: 0,
    lastAllyDead: 0,
    lastEnemyDead: 0,
    lastHpBucket: 0,
    seenMatchStart: false,
    lastSpokenAt: 0,
    lastSignatures: [],
    goldHighSince: null,
    lastTempo: undefined,
    lastBrainRiskKind: null,
    lastThreatSig: null,
    lastManAdv: 0,
    lastFightLight: undefined,
    lastObjMinute: undefined,
    lastBattleSig: null,
  };
}

// Score gate only — no timer filler. Normal is a real coach, not mute.
const THRESHOLD_NORMAL = 24;
const THRESHOLD_QUIET = 42;
const THRESHOLD_TALKATIVE = 16;

export type CoachIntensity = "quiet" | "normal" | "talkative";

export function thresholdFor(intensity: CoachIntensity): number {
  if (intensity === "quiet") return THRESHOLD_QUIET;
  if (intensity === "talkative") return THRESHOLD_TALKATIVE;
  return THRESHOLD_NORMAL;
}

function hpBucket(hp: number | null): number {
  if (hp == null) return 0;
  if (hp < 28) return 2;
  if (hp < 45) return 1;
  return 0;
}

function goldBucket(gold: number, noRecall: boolean): number {
  if (noRecall) return 0;
  if (gold >= 1600) return 3;
  if (gold >= 1300) return 2;
  if (gold >= 900) return 1;
  return 0;
}

function lineFor(
  a: MatchAnalytics,
  kind: string,
  mode: ModeProfile,
  extra?: string,
  preferred?: string
): string {
  const crafted = craftCoachLine(a, kind, mode, extra);
  if (preferred?.trim()) {
    return polishLine(preferred, a, mode);
  }
  return polishLine(crafted, a, mode);
}

/**
 * Detect insights from analytics delta + optional hard signals from agent.
 * Returns sorted by score desc.
 */
export function detectCoachInsights(opts: {
  ctx: GameContext;
  prev: CoachWatchState;
  agentSignals?: DetectedSignal[];
  avoidLines?: string[];
  now?: number;
  personality?: CoachPersonality;
  /** Optional match memory — upgraded in place via returned memory */
  memory?: MatchMemory;
}): {
  insights: CoachInsight[];
  next: CoachWatchState;
  mode: ModeProfile;
  memory: MatchMemory;
  eliteBest: ReturnType<typeof pickEliteCallout>;
} {
  const now = opts.now ?? Date.now();
  const ctx = opts.ctx;
  const prev = opts.prev;
  const personality = parseCoachPersonality(opts.personality);
  const mode = detectModeProfile({
    gameMode: ctx.gameMode,
    mapName: ctx.mapName,
    queueType: (ctx as GameContext & { queueType?: string }).queueType,
  });
  const a = computeMatchAnalytics(ctx);
  const insights: CoachInsight[] = [];
  const next: CoachWatchState = { ...prev, lastFedEnemies: [...prev.lastFedEnemies] };

  let memory = opts.memory || emptyMatchMemory(ctx.you?.championName);
  if (!ctx.inGame || !ctx.you || !a) {
    return {
      insights: [],
      next: emptyWatchState(),
      mode,
      memory: emptyMatchMemory(),
      eliteBest: null,
    };
  }
  memory = updateMatchMemory(memory, ctx, a);

  const you = ctx.you;
  const avoid = opts.avoidLines || [];
  const seed = Math.floor(ctx.gameTime);

  const speakLine = (kind: string, extra?: string, preferred?: string) => {
    const base = lineFor(a, kind, mode, extra, preferred);
    // Rotate variants when avoid would collide
    let line = base;
    if (avoid.some((t) => similar(t, line))) {
      const alt = craftCoachLine(a, kind, mode, `${extra || ""}|alt=${seed}`);
      if (alt && !similar(alt, line)) line = polishLine(alt, a, mode);
    }
    return flavorLine(line, personality, seed);
  };

  // Brain read (additive — enriches LO / scores; never replaces craft path alone)
  let brainLo = "";
  let brainTempo = "";
  let brainFocus = "";
  let brainHighest = "";
  let brainFight = "";
  let topRisk: { kind: string; label: string; fix: string; risk: number } | null = null;
  let topAfford: { id: string; invite: string; strength: number } | null = null;
  try {
    const brain = computeCoachBrain(a);
    brainLo = brain.growth.learningObjective;
    brainTempo = brain.tempo;
    brainFocus = brain.focus;
    brainHighest = brain.highestValue;
    brainFight = brain.fightRole;
    topRisk = brain.mistakeRisks[0]
      ? {
          kind: brain.mistakeRisks[0].kind,
          label: brain.mistakeRisks[0].label,
          fix: brain.mistakeRisks[0].fix,
          risk: brain.mistakeRisks[0].risk,
        }
      : null;
    topAfford = brain.affordances[0] ?? null;
  } catch {
    /* brain optional */
  }

  // --- Hard: match start once ---
  if (!prev.seenMatchStart && ctx.gameTime >= 8 && ctx.gameTime <= 120) {
    next.seenMatchStart = true;
    const openLine = speakLine("match_start");
    insights.push({
      kind: "match_start",
      score: 45,
      reason: "match open — first plan",
      line: brainLo ? `${openLine} LO: ${brainLo}` : openLine,
      signature: `start:${you.championName}:${mode.family}`,
      severity: "info",
    });
  }

  // --- Hard: death (from agent or isDead edge) ---
  for (const s of opts.agentSignals || []) {
    if (s.kind === "death") {
      insights.push({
        kind: "death",
        // Hard floor above any battle/shotcall (elite maps death at 130+)
        score: 120,
        reason: "you died — habit for next spawn",
        line: speakLine("death", ctx.deathReport?.dominant || undefined, s.spokenFallback),
        signature: `death:${you.deaths}:${ctx.deathReport?.dominant || ""}`,
        severity: "urgent",
      });
    }
    if (s.kind === "kill") {
      insights.push({
        kind: "kill",
        score: 70,
        reason: "kill/assist — convert now",
        line: speakLine("kill", undefined, s.spokenFallback),
        signature: `kill:${you.kills}:${you.assists}`,
        severity: "warn",
      });
    }
    if (s.kind === "objective") {
      insights.push({
        kind: "objective",
        score: 75,
        reason: "objective event",
        line: speakLine("objective", undefined, s.spokenFallback),
        signature: `obj:${s.title}:${Math.floor(ctx.gameTime / 30)}`,
        severity: "warn",
      });
    }
    if (s.kind === "low_hp") {
      insights.push({
        kind: "low_hp",
        score: 90,
        reason: "critical HP while alive",
        line: speakLine("low_hp", undefined, s.spokenFallback),
        signature: `hp:crit:${Math.floor(ctx.gameTime / 20)}`,
        severity: "urgent",
      });
    }
    if (s.kind === "base" && !mode.noRecall) {
      insights.push({
        kind: "base",
        score: 65,
        reason: "full buy gold sitting",
        line: speakLine("base", undefined, s.spokenFallback),
        signature: `base:${goldBucket(you.currentGold, false)}`,
        severity: "info",
      });
    }
    if (s.kind === "level_up" && [6, 11, 16].includes(you.level)) {
      insights.push({
        kind: "level_up",
        score: 55,
        reason: `level ${you.level} spike`,
        line: speakLine("level_up", undefined, s.spokenFallback),
        signature: `lvl:${you.level}`,
        severity: "info",
      });
    }
    if (s.kind === "numbers") {
      insights.push({
        kind: "numbers",
        score: 80,
        reason: "numbers swing",
        line: speakLine("numbers", undefined, s.spokenFallback),
        signature: `num:${a.team.dead}:${a.enemy.dead}`,
        severity: "warn",
      });
    }
  }

  // --- Field awareness: ult-unlocked threats, man swings, same-lane ---
  const field = buildFieldState(ctx);
  if (field && !you.isDead) {
    const threatSig = field.priorityThreats.slice(0, 2).join("|");
    if (threatSig && threatSig !== prev.lastThreatSig) {
      const top = field.priorityThreats[0];
      const name = top.split(" ")[0];
      const ultUnlocked = field.enemiesUltUnlockedAlive.includes(name);
      if (ultUnlocked || field.priorityThreats[0]) {
        insights.push({
          kind: "ult_threat",
          score: ultUnlocked ? 64 : 52,
          reason: `priority threat ${name}`,
          line: flavorLine(
            ultUnlocked
              ? `${you.championName}: ${name} alive with ult unlocked — respect R, no free walk-up.`
              : `${you.championName}: ${name} is a priority threat — track them before you force.`,
            personality,
            seed
          ),
          signature: `threat:${name}:${ultUnlocked ? "ult" : "fed"}`,
          severity: "warn",
        });
      }
      next.lastThreatSig = threatSig;
    }

    if (
      Math.abs(field.manAdvantage) >= 2 &&
      field.manAdvantage !== prev.lastManAdv &&
      Math.abs(field.manAdvantage - (prev.lastManAdv || 0)) >= 2
    ) {
      const deadSide =
        field.manAdvantage > 0
          ? field.enemiesDead.slice(0, 2).join(" and ") || "enemies"
          : field.alliesDead.slice(0, 2).join(" and ") || "allies";
      insights.push({
        kind: "field_alert",
        score: 78,
        reason: `man advantage ${field.manAdvantage}`,
        line: flavorLine(
          field.manAdvantage > 0
            ? `${you.championName}: ${deadSide} down — green light plates or obj, not ego chase.`
            : `${you.championName}: ${deadSide} down — red light; hold for spawns.`,
          personality,
          seed
        ),
        signature: `man:${field.manAdvantage}:${field.enemiesDead.length}:${field.alliesDead.length}`,
        severity: "warn",
      });
    }
    next.lastManAdv = field.manAdvantage;

    if (field.sameLaneEnemiesAlive.length && field.enemiesUltUnlockedAlive.length) {
      const laneThreats = field.sameLaneEnemiesAlive.filter((n) =>
        field.enemiesUltUnlockedAlive.includes(n)
      );
      if (laneThreats[0]) {
        insights.push({
          kind: "lane_pressure",
          score: 48,
          reason: `same-lane ult unlocked ${laneThreats[0]}`,
          line: flavorLine(
            `${you.championName}: ${laneThreats.slice(0, 2).join(" + ")} same side, ult unlocked — space the wave.`,
            personality,
            seed
          ),
          signature: `laneult:${laneThreats[0]}:${Math.floor(ctx.gameTime / 45)}`,
          severity: "info",
        });
      }
    }
  }

  // ── Live battle reader (skirmish/teamfight jobs) ──
  if (
    !you.isDead &&
    a.battleLine &&
    a.battlePhase !== "idle" &&
    (a.battleHeat >= 30 ||
      a.battlePhase === "teamfight" ||
      a.battlePhase === "disengage" ||
      a.battlePhase === "winning" ||
      a.battlePhase === "losing")
  ) {
    const bsig = `${a.battlePhase}:${a.battleJob}:${a.battleFocus || ""}:${a.battleThreat || ""}`;
    if (bsig !== prev.lastBattleSig) {
      const sev =
        a.battlePhase === "disengage" || a.battlePhase === "losing"
          ? "urgent"
          : a.battleHeat >= 50
            ? "warn"
            : "info";
      const score =
        a.battlePhase === "disengage"
          ? 95
          : a.battlePhase === "teamfight"
            ? 88
            : a.battlePhase === "losing"
              ? 86
              : a.battlePhase === "winning"
                ? 84
                : 62 + Math.min(20, Math.floor(a.battleHeat / 5));
      insights.push({
        kind:
          a.battlePhase === "disengage"
            ? "disengage"
            : a.battleJob === "focus_carry" || a.battleJob === "focus_threat"
              ? "focus_fire"
              : "battle",
        score,
        reason: `battle ${a.battlePhase}: ${a.battleJob}`,
        line: flavorLine(a.battleLine, personality, seed),
        signature: `battle:${bsig}:${Math.floor(ctx.gameTime / 10)}`,
        severity: sev,
      });
      next.lastBattleSig = bsig;
    }
  } else if (a.battlePhase === "idle") {
    next.lastBattleSig = null;
  }

  // Fight green / red lights from combat intel (analytics layer)
  if (a.fightLight === "green" && prev.lastFightLight !== "green" && !you.isDead) {
    const line =
      a.convertHint ||
      speakLine(
        "numbers",
        undefined,
        `${you.championName}: green light ${a.team.alive}v${a.enemy.alive} — convert now, not ego chase.`
      );
    insights.push({
      kind: "fight_window",
      score: 82,
      reason: `fight green: ${a.fightReason}`,
      line: flavorLine(line, personality, seed),
      signature: `fight:green:${a.enemy.dead}:${a.team.dead}:${Math.floor(ctx.gameTime / 20)}`,
      severity: "warn",
    });
  } else if (
    a.fightLight === "red" &&
    prev.lastFightLight !== "red" &&
    !you.isDead &&
    a.riskFlags.includes("critical_hp") === false
  ) {
    const line =
      a.holdHint ||
      speakLine(
        "numbers",
        undefined,
        `${you.championName}: red light — hold; wait for the high-% window.`
      );
    insights.push({
      kind: "hold_window",
      score: 76,
      reason: `fight red: ${a.fightReason}`,
      line: flavorLine(line, personality, seed),
      signature: `fight:red:${a.team.dead}:${Math.floor(ctx.gameTime / 25)}`,
      severity: "warn",
    });
  }
  next.lastFightLight = a.fightLight;

  // Objective clock windows (SR) — speak once per window
  if (
    !a.aram &&
    !a.arena &&
    a.objectiveWindows[0] &&
    a.minute !== prev.lastObjMinute &&
    [5, 8, 14, 20, 25].includes(a.minute)
  ) {
    const objLine =
      a.fightLight === "green"
        ? `${you.championName}: ${a.objectiveWindows[0]} — numbers good, set up now.`
        : a.fightLight === "red"
          ? `${you.championName}: ${a.objectiveWindows[0]} — don't force alone; crash and wait.`
          : `${you.championName}: ${a.objectiveWindows[0]} — shove first, arrive together.`;
    insights.push({
      kind: "objective_clock",
      score: 50,
      reason: a.objectiveWindows[0],
      line: flavorLine(objLine, personality, seed),
      signature: `objclock:${a.minute}`,
      severity: "info",
    });
    next.lastObjMinute = a.minute;
  }

  // --- Deltas from analytics (soft/hard without agent) ---
  if (a.team.dead >= 2 && a.team.dead > prev.lastAllyDead) {
    insights.push({
      kind: "numbers",
      score: 80,
      reason: `allies dead ${a.team.dead}`,
      line: speakLine("numbers"),
      signature: `num:ally:${a.team.dead}`,
      severity: "warn",
    });
  }
  if (a.enemy.dead >= 2 && a.enemy.dead > prev.lastEnemyDead) {
    insights.push({
      kind: "numbers",
      score: 80,
      reason: `enemies dead ${a.enemy.dead}`,
      line: speakLine("numbers"),
      signature: `num:enemy:${a.enemy.dead}`,
      severity: "warn",
    });
  }
  next.lastAllyDead = a.team.dead;
  next.lastEnemyDead = a.enemy.dead;

  // Kill/assist self-detect if agent missed
  if (you.kills > prev.lastKills || you.assists > prev.lastAssists) {
    if (you.kills > prev.lastKills) {
      insights.push({
        kind: "kill",
        score: 68,
        reason: "you got a kill",
        line: speakLine("kill"),
        signature: `kill:${you.kills}`,
        severity: "warn",
      });
    }
  }
  next.lastKills = you.kills;
  next.lastAssists = you.assists;

  // HP cross into critical — and re-warn if still bleeding after a gap (guide, not spam)
  const hpb = hpBucket(a.you.hpPct);
  const sinceSpeak = now - (prev.lastSpokenAt || 0);
  if (hpb === 2 && prev.lastHpBucket < 2 && !you.isDead) {
    insights.push({
      kind: "low_hp",
      score: 92,
      reason: "HP crossed critical",
      line: speakLine("low_hp"),
      signature: `hp:crit`,
      severity: "urgent",
    });
  } else if (
    hpb === 2 &&
    prev.lastHpBucket === 2 &&
    !you.isDead &&
    sinceSpeak >= 22_000
  ) {
    insights.push({
      kind: "low_hp",
      score: 58,
      reason: "still critical HP — guide reset",
      line: speakLine("low_hp", "sustain"),
      signature: `hp:sustain:${Math.floor(ctx.gameTime / 25)}`,
      severity: "urgent",
    });
  }
  next.lastHpBucket = hpb;

  // Gold sit (SR): first cross into high gold, or sat high >45s
  const gb = goldBucket(you.currentGold, mode.noRecall);
  if (!mode.noRecall && !you.isDead) {
    if (gb >= 2 && prev.lastGoldBucket < 2) {
      insights.push({
        kind: "base",
        score: 62,
        reason: "gold crossed buy threshold",
        line: speakLine("base"),
        signature: `gold:${gb}`,
        severity: "info",
      });
      next.goldHighSince = now;
    } else if (gb >= 2 && prev.goldHighSince && now - prev.goldHighSince > 45_000) {
      insights.push({
        kind: "gold_sit",
        score: 50,
        reason: "sitting on buy gold too long",
        line: speakLine("gold_sit"),
        signature: `goldsit:${Math.floor(now / 60_000)}`,
        severity: "warn",
      });
      next.goldHighSince = now; // reset timer after warn
    } else if (gb < 2) {
      next.goldHighSince = null;
    } else if (gb >= 2 && !prev.goldHighSince) {
      next.goldHighSince = now;
    }
  }
  next.lastGoldBucket = gb;

  // Level spike 6/11/16
  if ([6, 11, 16].includes(you.level) && you.level > prev.lastLevel) {
    insights.push({
      kind: "level_up",
      score: 58,
      reason: `hit ${you.level}`,
      line: speakLine("level_up"),
      signature: `lvl:${you.level}`,
      severity: "info",
    });
  }
  next.lastLevel = you.level;

  // Pressure flip
  if (prev.lastPressure && prev.lastPressure !== a.pressure) {
    insights.push({
      kind: "pressure_flip",
      score: 48,
      reason: `pressure ${prev.lastPressure} → ${a.pressure}`,
      line: speakLine("pressure_flip"),
      signature: `pressure:${a.pressure}`,
      severity: "info",
    });
  }
  next.lastPressure = a.pressure;

  // Win con change
  if (prev.lastWinCon && prev.lastWinCon !== a.winCon) {
    insights.push({
      kind: "wincon_change",
      score: 46,
      reason: `win con → ${a.winCon}`,
      line: speakLine("wincon_change"),
      signature: `wincon:${a.winCon}`,
      severity: "info",
    });
  }
  next.lastWinCon = a.winCon;

  // New fed enemy
  const fedNames = a.fedEnemies.map((f) => f.split("(")[0]);
  const newFed = fedNames.filter((n) => !prev.lastFedEnemies.includes(n));
  if (newFed[0]) {
    insights.push({
      kind: "fed_enemy_new",
      score: 52,
      reason: `${newFed[0]} is fed`,
      line: speakLine("fed_enemy_new"),
      signature: `fed:${newFed[0]}`,
      severity: "warn",
    });
  }
  next.lastFedEnemies = fedNames;

  // Death pattern first time
  const dom = ctx.deathReport?.dominant || null;
  if (dom && dom !== prev.lastDeathDominant) {
    insights.push({
      kind: "death_pattern",
      score: 56,
      reason: "repeat death habit",
      line: speakLine("death_pattern", dom),
      signature: `pattern:${dom}`,
      severity: "warn",
    });
  }
  next.lastDeathDominant = dom;

  // --- Brain-driven soft insights (tempo flip, high risk, strong window) ---
  if (brainTempo && prev.lastTempo && prev.lastTempo !== brainTempo) {
    const flipLine =
      brainTempo === "owning"
        ? lineFor(
            a,
            "pressure_flip",
            mode,
            undefined,
            `${you.championName}: tempo flipped to OWNING — spend lead on towers/obj, not ego kills.`
          )
        : brainTempo === "reacting"
          ? lineFor(
              a,
              "pressure_flip",
              mode,
              undefined,
              `${you.championName}: tempo REACTING — rebuild structure, skip low-% fights.`
            )
          : lineFor(
              a,
              "pressure_flip",
              mode,
              undefined,
              `${you.championName}: tempo even — crash then move first for initiative.`
            );
    insights.push({
      kind: "tempo_flip",
      score: 50,
      reason: `tempo ${prev.lastTempo} → ${brainTempo}`,
      line: flipLine,
      signature: `tempo:${brainTempo}:${Math.floor(ctx.gameTime / 45)}`,
      severity: "info",
    });
  }
  if (brainTempo) next.lastTempo = brainTempo;

  if (topRisk && topRisk.risk >= 62 && topRisk.kind !== prev.lastBrainRiskKind) {
    const riskLine = polishLine(
      `${you.championName}: risk ${topRisk.label.toLowerCase()} — ${topRisk.fix}`,
      a,
      mode
    );
    insights.push({
      kind: "brain_risk",
      score: 44 + Math.min(20, Math.floor((topRisk.risk - 55) / 2)),
      reason: `mistake risk ${topRisk.kind} @${topRisk.risk}`,
      line: riskLine,
      signature: `brainrisk:${topRisk.kind}:${Math.floor(ctx.gameTime / 60)}`,
      severity: topRisk.risk >= 75 ? "warn" : "info",
    });
    next.lastBrainRiskKind = topRisk.kind;
  } else if (!topRisk || topRisk.risk < 50) {
    next.lastBrainRiskKind = null;
  }

  if (
    topAfford &&
    topAfford.strength >= 85 &&
    (topAfford.id === "convert" || topAfford.id === "hold" || topAfford.id === "leave")
  ) {
    const windowLine =
      brainHighest && brainHighest.length > 12
        ? polishLine(`${you.championName}: ${brainHighest}`, a, mode)
        : lineFor(a, "numbers", mode);
    insights.push({
      kind: "brain_window",
      score: 42 + Math.min(18, Math.floor((topAfford.strength - 80) / 2)),
      reason: `affordance ${topAfford.id} @${topAfford.strength}`,
      line: windowLine,
      signature: `brainwin:${topAfford.id}:${Math.floor(ctx.gameTime / 40)}`,
      severity: "info",
    });
  }

  // Filter repeats + score adjustments (+ light brain alignment)
  // (sinceSpeak already computed above for sustained-HP)
  for (const ins of insights) {
    if (prev.lastSignatures.includes(ins.signature)) ins.score -= 45;
    if (avoid.some((t) => similar(t, ins.line))) ins.score -= 55;
    // Stronger anti-repeat: kill near-duplicates even if signature differs
    if (avoid.some((t) => keyPhraseOverlap(t, ins.line) >= 0.65)) ins.score -= 30;
    // Soft dampen chatter right after a line — never hard-mute death / low HP
    if (
      sinceSpeak < 10_000 &&
      ins.kind !== "death" &&
      ins.kind !== "low_hp" &&
      ins.severity !== "urgent"
    ) {
      ins.score -= 22;
    }
    // Nudge insights that match brain focus (additive only)
    if (brainFocus === "numbers" && ins.kind === "numbers") ins.score += 10;
    if (brainFocus === "survive" && ins.kind === "low_hp") ins.score += 12;
    if (brainFocus === "reset" && (ins.kind === "base" || ins.kind === "gold_sit")) ins.score += 10;
    if (brainFocus === "objective" && ins.kind === "objective") ins.score += 10;
    if (brainFocus === "tempo" && (ins.kind === "pressure_flip" || ins.kind === "tempo_flip"))
      ins.score += 8;
    if (brainFocus === "wave" && (ins.kind === "base" || ins.kind === "behind_farm")) ins.score += 6;
    // Prefer convert windows when man advantage
    if (ins.kind === "brain_window" || ins.kind === "numbers") {
      if (brainTempo === "owning") ins.score += 4;
    }
    // Fight-role flavored kill convert
    if (ins.kind === "kill" && brainFight === "peel") ins.score += 3;
    if (ins.kind === "kill" && brainFight === "dps_backline") ins.score += 3;
  }

  // ── Elite synthesizer — merge high-score unique callouts ──
  let eliteBest: ReturnType<typeof pickEliteCallout> = null;
  try {
    const elite = synthesizeEliteCallouts({
      ctx,
      analytics: a,
      mode,
      memory,
      personality,
      seed: Math.floor(ctx.gameTime),
    });
    eliteBest = pickEliteCallout(elite, "normal");
    for (const e of elite.slice(0, 6)) {
      // Map elite into insights so pickSpeakableInsight can choose them
      const kindMap: Record<string, InsightKind> = {
        death: "death",
        low_hp: "low_hp",
        fight_window: "fight_window",
        hold_window: "hold_window",
        ult_threat: "ult_threat",
        habit: "death_pattern",
        predict: "brain_window",
        base: "base",
        level_up: "level_up",
        tempo: "tempo_flip",
        identity: "tempo_flip",
        battle: "battle",
        shotcall: "battle",
      };
      insights.push({
        kind: kindMap[e.kind] || "brain_window",
        score: e.score + 8, // slight boost — elite is our differentiator
        reason: `elite:${e.edge}`,
        line: e.line,
        signature: `elite:${e.signature}`,
        severity:
          e.priority === "critical"
            ? "urgent"
            : e.priority === "convert" || e.priority === "survive"
              ? "warn"
              : "info",
      });
    }
  } catch {
    /* elite optional */
  }

  // Re-apply anti-repeat after elite merge
  for (const ins of insights) {
    if (avoid.some((t) => similar(t, ins.line))) ins.score -= 25;
  }

  insights.sort((x, y) => y.score - x.score);
  return { insights, next, mode, memory, eliteBest };
}

function similar(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = n(a);
  const nb = n(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return keyPhraseOverlap(na, nb) >= 0.55;
}

/** Word-overlap ratio for anti-repeat (ignores tiny function words) */
function keyPhraseOverlap(a: string, b: string): number {
  const toks = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !["with", "from", "then", "that", "this", "your", "have"].includes(w));
  const wa = new Set(toks(a));
  const wb = toks(b);
  if (!wa.size || !wb.length) return 0;
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit++;
  return hit / Math.max(wb.length, 1);
}

/** Pick best insight if score clears threshold. */
export function pickSpeakableInsight(
  insights: CoachInsight[],
  intensity: CoachIntensity = "normal"
): CoachInsight | null {
  const t = thresholdFor(intensity);
  // Hard priority: death always beats battle/shotcall when present
  const deaths = insights.filter((i) => i.kind === "death" && i.score >= Math.max(t, 50));
  if (deaths.length) {
    deaths.sort((x, y) => y.score - x.score);
    return deaths[0];
  }
  // Soft priority: critical low_hp over pure convert chatter when scores are close
  const best = insights[0];
  if (!best || best.score < t) return null;
  if (best.kind === "battle" || best.kind === "brain_window") {
    const hp = insights.find(
      (i) => i.kind === "low_hp" && i.score >= t && i.score >= best.score - 12
    );
    if (hp) return hp;
  }
  return best;
}

/**
 * Human-readable why we stay quiet (paid trust loop).
 * Call after detectCoachInsights when pickSpeakableInsight returns null.
 */
export function explainCoachSilence(
  insights: CoachInsight[],
  intensity: CoachIntensity = "normal"
): string {
  const t = thresholdFor(intensity);
  if (!insights.length) return "quiet · no delta";
  const best = insights[0];
  if (best.score < t) {
    return `quiet · ${best.kind} ${best.score}<${t}`;
  }
  return "quiet · held by gap/lock";
}
