/**
 * Match memory — the moat.
 * Remembers what happened, what we already coached, and what this player keeps doing.
 * Powers anti-repeat, habit tracking, and predictive "next mistake" coaching.
 */

import type { GameContext } from "./index.js";
import type { MatchAnalytics } from "./analytics.js";
import { buildCombatIntel } from "./combatIntel.js";

export type MemoryEventKind =
  | "death"
  | "kill"
  | "convert_missed"
  | "convert_taken"
  | "low_hp_reset"
  | "gold_sit"
  | "obj"
  | "fight_green"
  | "fight_red"
  | "threat_call"
  | "habit"
  | "coached";

export interface MemoryEvent {
  t: number; // gameTime sec
  kind: MemoryEventKind;
  note: string;
  champ?: string;
}

export interface HabitCounter {
  key: string;
  count: number;
  lastGameTime: number;
  label: string;
}

export interface MatchMemory {
  matchId: string;
  champion: string;
  startedAt: number;
  events: MemoryEvent[];
  habits: HabitCounter[];
  /** Themes already coached this match (normalized) */
  coachedThemes: string[];
  /** Last N spoken lines (raw) */
  spoken: string[];
  /** Rolling narrative for AI */
  narrativeBeats: string[];
  /** Sticky focus for this block */
  focus: string | null;
  /** Predictions last computed */
  lastPredictions: string[];
  youDeaths: number;
  youKills: number;
  peakGoldPocket: number;
  /** Times we saw green light without convert language following soon */
  greenWithoutConvert: number;
}

export function emptyMatchMemory(champ = "You"): MatchMemory {
  return {
    matchId: `m-${Date.now()}`,
    champion: champ,
    startedAt: Date.now(),
    events: [],
    habits: [],
    coachedThemes: [],
    spoken: [],
    narrativeBeats: [],
    focus: null,
    lastPredictions: [],
    youDeaths: 0,
    youKills: 0,
    peakGoldPocket: 0,
    greenWithoutConvert: 0,
  };
}

function themeKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !["with", "from", "then", "that", "this", "your", "have", "down", "alive", "next"].includes(w))
    .slice(0, 6)
    .join(" ");
}

function bumpHabit(mem: MatchMemory, key: string, label: string, gameTime: number) {
  const h = mem.habits.find((x) => x.key === key);
  if (h) {
    h.count += 1;
    h.lastGameTime = gameTime;
  } else {
    mem.habits.push({ key, count: 1, lastGameTime: gameTime, label });
  }
  mem.habits.sort((a, b) => b.count - a.count);
  mem.habits = mem.habits.slice(0, 8);
}

