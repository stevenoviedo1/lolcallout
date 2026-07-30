/**
 * Live field awareness from legal Live Client data only.
 *
 * Honest limits (compliance):
 * - NO enemy ability cooldowns, fog positions, or exact summoner CDs
 * - Ult status = unlocked by level (R at 6+), not "off cooldown"
 * - "Nearby" = role/lane co-location when Live Client exposes role position strings
 * - Always prefer scoreboard + deaths + levels + your ability levels
 */

import type { ActiveYou, GameContext, PlayerScoreline } from "./index.js";
import { getChampKit } from "./champKnowledge.js";

export type UltStatus = "locked" | "unlocked" | "unknown";

export interface FieldUnit {
  championName: string;
  team: "ORDER" | "CHAOS" | "UNKNOWN";
  level: number;
  isDead: boolean;
  isYou: boolean;
  /** Role string from Live Client when present (TOP, JUNGLE, …) — not map coords */
  laneRole?: string;
  kills: number;
  deaths: number;
  assists: number;
  ult: UltStatus;
  /** Fed-ish threat for coaching */
  threatScore: number;
  /** Short threat note from kit knowledge */
  threatNote?: string;
}

export interface FieldState {
  yourTeam: "ORDER" | "CHAOS" | "UNKNOWN";
  alliesAlive: string[];
  alliesDead: string[];
  enemiesAlive: string[];
  enemiesDead: string[];
  manAdvantage: number;
  /** Enemies L6+ and alive — ult unlocked (NOT on cooldown claim) */
  enemiesUltUnlockedAlive: string[];
  /** Fed + ult unlocked + alive = highest respect */
  priorityThreats: string[];
  /** Same lane role as you (when roles known) */
  sameLaneEnemiesAlive: string[];
  sameLaneAlliesAlive: string[];
  yourUlt: UltStatus;
  yourAbilityLevels?: { Q?: number; W?: number; E?: number; R?: number };
  /** Dense block for AI prompts */
  summaryLines: string[];
  /** High-priority callout candidates from board (local) */
  alertLines: string[];
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

function ultFromLevel(level: number): UltStatus {
  if (!level || level < 1) return "unknown";
  return level >= 6 ? "unlocked" : "locked";
}

function threatScore(p: PlayerScoreline, isEnemy: boolean): number {
  if (!isEnemy || p.isDead) return 0;
  let s = 0;
  if (p.kills >= 3 && p.kills > p.deaths) s += 40 + Math.min(30, (p.kills - p.deaths) * 8);
  if (p.level >= 6) s += 15;
  if (p.level >= 11) s += 10;
  if (p.level >= 16) s += 10;
  const kit = getChampKit(p.championName);
  if (kit && /assassin|engage|juggernaut|hypercarry/i.test(kit.role + " " + kit.identity)) {
    s += 12;
  }
  return s;
}

function unitFromPlayer(
  p: PlayerScoreline,
  yourTeam: "ORDER" | "CHAOS" | "UNKNOWN",
  youName?: string
): FieldUnit {
  const isYou = Boolean(
    youName && p.championName === youName
  );
  const isEnemy =
    yourTeam !== "UNKNOWN" && p.team !== "UNKNOWN" && p.team !== yourTeam;
  return {
    championName: p.championName,
    team: p.team,
    level: p.level,
    isDead: Boolean(p.isDead),
    isYou,
    laneRole: p.laneRole,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    ult: ultFromLevel(p.level),
    threatScore: threatScore(p, isEnemy),
    threatNote: isEnemy ? getChampKit(p.championName)?.watchFor?.[0] : undefined,
  };
}

/** Build field snapshot from context. Safe on thin data. */
export function buildFieldState(ctx: GameContext): FieldState | null {
  if (!ctx.inGame) return null;
  const yourTeam = teamOfYou(ctx);
  const youName = ctx.you?.championName;
  const units = ctx.scoreboard.map((p) => unitFromPlayer(p, yourTeam, youName));

  const allies = units.filter((u) => u.team === yourTeam && yourTeam !== "UNKNOWN" && !u.isYou);
  const enemies = units.filter(
    (u) => yourTeam !== "UNKNOWN" && u.team !== "UNKNOWN" && u.team !== yourTeam
  );

  // Include yourself in ally alive/dead counts for man advantage
  const allyAlive = [
    ...(ctx.you && !ctx.you.isDead ? [ctx.you.championName] : []),
    ...allies.filter((u) => !u.isDead).map((u) => u.championName),
  ];
  const allyDead = [
    ...(ctx.you?.isDead ? [ctx.you.championName] : []),
    ...allies.filter((u) => u.isDead).map((u) => u.championName),
  ];
  const enemyAlive = enemies.filter((u) => !u.isDead).map((u) => u.championName);
  const enemyDead = enemies.filter((u) => u.isDead).map((u) => u.championName);

  const manAdvantage = allyAlive.length - enemyAlive.length;

  const enemiesUltUnlockedAlive = enemies
    .filter((u) => !u.isDead && u.ult === "unlocked")
    .map((u) => u.championName);

  const priorityThreats = enemies
    .filter((u) => !u.isDead && u.threatScore >= 40)
    .sort((a, b) => b.threatScore - a.threatScore)
    .slice(0, 3)
    .map((u) => {
      const ultTag = u.ult === "unlocked" ? " ult-unlocked" : "";
      return `${u.championName} (L${u.level}${ultTag}, ${u.kills}/${u.deaths})`;
    });

  const yourLane = units.find((u) => u.isYou)?.laneRole || ctx.you?.laneRole;
  const sameLaneEnemiesAlive = yourLane
    ? enemies
        .filter(
          (u) =>
            !u.isDead &&
            u.laneRole &&
            normalizeLane(u.laneRole) === normalizeLane(yourLane)
        )
        .map((u) => u.championName)
    : [];
  const sameLaneAlliesAlive = yourLane
    ? allies
        .filter(
          (u) =>
            !u.isDead &&
            u.laneRole &&
            normalizeLane(u.laneRole) === normalizeLane(yourLane)
        )
        .map((u) => u.championName)
    : [];

  const yourUlt = ctx.you ? ultFromLevel(ctx.you.level) : "unknown";
  const yourAbilityLevels = ctx.you?.abilityLevels;

  const summaryLines: string[] = [
    `FIELD: ${allyAlive.length}v${enemyAlive.length} (man ${manAdvantage >= 0 ? "+" : ""}${manAdvantage})`,
    `ALLIES_ALIVE: ${allyAlive.join(", ") || "none"}`,
    `ALLIES_DEAD: ${allyDead.join(", ") || "none"}`,
    `ENEMIES_ALIVE: ${enemyAlive.join(", ") || "none"}`,
    `ENEMIES_DEAD: ${enemyDead.join(", ") || "none"}`,
    `ENEMY_ULT_UNLOCKED_ALIVE (level≥6, NOT cooldowns): ${enemiesUltUnlockedAlive.join(", ") || "none"}`,
    priorityThreats.length
      ? `PRIORITY_THREATS: ${priorityThreats.join(" | ")}`
      : "PRIORITY_THREATS: none obvious",
    yourLane
      ? `YOUR_LANE_ROLE: ${yourLane} | same-lane enemies alive: ${sameLaneEnemiesAlive.join(", ") || "none"} | same-lane allies: ${sameLaneAlliesAlive.join(", ") || "none"}`
      : "YOUR_LANE_ROLE: unknown (no map coordinates — legal Live Client limit)",
    `YOUR_ULT: ${yourUlt}${yourAbilityLevels?.R != null ? ` R-level=${yourAbilityLevels.R}` : ""}`,
    "HARD_LIMIT: never invent enemy ability cooldowns, fog locations, or unseen summoner spells.",
  ];

  const alertLines = buildFieldAlerts({
    you: ctx.you,
    manAdvantage,
    enemiesUltUnlockedAlive,
    priorityThreats,
    sameLaneEnemiesAlive,
    enemies,
    enemyDead,
  });

  return {
    yourTeam,
    alliesAlive: allyAlive,
    alliesDead: allyDead,
    enemiesAlive: enemyAlive,
    enemiesDead: enemyDead,
    manAdvantage,
    enemiesUltUnlockedAlive,
    priorityThreats,
    sameLaneEnemiesAlive,
    sameLaneAlliesAlive,
    yourUlt,
    yourAbilityLevels,
    summaryLines,
    alertLines,
  };
}

function normalizeLane(role: string): string {
  const r = role.toUpperCase().replace(/[^A-Z]/g, "");
  if (r.includes("TOP")) return "TOP";
  if (r.includes("JUNG") || r.includes("JGL")) return "JUNGLE";
  if (r.includes("MID") || r.includes("MIDDLE")) return "MID";
  if (r.includes("BOT") || r.includes("ADC") || r.includes("BOTTOM")) return "BOT";
  if (r.includes("UTIL") || r.includes("SUP") || r.includes("SUPPORT")) return "SUPPORT";
  return r;
}

function buildFieldAlerts(opts: {
  you: ActiveYou | null;
  manAdvantage: number;
  enemiesUltUnlockedAlive: string[];
  priorityThreats: string[];
  sameLaneEnemiesAlive: string[];
  enemies: FieldUnit[];
  enemyDead: string[];
}): string[] {
  const lines: string[] = [];
  const c = opts.you?.championName || "You";

  // Ult-unlocked fed threats
  for (const t of opts.priorityThreats.slice(0, 2)) {
    const name = t.split(" ")[0];
    const u = opts.enemies.find((e) => e.championName === name);
    if (u && u.ult === "unlocked" && !u.isDead) {
      lines.push(
        `${c}: ${name} is alive with ult unlocked (L${u.level}) — respect their R angle; don't gift free engage.`
      );
    }
  }

  // Same-lane threat
  if (opts.sameLaneEnemiesAlive.length && opts.you && !opts.you.isDead) {
    const names = opts.sameLaneEnemiesAlive.slice(0, 2).join(" + ");
    const unlocked = opts.sameLaneEnemiesAlive.filter((n) =>
      opts.enemiesUltUnlockedAlive.includes(n)
    );
    if (unlocked.length) {
      lines.push(
        `${c}: ${unlocked.join(" + ")} same lane with ult unlocked — space trades; no facecheck.`
      );
    } else {
      lines.push(`${c}: ${names} alive on your side — track their wave pressure.`);
    }
  }

  // Man advantage
  if (opts.manAdvantage >= 2 && opts.enemyDead.length) {
    lines.push(
      `${c}: ${opts.enemyDead.slice(0, 2).join(" and ")} down — green light convert (plates/obj), not ego chase.`
    );
  } else if (opts.manAdvantage <= -2) {
    lines.push(
      `${c}: numbers down — red light fights; hold and wait for spawns.`
    );
  }

  return lines.slice(0, 4);
}

/** AI-ready block */
export function formatFieldStateForAi(field: FieldState | null): string {
  if (!field) return "";
  return [
    "## Live field (legal data only)",
    ...field.summaryLines.map((l) => `- ${l}`),
    field.alertLines.length
      ? `### Field alerts\n${field.alertLines.map((a) => `- ${a}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
