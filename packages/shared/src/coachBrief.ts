/**
 * Rule-based live coaching from Live Client stats.
 * Designed for INSTANT callouts (no LLM wait) — short, punchy, actionable.
 */

import type { ActiveYou, GameContext, GameMode } from "./index.js";
import { phaseForTime } from "./deaths.js";

function formatGameClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function hpPercent(you: ActiveYou | null | undefined): number | null {
  if (!you?.maxHealth || you.maxHealth <= 0) return null;
  if (you.currentHealth == null) return null;
  return (you.currentHealth / you.maxHealth) * 100;
}

export interface CoachLines {
  cause: string;
  fix: string;
  avoid: string;
  next: string;
  pattern?: string;
  /** One punchy live comm (~8–14 words). Speak this first. */
  live: string;
}

export interface DeathCoachBrief {
  phase: "early" | "mid" | "late";
  facts: string[];
  lines: CoachLines;
  /** Instant TTS line — never an essay */
  spoken: string;
  formatted: string;
}

function teamOfYou(ctx: GameContext): "ORDER" | "CHAOS" | "UNKNOWN" {
  const you = ctx.you;
  if (!you) return "UNKNOWN";
  const better =
    ctx.scoreboard.find(
      (p) =>
        p.championName === you.championName &&
        p.kills === you.kills &&
        p.deaths === you.deaths
    ) || ctx.scoreboard.find((p) => p.championName === you.championName);
  return better?.team ?? "UNKNOWN";
}

function analyzeBoard(ctx: GameContext) {
  const you = ctx.you!;
  const team = teamOfYou(ctx);
  const allies = ctx.scoreboard.filter((p) => p.team === team && team !== "UNKNOWN");
  const enemies = ctx.scoreboard.filter(
    (p) => p.team !== team && p.team !== "UNKNOWN"
  );
  const allyDead = allies.filter((p) => p.isDead).length;
  const enemyDead = enemies.filter((p) => p.isDead).length;
  const avgEnemyLv =
    enemies.length > 0
      ? enemies.reduce((s, p) => s + p.level, 0) / enemies.length
      : you.level;
  const levelDelta = you.level - avgEnemyLv;
  const fedEnemy = enemies
    .filter((p) => p.kills >= 3 && p.kills > p.deaths)
    .map((p) => p.championName)
    .slice(0, 2);

  return {
    team,
    allyDead,
    enemyDead,
    avgEnemyLv,
    levelDelta,
    fedEnemy,
  };
}

function csPerMin(creeps: number, gameTime: number): number {
  if (gameTime < 60) return 0;
  return creeps / (gameTime / 60);
}

function clipLive(s: string, max = 110): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + ".";
}

/** ARAM / Howling Abyss — no recall base */
export function isAramMode(ctx: Pick<GameContext, "gameMode" | "mapName">): boolean {
  if (ctx.gameMode === "ARAM") return true;
  const map = (ctx.mapName || "").toLowerCase();
  return map === "map12" || map.includes("howling") || map.includes("aram");
}

/** Arena — rounds, no SR base */
export function isArenaMode(ctx: Pick<GameContext, "gameMode" | "mapName">): boolean {
  if (ctx.gameMode === "ARENA") return true;
  const map = (ctx.mapName || "").toLowerCase();
  return map === "map30" || map.includes("arena") || map.includes("cherry");
}

/** Modes where "BASE / recall" advice is wrong */
export function isNoRecallMode(ctx: Pick<GameContext, "gameMode" | "mapName">): boolean {
  return isAramMode(ctx) || isArenaMode(ctx);
}