function pushEvent(mem: MatchMemory, e: MemoryEvent) {
  mem.events.push(e);
  if (mem.events.length > 40) mem.events = mem.events.slice(-40);
  mem.narrativeBeats.push(`${fmt(e.t)} ${e.kind}: ${e.note}`);
  if (mem.narrativeBeats.length > 16) mem.narrativeBeats = mem.narrativeBeats.slice(-16);
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

/** Update memory from a live context tick (call every poll). */
export function updateMatchMemory(
  mem: MatchMemory,
  ctx: GameContext,
  analytics: MatchAnalytics | null
): MatchMemory {
  if (!ctx.inGame || !ctx.you) {
    return emptyMatchMemory();
  }

  const next: MatchMemory = {
    ...mem,
    events: [...mem.events],
    habits: mem.habits.map((h) => ({ ...h })),
    coachedThemes: [...mem.coachedThemes],
    spoken: [...mem.spoken],
    narrativeBeats: [...mem.narrativeBeats],
    lastPredictions: [...mem.lastPredictions],
    champion: ctx.you.championName || mem.champion,
  };

  // Reset memory if champion/match clearly changed
  if (mem.champion && ctx.you.championName && mem.champion !== ctx.you.championName && ctx.gameTime < 90) {
    return emptyMatchMemory(ctx.you.championName);
  }
  if (ctx.gameTime < 15 && mem.youDeaths > 0 && ctx.you.deaths === 0) {
    return emptyMatchMemory(ctx.you.championName);
  }

  const t = ctx.gameTime;
  const you = ctx.you;

  if (you.deaths > next.youDeaths) {
    const combat = buildCombatIntel(ctx);
    const killer = combat?.yourLastKiller;
    pushEvent(next, {
      t,
      kind: "death",
      note: killer ? `died to ${killer}` : `death #${you.deaths}`,
      champ: you.championName,
    });
    if (you.currentGold >= 1200) {
      bumpHabit(next, "die_rich", "dying with unspent gold", t);
    }
    if (analytics && analytics.manAdvantage <= -1) {
      bumpHabit(next, "die_numbers", "dying on number deficit", t);
    }
    if (killer) {
      bumpHabit(next, `die_to_${killer.toLowerCase()}`, `repeat deaths to ${killer}`, t);
    }
    if (analytics?.phase === "early" && you.deaths >= 2) {
      bumpHabit(next, "early_int", "early deaths stacking", t);
    }
    // Tilt cluster: 2+ deaths within ~3 minutes
    const recentDeaths = next.events.filter(
      (e) => e.kind === "death" && t - e.t <= 180
    ).length;
    if (recentDeaths >= 2) {
      bumpHabit(next, "tilt_cluster", "death cluster / tilt re-enter", t);
    }
    next.youDeaths = you.deaths;
  }

  if (you.kills > next.youKills) {
    pushEvent(next, {
      t,
      kind: "kill",
      note: `kill #${you.kills}${analytics?.enemyDeadNames[0] ? ` (board: ${analytics.enemyDeadNames.slice(0, 2).join(",")})` : ""}`,
    });
    next.youKills = you.kills;
    // If kill + high gold and still on map after, may sit
    if (you.currentGold >= 1400) {
      bumpHabit(next, "kill_sit_gold", "getting kills then sitting on gold", t);
    }
  }

  next.peakGoldPocket = Math.max(next.peakGoldPocket, Math.round(you.currentGold));

  if (analytics) {
    if (analytics.fightLight === "green") {
      const lastGreen = next.events.filter((e) => e.kind === "fight_green").pop();
      if (!lastGreen || t - lastGreen.t > 20) {
        pushEvent(next, {
          t,
          kind: "fight_green",
          note: analytics.fightReason,
        });
        // If we already had a green and no convert_taken soon after → miss
        if (lastGreen && t - lastGreen.t < 90) {
          const converted = next.events.some(
            (e) =>
              (e.kind === "convert_taken" || e.kind === "obj") &&
              e.t >= lastGreen.t &&
              e.t <= t
          );
          if (!converted) {
            next.greenWithoutConvert += 1;
            if (next.greenWithoutConvert >= 2) {
              bumpHabit(next, "miss_convert", "missing green-light converts", t);
            }
          }
        }
      }
    }
    // Convert taken: green + enemy dead + (kill or gold spend or objective event)
    if (
      analytics.fightLight === "green" &&
      analytics.enemy.dead >= 1 &&
      (you.kills > mem.youKills || analytics.battlePhase === "cleanup")
    ) {
      const lastC = next.events.filter((e) => e.kind === "convert_taken").pop();
      if (!lastC || t - lastC.t > 25) {
        pushEvent(next, {
          t,
          kind: "convert_taken",
          note: `${analytics.enemyDeadNames.slice(0, 2).join("+") || "numbers"} down — convert window`,
        });
      }
    }
    if (analytics.fightLight === "red") {
      const last = next.events.filter((e) => e.kind === "fight_red").pop();
      if (!last || t - last.t > 25) {
        pushEvent(next, { t, kind: "fight_red", note: analytics.fightReason });
      }
    }
    if (analytics.riskFlags.includes("critical_hp")) {
      bumpHabit(next, "low_hp_linger", "lingering low HP", t);
    }
  }

  // Objective events from Live Client feed
  for (const ev of ctx.recentEvents || []) {
    if (ev.type === "DRAGON" || ev.type === "BARON" || ev.type === "HERALD") {
      const sig = `obj:${ev.type}:${Math.floor(ev.gameTime / 15)}`;
      const already = next.events.some(
        (e) => e.kind === "obj" && e.note.includes(ev.type) && Math.abs(e.t - ev.gameTime) < 20
      );
      if (!already) {
        pushEvent(next, {
          t: ev.gameTime,
          kind: "obj",
          note: `${ev.type}${ev.message ? `: ${ev.message}` : ""}`.slice(0, 80),
        });
        // silence unused
        void sig;
      }
    }
  }

  next.lastPredictions = predictNextMistakes(next, ctx, analytics);
  return next;
}

/** Record that we spoke a line — for anti-repeat + theme tracking */
export function rememberSpoken(mem: MatchMemory, line: string, gameTime: number): MatchMemory {
  const next = {
    ...mem,
    spoken: [line, ...mem.spoken].slice(0, 16),
    coachedThemes: [...mem.coachedThemes],
    events: [...mem.events],
    narrativeBeats: [...mem.narrativeBeats],
  };
  const theme = themeKey(line);
  if (theme && !next.coachedThemes.includes(theme)) {
    next.coachedThemes = [theme, ...next.coachedThemes].slice(0, 20);
  }
  pushEvent(next, { t: gameTime, kind: "coached", note: line.slice(0, 80) });
  return next;
}

/** Top habits for coaching subtraction */
export function topHabits(mem: MatchMemory, minCount = 2): HabitCounter[] {
  return mem.habits.filter((h) => h.count >= minCount).slice(0, 3);
}

/**
 * Predict the next likely mistake — unique value vs reactive tools.
 */
export function predictNextMistakes(
  mem: MatchMemory,
  ctx: GameContext,
  a: MatchAnalytics | null
): string[] {
  const out: string[] = [];
  if (!ctx.you || !a) return out;
  const c = ctx.you.championName;

  // Habit-based prediction
  for (const h of topHabits(mem, 2)) {
    out.push(`PREDICT: player pattern "${h.label}" (x${h.count}) — intercept before it happens again.`);
  }

  // Situational predictions
  if (a.fightLight === "green" && a.you.gold >= 1000 && !a.noRecall) {
    out.push(`PREDICT: may greed chase instead of plates/base with ${a.you.gold}g — call convert explicitly.`);
  }
  if (a.enemiesUltUnlockedAlive[0] && a.you.hpPct != null && a.you.hpPct < 50) {
    out.push(
      `PREDICT: low HP walk-up into ${a.enemiesUltUnlockedAlive[0]} (ult unlocked) — pre-call respect.`
    );
  }
  if (a.phase === "early" && a.you.level === 5) {
    out.push(`PREDICT: level 6 window incoming — prepare all-in or respect enemy 6.`);
  }
  if (a.enemyDeadNames.length >= 2 && a.you.hpPct != null && a.you.hpPct > 60) {
    out.push(`PREDICT: free convert window (~${a.enemyRespawnEstSec ?? 25}s) — plates/obj before spawn.`);
  }
  const kdaParts = (a.you.kda || "0/0/0").split("/").map((n) => Number(n) || 0);
  const youKills = kdaParts[0] ?? 0;
  const youDeaths = kdaParts[1] ?? 0;
  if (a.pressure === "winning" && youKills >= 3) {
    out.push(`PREDICT: shutdown greed — protect lead, no fog.`);
  }
  if (a.pressure === "losing" && youDeaths >= 2) {
    out.push(`PREDICT: tilt force — demand high-% only / mosquito, not equalizer all-in.`);
  }
  if (a.objectiveWindows[0] && a.minute >= 8) {
    out.push(`PREDICT: obj window "${a.objectiveWindows[0]}" — set 30s early, not late.`);
  }
  if (mem.greenWithoutConvert >= 2) {
    out.push(`PREDICT: keeps missing converts — hammer plates/obj language next green light.`);
  }

  // Enemy approaching ult unlock
  for (const p of ctx.scoreboard) {
    if (p.level === 5 && !p.isDead) {
      const isEnemy =
        a.enemyDeadNames.includes(p.championName) ||
        a.fedEnemies.some((f) => f.startsWith(p.championName)) ||
        // crude: if not on ally dead list and not you
        p.championName !== c;
      // only mention if they're likely enemy via fed or we have fight context
      if (a.fedEnemies.some((f) => f.startsWith(p.championName))) {
        out.push(`PREDICT: ${p.championName} one level from ult — respect spike soon.`);
      } else if (isEnemy && a.enemiesUltUnlockedAlive.length < 3) {
        // skip noisy
      }
    }
  }

  return out.slice(0, 6);
}

export function formatMemoryForAi(mem: MatchMemory): string {
  const habits = topHabits(mem, 1);
  return [
    "## Match memory (do not re-coach the same theme)",
    mem.focus ? `SESSION_FOCUS: ${mem.focus}` : "",
    habits.length
      ? `HABITS:\n${habits.map((h) => `- ${h.label} x${h.count}`).join("\n")}`
      : "HABITS: none locked yet",
    mem.narrativeBeats.length
      ? `RECENT_BEATS:\n${mem.narrativeBeats.slice(-8).map((b) => `- ${b}`).join("\n")}`
      : "",
    mem.coachedThemes.length
      ? `ALREADY_COACHED_THEMES (vary angle):\n${mem.coachedThemes
          .slice(0, 8)
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "",
    mem.lastPredictions.length
      ? `PREDICTIONS:\n${mem.lastPredictions.map((p) => `- ${p}`).join("\n")}`
      : "",
    mem.spoken.length
      ? `RECENT_SPOKEN:\n${mem.spoken
          .slice(0, 6)
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** True if this line is too similar to recent coaching */
export function memoryBlocksLine(mem: MatchMemory, line: string): boolean {
  const t = themeKey(line);
  if (!t) return false;
  if (mem.coachedThemes.some((c) => c === t || (c.length > 8 && (t.includes(c) || c.includes(t))))) {
    // allow if more than ~90s and different enough word count — handled by caller with score
    return true;
  }
  const n = line.toLowerCase();
  return mem.spoken.some((s) => {
    const p = s.toLowerCase();
    if (p === n) return true;
    const wa = new Set(n.split(/\W+/).filter((w) => w.length > 3));
    const wb = p.split(/\W+/).filter((w) => w.length > 3);
    let hit = 0;
    for (const w of wb) if (wa.has(w)) hit++;
    return wb.length >= 4 && hit / wb.length >= 0.6;
  });
}
