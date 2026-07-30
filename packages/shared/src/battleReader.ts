/**
 * Battle reader — reads skirmishes/teamfights from legal Live Client data.
 *
 * We cannot see positions or cast bars. We CAN read:
 * - kill clustering in time (fight intensity)
 * - who died / who killed (feed)
 * - alive counts + levels + fed status
 * - YOUR hp/gold/role/abilities
 * - ult unlocked (level ≥ 6), not cooldowns
 *
 * Output: phase, your job, focus, peel, disengage/commit, speakable line.
 */

import type { GameContext, PlayerScoreline } from "./index.js";
import { buildCombatIntel, type KillFeedItem } from "./combatIntel.js";
import { getChampKit } from "./champKnowledge.js";

export type BattlePhase =
  | "idle"
  | "skirmish"
  | "teamfight"
  | "winning"
  | "losing"
  | "cleanup"
  | "disengage";

export type BattleJob =
  | "focus_carry"
  | "focus_threat"
  | "peel"
  | "dps_backline"
  | "disengage"
  | "reset"
  | "commit_finish"
  | "hold_edge"
  | "wait"
  | "convert_after";

export interface BattleParticipant {
  name: string;
  team: "ally" | "enemy";
  level: number;
  isDead: boolean;
  kills: number;
  deaths: number;
  ultUnlocked: boolean;
  fed: boolean;
  /** Soft threat score for targeting */
  threat: number;
}