/** Build coaching from live stats after a death (or for Why did I die?). */
export function buildDeathCoachBrief(ctx: GameContext): DeathCoachBrief | null {
  const you = ctx.you;
  if (!you) return null;

  const phase = phaseForTime(ctx.gameTime);
  const board = analyzeBoard(ctx);
  const gold = Math.round(you.currentGold);
  const cspm = csPerMin(you.creeps, ctx.gameTime);
  const hp = hpPercent(you);
  const mode = ctx.gameMode;
  const dominant = ctx.deathReport?.dominant || null;
  const deathCount = you.deaths;
  const kda = `${you.kills}/${you.deaths}/${you.assists}`;

  const facts: string[] = [
    `Clock ${formatGameClock(ctx.gameTime)} (${phase} game)`,
    `${you.championName} L${you.level} · ${kda} · ${you.creeps} CS (${cspm.toFixed(1)}/m)`,
    `Unspent gold at death ~${gold}g`,
    mode !== "UNKNOWN" ? `Mode: ${mode}` : "",
    board.levelDelta <= -1.5
      ? `Underleveled (you L${you.level}, enemy avg ~L${board.avgEnemyLv.toFixed(1)})`
      : "",
    board.allyDead >= 2 ? `Allies dead: ${board.allyDead}` : "",
    board.enemyDead >= 2 ? `Enemies dead: ${board.enemyDead}` : "",
    board.fedEnemy.length ? `Fed: ${board.fedEnemy.join(", ")}` : "",
    dominant ? `Pattern: ${dominant}` : "",
  ].filter(Boolean);

  const lines = pickDeathLines({
    you,
    phase,
    mode,
    gold,
    cspm,
    hp,
    board,
    dominant,
    deathCount,
  });

  const formatted = [
    `LIVE: ${lines.live}`,
    `CAUSE: ${lines.cause}`,
    `FIX: ${lines.fix}`,
    `NEXT: ${lines.next}`,
    lines.pattern ? `PATTERN: ${lines.pattern}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const spoken = clipLive(lines.live, 100);

  return { phase, facts, lines, spoken, formatted };
}

function pickDeathLines(input: {
  you: NonNullable<GameContext["you"]>;
  phase: "early" | "mid" | "late";
  mode: GameMode;
  gold: number;
  cspm: number;
  hp: number | null;
  board: ReturnType<typeof analyzeBoard>;
  dominant: string | null;
  deathCount: number;
}): CoachLines {
  const { you, phase, mode, gold, cspm, board, dominant, deathCount } = input;
  const champ = you.championName;

  if (mode === "ARAM") {
    if (board.allyDead >= 2) {
      return {
        cause: "Re-engaged while teammates were dead.",
        fix: "Hold until 2+ allies are up.",
        avoid: "Solo chasing after a won fight.",
        next: "Buy, stack with first two spawns, poke not dive.",
        live: "Hold. Wait for two allies, then poke together.",
        pattern: dominant || undefined,
      };
    }
    if (gold >= 1200) {
      return {
        cause: "Fought without spending gold.",
        fix: "Shop on spawn before rejoin.",
        avoid: "One more spell with full gold.",
        next: `Spend ~${gold}g, rejoin with cooldowns.`,
        live: `Shop first — you banked ${gold} gold.`,
        pattern: dominant || undefined,
      };
    }
    return {
      cause: "Lost fight timing or spacing.",
      fix: "Max range first; commit after their engage.",
      avoid: "Side walking alone after a skirmish.",
      next: "Buy, group mid, wait for your big ability.",
      live: "Next fight: max range first, then commit.",
      pattern: dominant || undefined,
    };
  }

  if (mode === "ARENA") {
    return {
      cause: "Forced a fight you couldn't finish.",
      fix: "Play for next-round spike.",
      avoid: "Ego committing when round is lost.",
      next: "Check items, only fight with a win con.",
      live: "Reset. Play the next round spike.",
      pattern: dominant || undefined,
    };
  }

  if (gold >= 1500) {
    return {
      cause: `Died with ~${gold}g unspent.`,
      fix: "Base when you hit a component threshold.",
      avoid: "One more wave with a full buy.",
      next: "Spawn, buy, then rejoin.",
      live: `Base next — you died on ${gold} gold.`,
      pattern: dominant || "dying with unspent gold",
    };
  }

  if (phase === "early" && deathCount >= 2) {
    return {
      cause: "Early deaths stacking.",
      fix: `As ${champ}, only trade with minion advantage.`,
      avoid: "All-ins and river facechecks pre-item.",
      next: "Farm under tower, no ego.",
      live: "Stabilize. Farm safe — no more early all-ins.",
      pattern: dominant || "too many early deaths",
    };
  }

  if (phase === "early" && board.levelDelta <= -1.2) {
    return {
      cause: "Forced a fight underleveled.",
      fix: "Catch waves; give plates not deaths.",
      avoid: "Matching aggression down a level.",
      next: "Farm under tower if pushed in.",
      live: "You're down levels. Farm safe, no force.",
      pattern: dominant || undefined,
    };
  }

  if (board.allyDead >= 2 && phase !== "early") {
    return {
      cause: "Fought while allies were dead.",
      fix: "Give space when 2+ are down.",
      avoid: "Deep side waves on a bleeding map.",
      next: "Safe wave, then group.",
      live: "Numbers were bad. Give space, then group.",
      pattern: dominant || undefined,
    };
  }

  if (board.enemyDead >= 2 && you.kills + you.assists >= 3) {
    return {
      cause: "Greed after a won fight.",
      fix: "After a win: plate, objective, or base.",
      avoid: "Chase into fog.",
      next: "Reset, spend, take free side.",
      live: "Don't chase. Take the free objective or base.",
      pattern: dominant || undefined,
    };
  }

  if (you.kills >= 3 && you.kills > you.deaths) {
    return {
      cause: "Fed death / shutdown risk.",
      fix: "Vision first, no solo fog.",
      avoid: "Face-checking alone when ahead.",
      next: "Spawn with team; side only with exit.",
      live: "Protect the lead. No fog walks alone.",
      pattern: dominant || undefined,
    };
  }

  if (phase === "late") {
    return {
      cause: "Expensive late death.",
      fix: "Only fight with vision + objective plan.",
      avoid: "Lonely side waves with no exit.",
      next: "Group for next objective window.",
      live: "Late death is huge. Group for the next objective.",
      pattern: dominant || undefined,
    };
  }

  if (cspm < 4.5 && phase !== "early" && mode === "CLASSIC") {
    return {
      cause: "Behind on farm and still fighting.",
      fix: "Waves first until even.",
      avoid: "Roam while wave is unpaid.",
      next: "Two waves, then move with priority.",
      live: "Farm first. You're behind on waves.",
      pattern: dominant || undefined,
    };
  }

  if (board.fedEnemy.length) {
    const threat = board.fedEnemy[0];
    return {
      cause: `Died near fed ${threat}.`,
      fix: "Only fight them with numbers or CC.",
      avoid: "Side toward their strongest alone.",
      next: "Group and play for picks.",
      live: `Respect ${threat}. Only fight with numbers.`,
      pattern: dominant || undefined,
    };
  }

  if (phase === "mid") {
    return {
      cause: "Mid-game death with no plan.",
      fix: "One job: wave, ward, or objective setup.",
      avoid: "River with no vision or teammate.",
      next: "Shove nearest wave, rotate with team.",
      live: "One job next: shove wave, then group.",
      pattern: dominant || undefined,
    };
  }

  return {
    cause: `Bad fight as ${champ}.`,
    fix: "One job: safe farm or group.",
    avoid: "Same path into the same threat.",
    next: "Buy if needed, safe wave, then re-engage.",
    live: "Next spawn: one job — farm safe or group.",
    pattern: dominant || undefined,
  };
}

/** Instant live lines for proactive signals (no LLM). Mode-aware. */
export function buildSignalCoachLines(
  kind: string,
  ctx: GameContext
): { title: string; detail: string; coachPrompt: string; spokenFallback: string } | null {
  const you = ctx.you;
  if (!you && kind !== "game_end") return null;

  const aram = isAramMode(ctx);
  const arena = isArenaMode(ctx);
  const noRecall = aram || arena;

  if (kind === "death" && you) {
    const brief = buildDeathCoachBrief(ctx);
    if (!brief) return null;
    return {
      title: "Coach",
      detail: brief.lines.live,
      coachPrompt: buildDeathAiPrompt(brief, ctx),
      spokenFallback: brief.spoken,
    };
  }

  if (kind === "low_hp" && you) {
    const hp = Math.round(hpPercent(you) ?? 0);
    // ARAM: you cannot base — max range / don't commit
    const live = noRecall
      ? `Low health — max range only. Don't hard commit.`
      : you.currentGold >= 1000
        ? `Base now — ${hp} percent HP, gold in pocket.`
        : `Reset now — ${hp} percent HP, don't fight.`;
    return {
      title: noRecall ? "Spacing" : "Reset",
      detail: live,
      coachPrompt: noRecall
        ? `ARAM low HP ${hp}%. ONE line: max range, no dive. Never say BASE.`
        : `Low HP ${hp}%. ONE short line: BASE/RESET. No fluff.`,
      spokenFallback: live,
    };
  }

  if (kind === "base" && you) {
    // Living gold bank: only valid on SR (recall). ARAM/Arena never "BASE".
    if (noRecall) {
      // Alive with gold on ARAM is normal — do not nag. Caller should skip emit.
      return null;
    }
    const gold = Math.round(you.currentGold);
    const live = `Base for spike — ${gold} gold unspent.`;
    return {
      title: "Base",
      detail: live,
      coachPrompt: `~${gold}g unspent. ONE line: BASE. No fluff.`,
      spokenFallback: live,
    };
  }

  if (kind === "shutdown" && you) {
    const live = noRecall
      ? "You're fed. Don't chase alone after the kill."
      : "You're fed. Vision first — no fog walks.";
    return {
      title: "Lead",
      detail: live,
      coachPrompt: noRecall
        ? "ARAM fed. ONE line: no solo chase, group poke."
        : "Fed player. ONE line: protect lead.",
      spokenFallback: live,
    };
  }

  if (kind === "level_up" && you) {
    const live = noRecall
      ? `Level ${you.level} — look for a short trade, then reset spacing.`
      : `Level ${you.level} spike — trade or shove, then move.`;
    return {
      title: `L${you.level}`,
      detail: live,
      coachPrompt: `Level ${you.level}. Mode-aware one line.`,
      spokenFallback: live,
    };
  }

  if (kind === "objective") {
    if (aram) {
      return {
        title: "Push",
        detail: "Tower pressure — group and take free plates if safe.",
        coachPrompt: "ARAM tower. ONE line. No dragon/baron talk.",
        spokenFallback: "Tower — group and take free plates if safe.",
      };
    }
    if (arena) {
      return {
        title: "Round",
        detail: "Play the round spike — don't force a bad fight.",
        coachPrompt: "Arena. ONE short line.",
        spokenFallback: "Play the round. Don't force a bad fight.",
      };
    }
    return {
      title: "Objective",
      detail: "Objective up. Group or trade the opposite side.",
      coachPrompt: "Objective event. ONE action line.",
      spokenFallback: "Objective up. Group or trade the opposite side.",
    };
  }

  if (kind === "tempo" && you) {
    const tip = buildTempoCoachLine(ctx);
    if (!tip) return null;
    return {
      title: "Coach",
      detail: tip.live,
      coachPrompt: tip.coachPrompt,
      spokenFallback: tip.live,
    };
  }

  if (kind === "game_end") {
    return {
      title: "GG",
      detail: "Check three habits on screen.",
      coachPrompt: "3 focus habits. Short.",
      spokenFallback: "Game over. Check your three habits.",
    };
  }

  return null;
}

