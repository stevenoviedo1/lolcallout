/**
 * Elite coach synthesizer — the product differentiator.
 * Produces high-specificity callouts no generic LLM wrapper can match:
 * named threats, fight lights, habits, predictions, role jobs, anti-repeat.
 */

import type { GameContext } from "./index.js";
import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";
import { craftCoachLine, polishLine, isObviousLine } from "./coachLines.js";
import { getChampKit } from "./champKnowledge.js";
import {
  type MatchMemory,
  memoryBlocksLine,
  topHabits,
  predictNextMistakes,
} from "./matchMemory.js";
import { flavorLine, type CoachPersonality } from "./personality.js";
import { makeShotcall, polishShotcall } from "./shotcall.js";
import { deepReasonBoard } from "./deepReason.js";
import { computeOracleBrain } from "./oracleBrain.js";
import { computeTacticalBrain } from "./tacticalBrain.js";
import { computeObjClockBrain } from "./objClockBrain.js";

export type ElitePriority =
  | "critical" // death, hp
  | "battle" // mid-fight job
  | "convert" // green light
  | "survive" // red light / threat
  | "logistics" // gold base
  | "habit" // pattern
  | "predict" // intercept
  | "tempo" // default
  | "spike";

export interface EliteCallout {
  priority: ElitePriority;
  score: number;
  kind: string;
  line: string;
  reason: string;
  /** Why this is better than a generic coach */
  edge: string;
  signature: string;
}

const BANNED = [
  "play safe",
  "numbers down",
  "numbers up",
  "one clear job",
  "farm safe",
  "stay with the team",
  "play the board",
  "group for the next",
  "convert the kill",
];

function clean(line: string): string {
  let s = line.replace(/\s+/g, " ").trim();
  // Allow full human sentences — only hard-cap extreme run-ons
  if (s.split(/\s+/).length > 34) {
    // Prefer cutting at sentence end
    const sentences = s.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences[0] && sentences[0].split(/\s+/).length >= 8) {
      s = sentences.slice(0, 2).join(" ").trim();
    } else {
      s = s.split(/\s+/).slice(0, 30).join(" ").replace(/[,;:]$/, "") + ".";
    }
  }
  return s;
}