export interface BattleRead {
  phase: BattlePhase;
  /** 0–100 how "hot" the fight is */
  heat: number;
  /** Seconds since first kill in this cluster */
  fightAgeSec: number;
  killsLast12s: number;
  killsLast25s: number;
  alliesAlive: number;
  enemiesAlive: number;
  manAdvantage: number;
  allyDeadInFight: string[];
  enemyDeadInFight: string[];
  participants: BattleParticipant[];
  /** Your concrete job this second */
  yourJob: BattleJob;
  jobLine: string;
  /** Who to hit if committing */
  focusTarget: string | null;
  /** Ally to protect */
  peelFor: string | null;
  /** Enemy to respect / not facecheck */
  primaryThreat: string | null;
  commit: boolean;
  disengage: boolean;
  /** High-value speakable callout */
  callout: string | null;
  /** Why this read */
  reason: string;
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

function threatOf(p: PlayerScoreline, enemy: boolean): number {
  if (!enemy || p.isDead) return 0;
  let s = p.kills * 12 - p.deaths * 4 + p.level * 2;
  if (p.level >= 6) s += 15;
  if (p.level >= 11) s += 10;
  if (p.kills >= 3 && p.kills > p.deaths) s += 25;
  const kit = getChampKit(p.championName);
  if (kit && /assassin|engage|juggernaut|hypercarry|ult/i.test(kit.role + kit.identity)) {
    s += 14;
  }
  return s;
}

function killsInWindow(feed: KillFeedItem[], gameTime: number, windowSec: number): KillFeedItem[] {
  return feed.filter((k) => gameTime - k.gameTime >= -1 && gameTime - k.gameTime <= windowSec);
}

function namesInFeed(
  kills: KillFeedItem[],
  scoreboard: PlayerScoreline[],
  yourTeam: "ORDER" | "CHAOS" | "UNKNOWN",
  side: "ally" | "enemy"
): string[] {
  const out: string[] = [];
  for (const k of kills) {
    if (!k.victim) continue;
    const p = scoreboard.find(
      (x) =>
        x.championName.toLowerCase() === k.victim!.toLowerCase() ||
        x.championName.replace(/\s+/g, "").toLowerCase() ===
          k.victim!.replace(/\s+/g, "").toLowerCase()
    );
    if (!p || yourTeam === "UNKNOWN") continue;
    const isAlly = p.team === yourTeam;
    if ((side === "ally" && isAlly) || (side === "enemy" && !isAlly && p.team !== "UNKNOWN")) {
      if (!out.includes(p.championName)) out.push(p.championName);
    }
  }
  return out;
}

/**
 * Read the current battle state from context.
 */
export function readBattle(ctx: GameContext): BattleRead | null {
  if (!ctx.inGame || !ctx.you) return null;

  const combat = buildCombatIntel(ctx);
  const feed = combat?.killFeed || [];
  const t = ctx.gameTime;
  const yourTeam = teamOfYou(ctx);
  const you = ctx.you;
  const c = you.championName;
  const hp =
    you.maxHealth && you.maxHealth > 0 && you.currentHealth != null
      ? (you.currentHealth / you.maxHealth) * 100
      : 100;

  const k12 = killsInWindow(feed, t, 12);
  const k25 = killsInWindow(feed, t, 25);
  const killsLast12s = k12.length;
  const killsLast25s = k25.length;

  const allies = ctx.scoreboard.filter((p) => p.team === yourTeam && yourTeam !== "UNKNOWN");
  const enemies = ctx.scoreboard.filter(
    (p) => yourTeam !== "UNKNOWN" && p.team !== "UNKNOWN" && p.team !== yourTeam
  );

  // Include self in ally alive
  const alliesAlive =
    (you.isDead ? 0 : 1) + allies.filter((p) => !p.isDead && p.championName !== c).length;
  const enemiesAlive = enemies.filter((p) => !p.isDead).length;
  const manAdvantage = alliesAlive - enemiesAlive;

  const allyDeadInFight = namesInFeed(k25, ctx.scoreboard, yourTeam, "ally");
  const enemyDeadInFight = namesInFeed(k25, ctx.scoreboard, yourTeam, "enemy");
  // Also currently dead who might be mid-fight
  for (const p of allies) {
    if (p.isDead && p.championName !== c && !allyDeadInFight.includes(p.championName)) {
      // only if recent activity
      if (killsLast25s > 0) allyDeadInFight.push(p.championName);
    }
  }
  for (const p of enemies) {
    if (p.isDead && !enemyDeadInFight.includes(p.championName) && killsLast25s > 0) {
      enemyDeadInFight.push(p.championName);
    }
  }

  const firstKillT = k25.length ? Math.min(...k25.map((k) => k.gameTime)) : t;
  const fightAgeSec = k25.length ? Math.max(0, t - firstKillT) : 0;

  // Heat: kill density + your hp stress + multi-dead
  let heat = 0;
  heat += killsLast12s * 28;
  heat += killsLast25s * 12;
  heat += allyDeadInFight.length * 10;
  heat += enemyDeadInFight.length * 10;
  if (hp < 40 && killsLast25s > 0) heat += 20;
  if (Math.abs(manAdvantage) >= 2 && killsLast25s > 0) heat += 15;
  heat = Math.min(100, heat);

  // Participants
  const participants: BattleParticipant[] = [];
  for (const p of [...allies, ...enemies]) {
    const isEnemy = p.team !== yourTeam;
    participants.push({
      name: p.championName,
      team: isEnemy ? "enemy" : "ally",
      level: p.level,
      isDead: Boolean(p.isDead),
      kills: p.kills,
      deaths: p.deaths,
      ultUnlocked: p.level >= 6,
      fed: p.kills >= 3 && p.kills > p.deaths,
      threat: threatOf(p, isEnemy),
    });
  }

  const livingEnemies = participants
    .filter((p) => p.team === "enemy" && !p.isDead)
    .sort((a, b) => b.threat - a.threat);
  const livingAllies = participants
    .filter((p) => p.team === "ally" && !p.isDead)
    .sort((a, b) => b.kills - a.kills);

  const primaryThreat = livingEnemies[0]?.name || null;
  // Focus: prefer high threat that's "squishy" (high kills, not tank tag) — else top threat
  let focusTarget: string | null = null;
  const squish = livingEnemies.find((e) => {
    const kit = getChampKit(e.name);
    return kit && /adc|mage|assassin|carry|artillery/i.test(kit.role + kit.identity);
  });
  focusTarget = squish?.name || livingEnemies[livingEnemies.length - 1]?.name || livingEnemies[0]?.name || null;
  // Prefer lowest-threat living enemy as "finish" if we are winning hard
  if (manAdvantage >= 2 && livingEnemies.length) {
    const finish = [...livingEnemies].sort((a, b) => a.threat - b.threat)[0];
    if (finish && finish.threat < (livingEnemies[0]?.threat || 99)) {
      // keep primary for respect, focus the free kill if very winning
      focusTarget = livingEnemies[0].name; // still hit the carry/threat first when ahead
    }
  }

  const peelFor =
    livingAllies.find((a) => a.name !== c && a.fed)?.name ||
    livingAllies.find((a) => a.name !== c)?.name ||
    null;

  const noRecall =
    ctx.gameMode === "ARAM" ||
    (ctx.mapName || "").toLowerCase().includes("howling") ||
    (ctx.mapName || "").toLowerCase() === "map12" ||
    ctx.gameMode === "ARENA";

  // ── Phase machine ──
  let phase: BattlePhase = "idle";
  const ace = enemiesAlive === 0 && alliesAlive >= 1;
  const nearAce = enemiesAlive <= 1 && manAdvantage >= 2;

  if (you.isDead && killsLast25s > 0) {
    phase = manAdvantage < 0 ? "losing" : "cleanup";
  } else if (ace || (nearAce && killsLast25s >= 2)) {
    phase = "cleanup"; // fight is over — convert, don't "hit someone"
  } else if (killsLast12s >= 2 || (killsLast25s >= 3 && heat >= 50)) {
    phase = manAdvantage >= 2 ? "winning" : manAdvantage <= -2 ? "losing" : "teamfight";
  } else if (killsLast12s === 1 || (killsLast25s >= 1 && heat >= 30)) {
    phase = manAdvantage >= 1 ? "winning" : manAdvantage <= -1 ? "losing" : "skirmish";
  } else if (killsLast25s >= 1 && fightAgeSec > 18 && manAdvantage >= 1) {
    phase = "cleanup";
  } else if (killsLast25s >= 1 && fightAgeSec > 18) {
    phase = "idle";
  }

  // HP override → disengage (still fighting or about to)
  if (!you.isDead && hp < 28 && phase !== "cleanup" && phase !== "idle") {
    phase = "disengage";
  }
  if (!you.isDead && hp < 22 && phase !== "cleanup") {
    phase = "disengage";
  }

  // ── Your job — pro mid-fight script ──
  const role = inferRoleQuick(you);
  const kit = getChampKit(c);
  let yourJob: BattleJob = "wait";
  let commit = false;
  let disengage = false;
  let jobLine = `${c}: wait for a real fight angle.`;
  let reason = "quiet board";

  const deadNames = enemyDeadInFight.slice(0, 2).join(" and ") || "enemies";
  const allyDeadNames = allyDeadInFight.slice(0, 2).join(" and ") || "allies";

  if (you.isDead) {
    yourJob = "reset";
    const killer =
      combat?.yourLastKiller ||
      [...k25].reverse().find((k) =>
        k.victim && k.victim.toLowerCase().includes(c.toLowerCase().slice(0, 4))
      )?.killer;
    jobLine = killer
      ? `${c}: next spawn respect ${killer} — different angle, not the same entry.`
      : primaryThreat
        ? `${c}: next spawn track ${primaryThreat}; wait for two allies before rejoin.`
        : `${c}: next spawn buy if needed, nearest wave, rejoin with numbers.`;
    reason = "dead — next spawn plan";
    phase = phase === "idle" ? "cleanup" : phase;
  } else if (phase === "disengage" || (hp < 30 && killsLast25s > 0 && !ace)) {
    yourJob = "disengage";
    disengage = true;
    if (noRecall) {
      jobLine =
        hp < 20
          ? `${c}: ${Math.round(hp)}% — max range only; stack with two, shop on death.`
          : `${c}: ${Math.round(hp)}% — stop frontlining; poke edge only.`;
    } else if (you.currentGold >= 900) {
      jobLine = `${c}: ${Math.round(hp)}% + ${Math.round(you.currentGold)}g — leave NOW and base.`;
    } else {
      jobLine = `${c}: ${Math.round(hp)}% — disengage; max range, no all-in.`;
    }
    reason = "critical HP mid-fight";
  } else if (phase === "cleanup" || ace) {
    // Fight over — convert is the high-IQ play
    yourJob = "convert_after";
    commit = false;
    if (ace) {
      jobLine = noRecall
        ? `${c}: ace — shove for plates/nexus pressure; no fountain dive ego.`
        : you.currentGold >= 1300
          ? `${c}: ACE — take inhib/obj or base ${Math.round(you.currentGold)}g; no fog chase.`
          : `${c}: ACE — baron/inhib/plates NOW; don't chase into fog.`;
    } else {
      jobLine = noRecall
        ? `${c}: ${deadNames} down — shove plates mid; hold for the pack.`
        : role === "JUNGLE"
          ? `${c}: ${deadNames} down — YOU start obj; allies crash waves.`
          : `${c}: ${deadNames} down — plates or obj, not one more low-% chase.`;
    }
    reason = ace ? "ace convert" : "post-fight convert";
  } else if (phase === "losing" || manAdvantage <= -2) {
    yourJob = role === "SUPPORT" ? "peel" : role === "CARRY" ? "disengage" : "disengage";
    disengage = yourJob === "disengage";
    if (role === "SUPPORT" && peelFor) {
      yourJob = "peel";
      disengage = false;
      jobLine = primaryThreat
        ? `${c}: ${allyDeadNames} down — peel ${peelFor}, respect ${primaryThreat}.`
        : `${c}: numbers down — peel ${peelFor}; give ground.`;
    } else if (role === "JUNGLE") {
      jobLine = `${c}: fight losing ${alliesAlive}v${enemiesAlive} — drop river, clear opposite.`;
    } else {
      jobLine = primaryThreat
        ? `${c}: ${alliesAlive}v${enemiesAlive} — leave; ${primaryThreat} cleans you if you stay.`
        : `${c}: fight losing ${alliesAlive}v${enemiesAlive} — disengage, save flash.`;
    }
    reason = "number deficit in fight";
  } else if (phase === "winning" || manAdvantage >= 2) {
    yourJob = "commit_finish";
    commit = true;
    const tgt = focusTarget || primaryThreat;
    if (tgt && livingEnemies.length > 0) {
      if (role === "CARRY") {
        jobLine = `${c}: winning — right-click ${tgt} max range; no flash chase.`;
      } else if (role === "SUPPORT") {
        jobLine = `${c}: winning — zone ${tgt}, peel ${peelFor || "carry"}; then plates.`;
      } else if (role === "JUNGLE") {
        jobLine = `${c}: winning — collapse ${tgt}, then set obj; no solo fog.`;
      } else if (role === "MID" || role === "FLEX") {
        const opener = kit?.combos[0]?.split("→")[0]?.trim();
        jobLine = opener
          ? `${c}: winning — ${opener} onto ${tgt}, then convert plates.`
          : `${c}: winning — burst ${tgt}, then plates/obj not chase.`;
      } else {
        jobLine = `${c}: winning — pin ${tgt}, take tower; no ego dive.`;
      }
    } else {
      jobLine = `${c}: winning ${alliesAlive}v${enemiesAlive} — take tower/obj now.`;
    }
    reason = "man advantage mid-fight";
  } else if (phase === "teamfight" || phase === "skirmish") {
    reason = phase === "teamfight" ? "teamfight active" : "skirmish active";
    if (role === "SUPPORT") {
      yourJob = "peel";
      jobLine = peelFor
        ? `${c}: ${phase} — bodyblock for ${peelFor}${primaryThreat ? `; eyes on ${primaryThreat}` : ""}.`
        : `${c}: ${phase} — peel and zone; you don't face-check.`;
    } else if (role === "JUNGLE") {
      yourJob = livingEnemies[0]?.fed ? "focus_threat" : "focus_carry";
      const tgt = focusTarget || primaryThreat;
      commit = hp >= 40;
      jobLine = tgt
        ? `${c}: ${phase} — path to ${tgt}; only flash if it's free.`
        : `${c}: ${phase} — hit highest value in range; no random smite fight.`;
    } else if (role === "CARRY") {
      yourJob = "dps_backline";
      commit = hp >= 45;
      jobLine = primaryThreat
        ? `${c}: ${phase} — DPS from max range; ${primaryThreat} is not your dive.`
        : `${c}: ${phase} — attack what's safe; never flash first.`;
    } else {
      // MID / TOP / FLEX — secondary engage, charm windows, etc.
      yourJob = "focus_threat";
      commit = hp >= 42 && manAdvantage >= 0;
      const tgt = focusTarget || primaryThreat;
      const opener = kit?.combos[0]?.split("→")[0]?.trim();
      if (commit && tgt && opener) {
        jobLine = `${c}: ${phase} — look ${opener} on ${tgt}; leave if they turn.`;
      } else if (commit && tgt) {
        jobLine = `${c}: ${phase} — secondary on ${tgt}; don't first-in.`;
      } else if (primaryThreat) {
        yourJob = "hold_edge";
        jobLine = `${c}: ${phase} edge — bait ${primaryThreat}; punish after they spend.`;
      } else {
        jobLine = `${c}: skirmish — short trade, leave on flash; no ego.`;
      }
    }
  } else if (killsLast25s >= 1 && manAdvantage >= 1 && fightAgeSec > 12) {
    phase = "cleanup";
    yourJob = "convert_after";
    commit = false;
    jobLine = `${c}: fight over — ${deadNames} down; plates/obj now.`;
    reason = "post-fight convert window";
  } else {
    yourJob = "wait";
    if (primaryThreat && primaryThreat && livingEnemies[0]?.ultUnlocked) {
      jobLine = `${c}: no fight — track ${primaryThreat} (ult unlocked); wave first.`;
    } else if (primaryThreat) {
      jobLine = `${c}: no fight — track ${primaryThreat}; own the next wave.`;
    } else {
      jobLine = `${c}: no fight — crash wave, move first.`;
    }
    reason = "idle";
  }

  const callout = heat >= 28 || phase !== "idle" ? jobLine : null;

  const summaryLines = [
    `BATTLE_PHASE: ${phase} heat=${heat} age=${Math.round(fightAgeSec)}s`,
    `FIGHT_SCORE: kills 12s=${killsLast12s} 25s=${killsLast25s} | ${alliesAlive}v${enemiesAlive} (man ${manAdvantage >= 0 ? "+" : ""}${manAdvantage})`,
    `YOUR_JOB: ${yourJob} commit=${commit} disengage=${disengage}`,
    `JOB_LINE: ${jobLine}`,
    focusTarget ? `FOCUS: ${focusTarget}` : "",
    peelFor ? `PEEL_FOR: ${peelFor}` : "",
    primaryThreat
      ? `THREAT: ${primaryThreat}${livingEnemies[0]?.ultUnlocked ? " ult-unlocked" : ""}${livingEnemies[0]?.fed ? " FED" : ""}`
      : "",
    allyDeadInFight.length ? `ALLY_DEAD_FIGHT: ${allyDeadInFight.join(", ")}` : "",
    enemyDeadInFight.length ? `ENEMY_DEAD_FIGHT: ${enemyDeadInFight.join(", ")}` : "",
    `REASON: ${reason}`,
    "LIMIT: no positions/cast bars — kill clustering + scoreboard only.",
  ].filter(Boolean);

  return {
    phase,
    heat,
    fightAgeSec,
    killsLast12s,
    killsLast25s,
    alliesAlive,
    enemiesAlive,
    manAdvantage,
    allyDeadInFight,
    enemyDeadInFight,
    participants,
    yourJob,
    jobLine,
    focusTarget,
    peelFor,
    primaryThreat,
    commit,
    disengage,
    callout,
    reason,
    summaryLines,
  };
}

function inferRoleQuick(you: NonNullable<GameContext["you"]>): string {
  const items = (you.items || []).join(" ").toLowerCase();
  if (/atlas|relic|frostfang|spellthief|watchful|bounty|celestial|support/i.test(items)) {
    return "SUPPORT";
  }
  if (/smite|scorchclaw|mosstomper|gustwalker|scryer|jungle/i.test(items)) return "JUNGLE";
  const kit = getChampKit(you.championName);
  if (kit) {
    if (/support|enchanter/i.test(kit.role)) return "SUPPORT";
    if (/jungle/i.test(kit.role)) return "JUNGLE";
    if (/adc|marksman/i.test(kit.role)) return "CARRY";
    if (/mid/i.test(kit.role)) return "MID";
    if (/top/i.test(kit.role)) return "TOP";
  }
  return "FLEX";
}

export function formatBattleForAi(b: BattleRead | null): string {
  if (!b) return "";
  return ["## Battle read (live fight intelligence)", ...b.summaryLines.map((l) => `- ${l}`)].join(
    "\n"
  );
}

/** Whether this battle state warrants an urgent voice line */
export function battleIsUrgent(b: BattleRead | null): boolean {
  if (!b) return false;
  return (
    b.heat >= 45 ||
    b.phase === "teamfight" ||
    b.phase === "disengage" ||
    b.phase === "losing" ||
    (b.phase === "winning" && b.killsLast12s >= 1)
  );
}