/**
 * Live GUIDE while alive — what a duo coach says between fights.
 * Directive, present-tense, one job for the next ~20s.
 */
function tipTooSimilar(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // share 3+ content words
  const wa = new Set(na.split(" ").filter((w) => w.length > 3));
  const wb = nb.split(" ").filter((w) => w.length > 3);
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit++;
  return hit >= 3 && wb.length > 0 && hit / wb.length >= 0.55;
}

export function buildTempoCoachLine(
  ctx: GameContext,
  opts?: { avoid?: string[] }
): { live: string; coachPrompt: string } | null {
  const you = ctx.you;
  if (!you || !ctx.inGame || you.isDead) return null;

  const avoid = opts?.avoid || [];
  const champ = you.championName;
  const gold = Math.round(you.currentGold);
  const hp = hpPercent(you);
  const aram = isAramMode(ctx);
  const board = analyzeBoard(ctx);
  const min = Math.floor(ctx.gameTime / 60);
  const sec = Math.floor(ctx.gameTime % 60)
    .toString()
    .padStart(2, "0");

  // Specific, non-obvious candidates only (no "numbers down" / "play safe")
  const candidates: string[] = [];

  if (hp != null && hp > 0 && hp < 28) {
    candidates.push(
      aram
        ? `${champ}: ${Math.round(hp)}% — max range only until a reset fight.`
        : gold >= 800
          ? `${champ}: ${Math.round(hp)}% HP with ${gold}g — base now or donate shutdown.`
          : `${champ}: ${Math.round(hp)}% — give the wave, base, come back full.`
    );
  } else if (hp != null && hp < 45 && !aram) {
    candidates.push(
      `${champ}: ${Math.round(hp)}% — soft bar; crash then base if they pressure.`
    );
  }

  if (!aram && gold >= 1300) {
    candidates.push(
      `${champ}: ${gold}g unspent — crash one wave then base for the component.`
    );
  }

  if (board.allyDead >= 2) {
    candidates.push(
      `${champ}: ${board.allyDead} allies dead — hold tower range, clear nearest wave only.`
    );
  }
  if (board.enemyDead >= 2) {
    candidates.push(
      aram
        ? `${champ}: ${board.enemyDead} enemies down — shove plates, stop before fountain.`
        : `${champ}: ${board.enemyDead} enemies down — closest tower or start obj before spawn.`
    );
  }

  if (board.fedEnemy[0]) {
    candidates.push(
      `${champ}: ${board.fedEnemy[0]} is the threat — fight them with CC/numbers only.`
    );
  }

  if (board.levelDelta <= -1.2) {
    candidates.push(
      `${champ}: down ~${Math.abs(board.levelDelta).toFixed(1)} levels — CS under tower, skip all-ins.`
    );
  } else if (board.levelDelta >= 1.5) {
    candidates.push(
      `${champ}: +${board.levelDelta.toFixed(1)} levels — short trade or roam on the crash.`
    );
  }

  if (aram) {
    candidates.push(
      gold >= 1000
        ? `${champ}: ${gold}g banked — poke, shop on death, never walk side alone.`
        : `${champ} @ ${min}:${sec}: poke first, commit only when two allies are with you.`
    );
  } else {
    candidates.push(
      `${champ} L${you.level} @ ${min}:${sec}: shove this wave then move first — force them to react.`
    );
  }

  for (const live of candidates) {
    if (!avoid.some((a) => tipTooSimilar(live, a))) {
      return { live, coachPrompt: "tempo:local" };
    }
  }
  return {
    live: `${champ} @ ${min}:${sec}: shove then move first.`,
    coachPrompt: "tempo:forced",
  };
}

/** Resolve the fastest line to speak for a signal + context. */
export function resolveLiveCalloutLine(
  kind: string,
  ctx: GameContext | null | undefined,
  signal?: { spokenFallback?: string; detail?: string; title?: string }
): string {
  if (signal?.spokenFallback?.trim()) return clipLive(signal.spokenFallback, 100);
  if (ctx) {
    const lines = buildSignalCoachLines(kind, ctx);
    if (lines?.spokenFallback) return clipLive(lines.spokenFallback, 100);
    if (kind === "death") {
      const brief = buildDeathCoachBrief(ctx);
      if (brief) return brief.spoken;
    }
  }
  if (signal?.detail?.trim()) return clipLive(signal.detail, 100);
  return "Shove this wave then move first.";
}

function buildDeathAiPrompt(brief: DeathCoachBrief, ctx: GameContext): string {
  const you = ctx.you!;
  return `LIVE DEATH COACH for ${you.championName}. Player already knows they died.
Facts:
${brief.facts.map((f) => `- ${f}`).join("\n")}
Draft live line: ${brief.lines.live}

Reply with EXACTLY this format (keep LIVE under 14 words):
LIVE: one punchy comm line
CAUSE: half line
NEXT: half line
No essays. No "you died".`;
}
