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
  | "brain_window";

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
}): { insights: CoachInsight[]; next: CoachWatchState; mode: ModeProfile } {
  const now = opts.now ?? Date.now();
  const ctx = opts.ctx;
  const prev = opts.prev;
  const mode = detectModeProfile({
    gameMode: ctx.gameMode,
    mapName: ctx.mapName,
    queueType: (ctx as GameContext & { queueType?: string }).queueType,
  });
  const a = computeMatchAnalytics(ctx);
  const insights: CoachInsight[] = [];
  const next: CoachWatchState = { ...prev, lastFedEnemies: [...prev.lastFedEnemies] };

  if (!ctx.inGame || !ctx.you || !a) {
    return { insights: [], next: emptyWatchState(), mode };
  }

  const you = ctx.you;
  const avoid = opts.avoidLines || [];

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
    const openLine = lineFor(a, "match_start", mode);
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
        score: 100,
        reason: "you died — habit for next spawn",
        line: lineFor(a, "death", mode, ctx.deathReport?.dominant || undefined, s.spokenFallback),
        signature: `death:${you.deaths}:${ctx.deathReport?.dominant || ""}`,
        severity: "urgent",
      });
    }
    if (s.kind === "kill") {
      insights.push({
        kind: "kill",
        score: 70,
        reason: "kill/assist — convert now",
        line: lineFor(a, "kill", mode, undefined, s.spokenFallback),
        signature: `kill:${you.kills}:${you.assists}`,
        severity: "warn",
      });
    }
    if (s.kind === "objective") {
      insights.push({
        kind: "objective",
        score: 75,
        reason: "objective event",
        line: lineFor(a, "objective", mode, undefined, s.spokenFallback),
        signature: `obj:${s.title}:${Math.floor(ctx.gameTime / 30)}`,
        severity: "warn",
      });
    }
    if (s.kind === "low_hp") {
      insights.push({
        kind: "low_hp",
        score: 90,
        reason: "critical HP while alive",
        line: lineFor(a, "low_hp", mode, undefined, s.spokenFallback),
        signature: `hp:crit:${Math.floor(ctx.gameTime / 20)}`,
        severity: "urgent",
      });
    }
    if (s.kind === "base" && !mode.noRecall) {
      insights.push({
        kind: "base",
        score: 65,
        reason: "full buy gold sitting",
        line: lineFor(a, "base", mode, undefined, s.spokenFallback),
        signature: `base:${goldBucket(you.currentGold, false)}`,
        severity: "info",
      });
    }
    if (s.kind === "level_up" && [6, 11, 16].includes(you.level)) {
      insights.push({
        kind: "level_up",
        score: 55,
        reason: `level ${you.level} spike`,
        line: lineFor(a, "level_up", mode, undefined, s.spokenFallback),
        signature: `lvl:${you.level}`,
        severity: "info",
      });
    }
    if (s.kind === "numbers") {
      insights.push({
        kind: "numbers",
        score: 80,
        reason: "numbers swing",
        line: lineFor(a, "numbers", mode, undefined, s.spokenFallback),
        signature: `num:${a.team.dead}:${a.enemy.dead}`,
        severity: "warn",
      });
    }
  }

  // --- Deltas from analytics (soft/hard without agent) ---
  if (a.team.dead >= 2 && a.team.dead > prev.lastAllyDead) {
    insights.push({
      kind: "numbers",
      score: 80,
      reason: `allies dead ${a.team.dead}`,
      line: lineFor(a, "numbers", mode),
      signature: `num:ally:${a.team.dead}`,
      severity: "warn",
    });
  }
  if (a.enemy.dead >= 2 && a.enemy.dead > prev.lastEnemyDead) {
    insights.push({
      kind: "numbers",
      score: 80,
      reason: `enemies dead ${a.enemy.dead}`,
      line: lineFor(a, "numbers", mode),
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
        line: lineFor(a, "kill", mode),
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
      line: lineFor(a, "low_hp", mode),
      signature: `hp:crit`,
      severity: "urgent",
    });
  } else if (
    hpb === 2 &&
    prev.lastHpBucket === 2 &&
    !you.isDead &&
    sinceSpeak >= 18_000
  ) {
    insights.push({
      kind: "low_hp",
      score: 58,
      reason: "still critical HP — guide reset",
      line: lineFor(a, "low_hp", mode),
      signature: `hp:sustain:${Math.floor(ctx.gameTime / 20)}`,
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
        line: lineFor(a, "base", mode),
        signature: `gold:${gb}`,
        severity: "info",
      });
      next.goldHighSince = now;
    } else if (gb >= 2 && prev.goldHighSince && now - prev.goldHighSince > 45_000) {
      insights.push({
        kind: "gold_sit",
        score: 50,
        reason: "sitting on buy gold too long",
        line: lineFor(a, "gold_sit", mode),
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
      line: lineFor(a, "level_up", mode),
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
      line: lineFor(a, "pressure_flip", mode),
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
      line: lineFor(a, "wincon_change", mode),
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
      line: lineFor(a, "fed_enemy_new", mode),
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
      line: lineFor(a, "death_pattern", mode, dom),
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
    if (prev.lastSignatures.includes(ins.signature)) ins.score -= 35;
    if (avoid.some((t) => similar(t, ins.line))) ins.score -= 40;
    // Soft dampen chatter right after a line — never hard-mute death / low HP
    if (
      sinceSpeak < 8_000 &&
      ins.kind !== "death" &&
      ins.kind !== "low_hp" &&
      ins.severity !== "urgent"
    ) {
      ins.score -= 18;
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

  insights.sort((x, y) => y.score - x.score);
  return { insights, next, mode };
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
  const wa = new Set(na.split(" ").filter((w) => w.length > 3));
  const wb = nb.split(" ").filter((w) => w.length > 3);
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit++;
  return wb.length > 0 && hit >= 3 && hit / wb.length >= 0.55;
}

/** Pick best insight if score clears threshold. */
export function pickSpeakableInsight(
  insights: CoachInsight[],
  intensity: CoachIntensity = "normal"
): CoachInsight | null {
  const t = thresholdFor(intensity);
  const best = insights[0];
  if (!best || best.score < t) return null;
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