function qualityOk(line: string): boolean {
  if (!line || line.length < 12) return false;
  if (isObviousLine(line)) return false;
  const low = line.toLowerCase();
  if (BANNED.some((b) => low.includes(b))) return false;
  // Concrete anchor OR natural "you/your" coaching sentence
  const concrete =
    /\d/.test(line) ||
    /%/.test(line) ||
    /\b(you|your|you're)\b/i.test(line) ||
    /\b(plates?|base|ult|spawn|ward|shove|hold|respect|crash|obj|baron|dragon|peel|focus|dps|disengage|fight|collapse|bodyblock|charm|tower|inhib|gold|allies?)\b/i.test(
      line
    );
  return concrete;
}

/**
 * Generate ranked elite callouts for this frame.
 */
export function synthesizeEliteCallouts(opts: {
  ctx: GameContext;
  analytics: MatchAnalytics;
  mode: ModeProfile;
  memory: MatchMemory;
  personality: CoachPersonality;
  seed?: number;
}): EliteCallout[] {
  const { ctx, analytics: a, mode, memory, personality } = opts;
  const seed = opts.seed ?? Math.floor(a.clockSec);
  const c = a.you.champ;
  const out: EliteCallout[] = [];
  const kit = getChampKit(c);
  const habits = topHabits(memory, 2);
  const preds = predictNextMistakes(memory, ctx, a);

  const add = (
    priority: ElitePriority,
    score: number,
    kind: string,
    line: string,
    reason: string,
    edge: string,
    signature: string
  ) => {
    let L = clean(line);
    // Always human full-sentence voice (shotcall + everything else)
    if (kind === "shotcall") {
      L = polishShotcall(L, personality);
    } else {
      L = flavorLine(L, personality, seed);
    }
    L = clean(L);
    // Collapse accidental double words from rewrites
    L = L.replace(/\b(\w+)(\s+\1){1,3}\b/gi, "$1");
    if (!qualityOk(L)) return;
    if (memoryBlocksLine(memory, L)) score -= 40;
    if (score < 12) return;
    out.push({ priority, score, kind, line: L, reason, edge, signature });
  };

  // ── DEEP REASON + ORACLE (premium multi-option EV + win-prob sequence) ──
  try {
    const deep = deepReasonBoard(a, mode, personality);
    const oracle = deep ? computeOracleBrain(a, deep, personality) : null;
    const edge =
      deep && deep.runnerUp ? deep.best.net - deep.runnerUp.net : deep ? deep.best.net : 0;

    // DEATH: oracle/deep always kind=death at max priority — never compete as battle
    if (a.you.isDead && (oracle?.speak || deep?.speak)) {
      const line = oracle?.speak || deep!.speak;
      add(
        "critical",
        130,
        "death",
        line,
        `death oracle winP=${oracle?.winProb ?? "?"}% seq=${oracle?.sequence?.[0]?.action || "spawn"}`,
        "oracle spawn plan after death (hard priority)",
        `death:oracle:${a.you.kda}:${a.yourLastKiller || ""}`
      );
    } else if (oracle && !oracle.shouldSpeak) {
      // silence discipline — quiet low-edge boards
    } else if (deep?.speak) {
      const interesting =
        (a.you.hpPct != null && a.you.hpPct < 35) ||
        a.battlePhase !== "idle" ||
        a.battleHeat >= 30 ||
        a.fightLight === "green" ||
        a.fightLight === "red" ||
        a.enemy.dead >= 1 ||
        a.team.dead >= 2 ||
        (a.you.gold >= 1200 && !mode.noRecall) ||
        Math.abs(a.manAdvantage) >= 2;
      if (interesting && (edge >= 8 || deep.best.net >= 60)) {
        const confBoost = oracle ? Math.min(8, Math.floor(oracle.confidence / 15)) : 0;
        // Cap below death (130) and leave room for low_hp (96+)
        const isHp = a.you.hpPct != null && a.you.hpPct < 28;
        add(
          isHp || deep.best.net >= 55 ? "critical" : "battle",
          Math.min(isHp ? 112 : 108, 86 + Math.max(0, Math.floor(deep.best.net / 8)) + confBoost),
          isHp ? "low_hp" : "shotcall",
          oracle?.speak || deep.speak,
          `deep:${deep.best.id} net=${deep.best.net} winP=${oracle?.winProb ?? "?"}%`,
          "oracle+EV deep reason",
          `deep:${deep.best.id}:${Math.floor(a.clockSec / 6)}`
        );
      }
    }
  } catch {
    /* deep/oracle optional */
  }

  // ── TACTICAL BRAIN (threat rank / combo / shutdown / convert timer) ──
  try {
    if (!a.you.isDead) {
      const tac = computeTacticalBrain(a, mode);
      if (tac.speak && tac.score >= 56) {
        add(
          tac.shutdownRisk || tac.score >= 76 ? "survive" : "battle",
          Math.min(92, tac.score + 6),
          tac.comboWindow ? "battle" : tac.shutdownRisk ? "low_hp" : "fight_window",
          tac.speak,
          tac.primaryThreat ? `threat=${tac.primaryThreat}` : "tactical",
          "tactical: threat rank + combo + shutdown",
          `tac:${tac.primaryThreat || "board"}:${Math.floor(a.clockSec / 8)}`
        );
      }
    }
  } catch {
    /* tactical optional */
  }

  // ── OBJECTIVE CLOCK (dragon/baron/herald/wave — legal events + public timers) ──
  try {
    if (!a.you.isDead && !mode.noRecall) {
      const clock = computeObjClockBrain(ctx, a, mode);
      if (clock?.speak && clock.score >= 58) {
        // Don't drown mid-teamfight with macro unless ace/convert
        const midFight =
          a.battlePhase === "teamfight" ||
          a.battlePhase === "skirmish" ||
          a.battlePhase === "disengage";
        if (!midFight || clock.score >= 85 || a.fightLight === "green") {
          add(
            clock.score >= 80 ? "convert" : "tempo",
            Math.min(86, clock.score + 4),
            "objective_clock",
            clock.speak,
            clock.primary
              ? `${clock.primary.label} eta=${clock.primary.etaSec}`
              : clock.phaseLabel,
            "obj clock: public timers + observed takes",
            `objclk:${clock.primary?.kind || "wave"}:${clock.primary?.urgency || ""}:${Math.floor(a.minute)}`
          );
        }
      }
    }
  } catch {
    /* obj clock optional */
  }

  // ── SHOTCALL (merged tactical line) ──
  try {
    const sc = makeShotcall(a, mode, personality);
    if (sc) {
      add(
        sc.score >= 90 ? "critical" : sc.score >= 80 ? "battle" : "convert",
        sc.score + 4,
        "shotcall",
        sc.line,
        sc.why,
        "unified max-IQ shotcall",
        `shot:${sc.why}:${Math.floor(a.clockSec / 6)}`
      );
    }
  } catch {
    /* shotcall optional */
  }

  // ── BATTLE READ (highest mid-fight priority after death/HP) ──
  // cleanup/ace → slightly under pure convert so "plates now" can win when both fire
  if (
    !a.you.isDead &&
    a.battleLine &&
    (a.battleHeat >= 32 ||
      a.battlePhase === "teamfight" ||
      a.battlePhase === "skirmish" ||
      a.battlePhase === "disengage" ||
      a.battlePhase === "winning" ||
      a.battlePhase === "losing" ||
      a.battlePhase === "cleanup")
  ) {
    const score =
      a.battlePhase === "disengage"
        ? 94
        : a.battlePhase === "teamfight"
          ? 91
          : a.battlePhase === "losing"
            ? 89
            : a.battlePhase === "cleanup"
              ? 87
              : a.battlePhase === "winning"
                ? 85
                : a.battleHeat >= 55
                  ? 84
                  : 70;
    add(
      "battle",
      score,
      "battle",
      a.battleLine,
      `battle ${a.battlePhase} job=${a.battleJob}`,
      "live fight reader: focus/peel/disengage/convert",
      `battle:${a.battlePhase}:${a.battleJob}:${a.battleFocus || ""}:${Math.floor(a.clockSec / 8)}`
    );
  }

  // ── DEATH (fallback if oracle path failed quality) ──
  if (a.you.isDead && !out.some((o) => o.kind === "death")) {
    const killer = a.yourLastKiller;
    const habit = habits[0];
    let line = craftCoachLine(a, "death", mode, habit?.label);
    if (killer) {
      line = `${c}: next spawn respect ${killer}${habit ? ` — break ${habit.label}` : " — different entry"}.`;
    }
    add(
      "critical",
      125,
      "death",
      polishLine(line, a, mode),
      "you died",
      "killer+habit death coaching",
      `death:${a.you.kda}:${killer || ""}`
    );
  }

  // ── CRITICAL HP ──
  if (!a.you.isDead && a.you.hpPct != null && a.you.hpPct < 28) {
    const g = a.you.gold;
    const pct = Math.round(a.you.hpPct);
    const line = mode.noRecall
      ? g >= 1000
        ? `${c}: ${pct}% + ${g}g — max range only; shop on death, don't int it.`
        : `${c}: ${pct}% — max range only; stack with two before you re-enter.`
      : g >= 700
        ? `${c}: ${pct}% + ${g}g — base now, not one more fight.`
        : `${c}: ${pct}% — give the wave, leave; fighting is low-%.`;
    add(
      "critical",
      96,
      "low_hp",
      line,
      "critical HP",
      "hp+gold dual fact",
      `hp:${Math.floor(a.clockSec / 15)}`
    );
  }

  // ── CONVERT (green) ──
  if (!a.you.isDead && a.fightLight === "green") {
    const dead = a.enemyDeadNames.slice(0, 2).join(" and ") || "enemies";
    const resp = a.enemyRespawnEstSec ? ` ~${a.enemyRespawnEstSec}s` : "";
    const role = a.you.roleHint;
    let line = a.convertHint || `${c}: ${dead} down${resp} — plates or obj now.`;
    if (role === "JUNGLE") {
      line = `${c}: ${dead} down${resp} — you set the obj; allies crash into it.`;
    } else if (role === "SUPPORT") {
      line = `${c}: ${dead} down${resp} — ward pit/river then take free side.`;
    } else if (role === "CARRY" && a.phase === "late") {
      line = `${c}: ${dead} down — group DPS the obj; your damage is the convert.`;
    } else if (a.you.gold >= 1300 && !mode.noRecall && a.enemy.dead < 3) {
      line = `${c}: ${dead} down + ${a.you.gold}g — one shove then base if obj isn't free.`;
    }
    add(
      "convert",
      88,
      "fight_window",
      line,
      a.fightReason,
      "named dead + respawn + role convert",
      `green:${a.enemy.dead}:${a.team.dead}`
    );
  }

  // ── HOLD (red) ──
  if (!a.you.isDead && a.fightLight === "red" && (a.you.hpPct == null || a.you.hpPct >= 28)) {
    const dead = a.allyDeadNames.slice(0, 2).join(" and ") || "allies";
    let line = a.holdHint || `${c}: ${dead} down — red light; hold for spawns.`;
    if (a.you.roleHint === "JUNGLE") {
      line = `${c}: allies down — clear opposite camps; skip river contest.`;
    }
    add(
      "survive",
      84,
      "hold_window",
      line,
      a.fightReason,
      "named allies dead hold",
      `red:${a.team.dead}:${a.enemy.dead}`
    );
  }

  // ── ULT THREAT (only when it changes play — not every L6+ on board) ──
  if (!a.you.isDead && a.enemiesUltUnlockedAlive.length) {
    const fedUlt = a.fedEnemies
      .map((f) => f.split("(")[0])
      .find((n) => a.enemiesUltUnlockedAlive.includes(n));
    const softHp = a.you.hpPct != null && a.you.hpPct < 45;
    const underPressure = a.pressure === "losing" || a.manAdvantage < 0;
    // Don't spam "X has ult" on a quiet even board — only high-signal moments
    if (fedUlt || softHp || underPressure) {
      const name = fedUlt || a.enemiesUltUnlockedAlive[0];
      const threatKit = getChampKit(name);
      const rawWatch = threatKit?.watchFor?.[0] || "";
      const respect =
        rawWatch && !/zhonya|cooldown|\bcd\b|item/i.test(rawWatch)
          ? rawWatch
          : "respect their engage R";
      const line = `${c}: ${name} alive ult unlocked — ${respect}; no free walk-up.`;
      add(
        "survive",
        fedUlt ? 72 : softHp ? 64 : 50,
        "ult_threat",
        line,
        `${name} ult unlocked`,
        "legal ult-unlock + kit respect",
        `ult:${name}`
      );
    }
  }

  // ── HABIT INTERCEPT ──
  if (!a.you.isDead && habits[0] && habits[0].count >= 2) {
    const h = habits[0];
    const line = `${c}: pattern ${h.label} (x${h.count}) — subtract it this next fight.`;
    add(
      "habit",
      55 + Math.min(20, h.count * 5),
      "habit",
      line,
      h.label,
      "cross-match habit memory",
      `habit:${h.key}`
    );
  }

  // ── PREDICTIVE ──
  if (!a.you.isDead && preds[0]) {
    const p = preds[0].replace(/^PREDICT:\s*/i, "");
    // Turn prediction into a speakable intercept
    let line = "";
    if (/greed chase|convert/i.test(p) && a.fightLight === "green") {
      line = `${c}: free window — plates/obj first, not a low-% chase.`;
    } else if (/low HP walk-up|ult unlocked/i.test(p)) {
      const who = a.enemiesUltUnlockedAlive[0];
      line = who
        ? `${c}: ${Math.round(a.you.hpPct || 40)}% into ${who} ult unlocked — leave or max range.`
        : `${c}: soft HP — don't walk into ult threats.`;
    } else if (/level 6|ult spike/i.test(p)) {
      line = `${c}: level ${a.you.level} — next spike window; only force with exit.`;
    } else if (/shutdown greed|protect lead/i.test(p)) {
      line = `${c}: you're worth a shutdown — vision first, no fog alone.`;
    } else if (/tilt force|mosquito/i.test(p)) {
      line = `${c}: behind — mosquito pressure only; no equalizer all-in.`;
    } else if (/obj window/i.test(p)) {
      line = `${c}: ${a.objectiveWindows[0]?.split("—")[0] || "obj window"} — set early, arrive together.`;
    }
    if (line) {
      add("predict", 52, "predict", line, p.slice(0, 60), "predictive intercept", `pred:${themeSig(p)}`);
    }
  }

  // ── GOLD LOGISTICS ──
  if (!a.you.isDead && !mode.noRecall && a.you.gold >= 1300 && a.fightLight !== "green") {
    const line =
      a.you.hpPct != null && a.you.hpPct < 55
        ? `${c}: ${a.you.gold}g soft HP — crash one wave then base.`
        : `${c}: ${a.you.gold}g — crash then base before you gift it.`;
    add("logistics", 62, "base", line, "gold sit", "gold+hp logistics", `gold:${Math.floor(a.you.gold / 200)}`);
  }

  // Level spikes are handled by insight deltas (level_up edge) — not every frame at 6/11/16.

  // ── ROLE TEMPO DEFAULT (lower score) ──
  if (!a.you.isDead) {
    const tempo = polishLine(craftCoachLine(a, "tempo", mode, `alt=${seed}`), a, mode);
    add("tempo", 36, "tempo", tempo, "board tempo", "role+board option engine", `tempo:${a.pressure}:${a.winCon}`);
  }

  // ── IDENTITY REMINDER mid-game quiet ──
  if (!a.you.isDead && kit && a.fightLight === "yellow" && a.minute >= 6 && a.minute <= 18) {
    const line = `${c}: identity — ${kit.playFor[0]}; LO: ${habits[0]?.label || "only high-% fights"}.`;
    add("tempo", 30, "identity", line, "identity", "champ kit identity", `id:${c}:${Math.floor(a.minute / 4)}`);
  }

  out.sort((x, y) => y.score - x.score);
  return out;
}

function themeSig(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

/** Pick best elite callout above threshold */
export function pickEliteCallout(
  callouts: EliteCallout[],
  intensity: "quiet" | "normal" | "talkative" = "normal"
): EliteCallout | null {
  const thr = intensity === "quiet" ? 58 : intensity === "talkative" ? 32 : 44;
  const best = callouts[0];
  if (!best || best.score < thr) return null;
  return best;
}

/** Dense AI instruction block from elite synthesis */
export function formatEliteForAi(
  callouts: EliteCallout[],
  memory: MatchMemory
): string {
  const top = callouts.slice(0, 4);
  return [
    "## Elite coach synthesis (prefer these angles; rewrite in your voice, do not copy paste if DO_NOT_REPEAT)",
    ...top.map(
      (c, i) =>
        `${i + 1}. [${c.score}] ${c.priority}/${c.kind}: ${c.line}\n   edge: ${c.edge} | why: ${c.reason}`
    ),
    memory.focus ? `FOCUS: ${memory.focus}` : "",
    "RULE: one sentence ≤18 words. Named facts. New wording vs RECENT_SPOKEN.",
  ]
    .filter(Boolean)
    .join("\n");
}
