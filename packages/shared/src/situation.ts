/**
 * Situation briefs for AI-first live coaching.
 * Local rules DETECT situations and provide fallbacks.
 * AI generates the spoken line from the brief.
 */

import type { CalloutKind, GameContext, GameMode } from "./index.js";
import { phaseForTime } from "./deaths.js";
import {
  buildDeathCoachBrief,
  buildTempoCoachLine,
  isAramMode,
  isArenaMode,
  isNoRecallMode,
} from "./coachBrief.js";
import {
  computeMatchAnalytics,
  formatAnalyticsForAi,
  strategyNextAction,
  type MatchAnalytics,
} from "./analytics.js";
import { buildStrategyPlan, formatStrategyForAi, type StrategyPlan } from "./strategy.js";
import { detectModeProfile, type ModeProfile } from "./modes.js";
import { buildEnemyThreatForecast } from "./champKnowledge.js";

export interface SituationBrief {
  kind: CalloutKind | "kill" | "match_start" | "numbers";
  mode: GameMode;
  mapName?: string;
  clockSec: number;
  phase: "early" | "mid" | "late";
  /** Dense text for the model */
  text: string;
  /** Mode-safe local fallback (one sentence) */
  fallback: string;
  /** Extra coach instruction for this kind */
  instruction: string;
  analytics?: MatchAnalytics;
  strategy?: StrategyPlan;
  modeProfile?: ModeProfile;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function hpPct(you: NonNullable<GameContext["you"]>): number | null {
  if (!you.maxHealth || you.maxHealth <= 0 || you.currentHealth == null) return null;
  return Math.round((you.currentHealth / you.maxHealth) * 100);
}

function teamOfYou(ctx: GameContext): "ORDER" | "CHAOS" | "UNKNOWN" {
  const you = ctx.you;
  if (!you) return "UNKNOWN";
  const hit =
    ctx.scoreboard.find(
      (p) =>
        p.championName === you.championName &&
        p.kills === you.kills &&
        p.deaths === you.deaths
    ) || ctx.scoreboard.find((p) => p.championName === you.championName);
  return hit?.team ?? "UNKNOWN";
}

function boardFacts(ctx: GameContext) {
  const you = ctx.you;
  if (!you) {
    return {
      allyDead: 0,
      enemyDead: 0,
      levelDelta: 0,
      fedEnemy: [] as string[],
      team: "UNKNOWN" as const,
    };
  }
  const team = teamOfYou(ctx);
  const allies = ctx.scoreboard.filter((p) => p.team === team && team !== "UNKNOWN");
  const enemies = ctx.scoreboard.filter(
    (p) => p.team !== team && p.team !== "UNKNOWN"
  );
  const avgEnemyLv =
    enemies.length > 0
      ? enemies.reduce((s, p) => s + p.level, 0) / enemies.length
      : you.level;
  return {
    team,
    allyDead: allies.filter((p) => p.isDead).length,
    enemyDead: enemies.filter((p) => p.isDead).length,
    levelDelta: you.level - avgEnemyLv,
    fedEnemy: enemies
      .filter((p) => p.kills >= 3 && p.kills > p.deaths)
      .map((p) => p.championName)
      .slice(0, 3),
  };
}

function killLines(ctx: GameContext, limit = 5): string[] {
  return (ctx.recentEvents || [])
    .filter((e) => e.type === "DEATH" || /kill|blood/i.test(e.message || ""))
    .slice(-limit)
    .map((e) => `t=${formatClock(e.gameTime)} ${e.message || e.type}`);
}

/** Build structured brief for AI coaching. */
export function buildSituationBrief(
  ctx: GameContext,
  kind: SituationBrief["kind"],
  opts?: { lastTips?: string[]; extra?: string }
): SituationBrief {
  const you = ctx.you;
  const phase = phaseForTime(ctx.gameTime);
  const aram = isAramMode(ctx);
  const arena = isArenaMode(ctx);
  const noRecall = isNoRecallMode(ctx);
  const board = boardFacts(ctx);
  const hp = you ? hpPct(you) : null;
  const gold = you ? Math.round(you.currentGold) : 0;
  const items = (you?.items || []).filter(Boolean).slice(0, 6);
  const hasSupportItem = items.some((i) =>
    /atlas|relic|frostfang|spellthief|support|watchful|bounty/i.test(i)
  );

  const lines: string[] = [
    `KIND: ${kind}`,
    `MODE: ${ctx.gameMode}${ctx.mapName ? ` map=${ctx.mapName}` : ""}${aram ? " (ARAM — NO RECALL/BASE)" : ""}${arena ? " (ARENA)" : ""}`,
    `CLOCK: ${formatClock(ctx.gameTime)} (${phase})`,
  ];

  if (you) {
    lines.push(
      `YOU: ${you.championName} L${you.level} ${you.kills}/${you.deaths}/${you.assists} CS${you.creeps}`,
      `GOLD: ${gold}g unspent | HP: ${hp != null ? hp + "%" : "?"} | DEAD: ${you.isDead ? "yes" : "no"}`,
      `ITEMS: ${items.join(", ") || "none"}`,
      `SPELLS: ${(you.summonerSpells || []).join(", ") || "unknown"}`,
      hasSupportItem ? `ROLE_HINT: support item equipped (World Atlas etc.)` : ""
    );
  } else {
    lines.push("YOU: identity unknown — coach from scoreboard only");
  }

  lines.push(
    `BOARD: allies dead ${board.allyDead}, enemies dead ${board.enemyDead}, level delta vs enemy avg ${board.levelDelta.toFixed(1)}`,
    board.fedEnemy.length ? `FED_ENEMIES: ${board.fedEnemy.join(", ")}` : "FED_ENEMIES: none obvious"
  );

  if (ctx.deathReport) {
    lines.push(
      `DEATHS: total ${ctx.deathReport.total} E${ctx.deathReport.early}/M${ctx.deathReport.mid}/L${ctx.deathReport.late}`,
      ctx.deathReport.dominant ? `PATTERN: ${ctx.deathReport.dominant}` : ""
    );
  }

  const kills = killLines(ctx);
  if (kills.length) lines.push(`RECENT_KILLS:\n${kills.map((k) => `  - ${k}`).join("\n")}`);

  if (opts?.lastTips?.length) {
    lines.push(`DO_NOT_REPEAT (recent tips):\n${opts.lastTips.map((t) => `  - ${t}`).join("\n")}`);
  }
  if (opts?.extra) lines.push(`EXTRA: ${opts.extra}`);

  const modeProfile = detectModeProfile({
    gameMode: ctx.gameMode,
    mapName: ctx.mapName,
    queueType: ctx.queueType,
    gameQueueConfigId: ctx.gameQueueConfigId,
  });
  lines.push(`MODE_PROFILE: ${modeProfile.label} (${modeProfile.family})`);
  lines.push(`MODE_RULES: ${modeProfile.rules.join(" | ")}`);

  const analytics = computeMatchAnalytics(ctx);
  let strategy: StrategyPlan | undefined;
  let fallback = localFallbackLine(ctx, kind);
  if (analytics) {
    const strategic = strategyNextAction(analytics);
    if (kind === "tempo" || kind === "match_start" || kind === "numbers") {
      const tempo = buildTempoCoachLine(ctx, { avoid: opts?.lastTips });
      fallback = tempo?.live || strategic;
    }
    strategy = buildStrategyPlan(analytics, fallback);
    lines.push(formatAnalyticsForAi(analytics));
    lines.push(formatStrategyForAi(strategy));
    const threats = buildEnemyThreatForecast({
      fedEnemies: analytics.fedEnemies,
      enemyDead: analytics.enemy.dead,
      allyDead: analytics.team.dead,
      pressure: analytics.pressure,
      phase: analytics.phase,
      noRecall: analytics.noRecall,
    });
    lines.push(`ENEMY_FORECAST:\n${threats.map((t) => `  - ${t}`).join("\n")}`);
  }

  const text = lines.filter(Boolean).join("\n");
  const instruction = instructionForKind(kind, noRecall || modeProfile.noRecall);

  return {
    kind,
    mode: modeProfile.gameMode,
    mapName: ctx.mapName,
    clockSec: ctx.gameTime,
    phase,
    text,
    fallback,
    instruction,
    analytics: analytics || undefined,
    strategy,
    modeProfile,
  };
}

function instructionForKind(kind: SituationBrief["kind"], noRecall: boolean): string {
  const base =
    "You are a live duo coach. Reply with ONE speakable sentence (max 18 words). " +
    "Name the champion when useful. Action first. No essays. No 'you died'. No fog invent. ";
  if (noRecall) {
    return (
      base +
      "MODE IS ARAM/ARENA: NEVER say base, recall, or back to fountain to shop while alive. " +
      "Shop only on death/spawn. Prefer: hold, poke, group, max range, wait for allies. " +
      kindInstruction(kind)
    );
  }
  return base + kindInstruction(kind);
}

function kindInstruction(kind: SituationBrief["kind"]): string {
  switch (kind) {
    case "death":
      return "Death review: one habit for NEXT SPAWN (fix). Be specific from gold/levels/numbers.";
    case "tempo":
      return "LIVE GUIDE while alive: tell them what to DO in the next 20 seconds (farm, base, group, roam, shove, hold, poke). Present tense. Coach, don't wait for death.";
    case "low_hp":
      return "Critical HP: survive first — base/reset (SR) or max range (ARAM).";
    case "base":
      return "Sitting on gold: crash if needed then BASE for item spike.";
    case "kill":
      return "You/team just got a kill: convert NOW (plate, obj, reset, don't chase fog).";
    case "numbers":
      return "Numbers mismatch: play the board (hold if down, push/obj if up).";
    case "level_up":
      return "Power spike: how to use this level in the next fight window.";
    case "objective":
      return "Objective event: group, trade, or take free side — one call.";
    case "shutdown":
      return "You are fed: protect lead, vision, no solo fog.";
    case "match_start":
      return "Match start: first 2 levels plan for this champ/role.";
    case "game_end":
      return "Game over: one honest line then player will see full summary.";
    default:
      return "One concrete next action.";
  }
}

/** Mode-safe local fallback if AI fails. */
export function localFallbackLine(
  ctx: GameContext,
  kind: SituationBrief["kind"]
): string {
  const you = ctx.you;
  const champ = you?.championName || "You";
  const noRecall = isNoRecallMode(ctx);
  const gold = you ? Math.round(you.currentGold) : 0;
  const board = boardFacts(ctx);

  if (kind === "death") {
    const brief = buildDeathCoachBrief(ctx);
    if (brief) return brief.spoken;
    return noRecall
      ? "Shop on spawn, then wait for two allies before recommitting."
      : "Spawn, buy if needed, one safe wave, then group.";
  }

  if (kind === "tempo") {
    const t = buildTempoCoachLine(ctx);
    if (t) return t.live;
  }

  if (kind === "low_hp") {
    if (noRecall) return "Low health — max range only, do not hard commit.";
    return gold >= 900
      ? `Base now — low health with ${gold} gold.`
      : "Reset. You're too low to take this fight.";
  }

  if (kind === "base") {
    if (noRecall) return `Next death, shop first — ${gold} gold banked.`;
    return `Base for spike — ${gold} gold unspent.`;
  }

  if (kind === "kill") {
    return board.enemyDead >= 2
      ? `${champ}: enemies down — take plates or start obj before they spawn.`
      : `${champ}: kill timer — shove two waves then move mid first.`;
  }

  if (kind === "numbers") {
    if (board.allyDead >= 2)
      return `${champ}: ${board.allyDead} allies down — hold tower range, nearest wave only.`;
    if (board.enemyDead >= 2)
      return `${champ}: ${board.enemyDead} enemies down — closest tower or start obj now.`;
    return `${champ}: only take fights that match alive count.`;
  }

  if (kind === "level_up" && you) {
    return noRecall
      ? `Level ${you.level} — short trade, then reset spacing.`
      : `Level ${you.level} spike — trade or shove, then move.`;
  }

  if (kind === "objective") {
    if (isAramMode(ctx)) return "Tower — group and take free plates if safe.";
    return "Objective — group or trade the opposite side.";
  }

  if (kind === "shutdown") {
    return noRecall
      ? "You're fed. Don't chase alone after the kill."
      : "Protect the lead — vision first, no fog walks.";
  }

  if (kind === "match_start") {
    return `${champ}: first wave clean, look for level two advantage.`;
  }

  if (kind === "game_end") {
    return "Game over. Check your three habits on screen.";
  }

  return `${champ}: one clear job — farm, base, or group.`;
}

/** Priority for coach queue (higher = more urgent). */
export function coachPriority(kind: string): number {
  switch (kind) {
    case "death":
      return 100;
    case "low_hp":
      return 90;
    case "objective":
      return 70;
    case "kill":
      return 65;
    case "numbers":
      return 60;
    case "base":
      return 50;
    case "level_up":
      return 40;
    case "shutdown":
      return 35;
    case "match_start":
      return 30;
    case "tempo":
      return 20;
    case "game_end":
      return 10;
    default:
      return 5;
  }
}
