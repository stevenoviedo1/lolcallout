/**
 * Post-game memory report — the coach debrief.
 * Builds a premium report from match memory + grade + scoreboard (legal data only).
 */

import type { GameContext } from "./index.js";
import type { MatchAnalytics } from "./analytics.js";
import type { MatchMemory, HabitCounter } from "./matchMemory.js";
import { topHabits } from "./matchMemory.js";
import type { MatchGrade } from "./goals.js";
import type { DeathPatternReport } from "./deaths.js";
import { formatPostGameLoCard } from "./coachBrain.js";
import { estimateWinProb } from "./oracleBrain.js";

export interface PostGameCard {
  title: string;
  body: string;
}

export interface PostGameHabitFix {
  label: string;
  count: number;
  fix: string;
}

export interface PostGameReport {
  scoreline: string;
  result: "win" | "loss" | "unknown";
  durationMin: number;
  letter?: string;
  gradeScore?: number;
  modeLabel?: string;
  /** Ordered story of the match */
  timeline: { t: string; kind: string; note: string }[];
  habits: PostGameHabitFix[];
  strengths: string[];
  leaks: string[];
  narrative: string[];
  focusAreas: string[];
  nextQueueLo: string;
  loCard: string;
  /** Short TTS / HUD line */
  speakable: string;
  /** Dense AI block for summary model */
  forAi: string;
  cards: PostGameCard[];
  /** Coached themes count */
  coachedCount: number;
  peakGold: number;
  winProbFinal?: number;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function habitFix(h: HabitCounter): string {
  const k = h.key;
  if (k === "die_rich" || /die_rich|unspent/.test(h.label)) {
    return "Base earlier when pocket ≥ 1200g — items beat ego.";
  }
  if (k === "die_numbers" || /number deficit/.test(h.label)) {
    return "Count alive before walk-up — never equalize 1v2+.";
  }
  if (k.startsWith("die_to_")) {
    const who = h.label.replace(/^repeat deaths to /i, "") || "that champ";
    return `Respect ${who}: different entry, wait for two, no same path.`;
  }
  if (k === "early_int" || /early deaths/.test(h.label)) {
    return "Survive to 14 — farm, crash, no river alone pre-6.";
  }
  if (k === "low_hp_linger" || /low HP/.test(h.label)) {
    return "At <30% leave the wave — dead coach = zero value.";
  }
  if (k === "kill_sit_gold" || /sitting on gold/.test(h.label)) {
    return "After a kill: plate/obj OR base — never sit full buy on the map.";
  }
  if (k === "tilt_cluster" || /tilt|death cluster/.test(h.label)) {
    return "After 2 deaths in 3 min: mute all-in, mosquito farm only.";
  }
  if (k === "miss_convert" || /miss convert|green/.test(h.label)) {
    return "Green light = plates/obj in the timer — name the convert out loud.";
  }
  return "Subtract this pattern next queue — one sticky LO.";
}

function deriveStrengths(
  you: NonNullable<GameContext["you"]>,
  a: MatchAnalytics | null,
  grade: MatchGrade | null
): string[] {
  const out: string[] = [];
  if (you.deaths <= 2 && (you.kills + you.assists) >= 5) {
    out.push("Clean combat — low deaths with impact.");
  }
  if (a && a.you.cspm >= 7) out.push(`Solid farm pace (~${a.you.cspm.toFixed(1)} CS/m).`);
  if (you.assists >= you.kills && you.assists >= 4) {
    out.push("Teamfight participation — assists show board presence.");
  }
  if (grade && (grade.letter.startsWith("S") || grade.letter.startsWith("A"))) {
    out.push(`Strong grade ${grade.letter} on this mode curve.`);
  }
  if (a && a.pressure === "winning" && you.deaths <= you.kills) {
    out.push("Protected the lead — didn't throw for free.");
  }
  if (!out.length) out.push("Finished the game — data locked for next queue.");
  return out.slice(0, 4);
}

function deriveLeaks(
  you: NonNullable<GameContext["you"]>,
  mem: MatchMemory,
  deathReport: DeathPatternReport | null | undefined,
  grade: MatchGrade | null
): string[] {
  const out: string[] = [];
  const habits = topHabits(mem, 2);
  for (const h of habits.slice(0, 2)) {
    out.push(`${h.label} (x${h.count})`);
  }
  if (deathReport?.dominant) {
    out.push(`Death pattern: ${deathReport.dominant}`);
  }
  if (you.deaths >= 5) out.push("Death count too high — survive first, then force.");
  if (mem.peakGoldPocket >= 1600) {
    out.push(`Sat on up to ${mem.peakGoldPocket}g — items were late.`);
  }
  if (mem.greenWithoutConvert >= 2) {
    out.push("Missed convert windows after green lights.");
  }
  if (grade?.habits?.[0]) out.push(grade.habits[0]);
  if (!out.length) out.push("No hard leak locked — keep standards high.");
  return [...new Set(out)].slice(0, 4);
}

function nextLo(
  leaks: string[],
  habits: PostGameHabitFix[],
  deathReport: DeathPatternReport | null | undefined,
  stickyLo?: string | null
): string {
  // Prefer concrete habit fix over a bare pattern word (e.g. "overchase")
  if (habits[0]?.fix) return habits[0].fix;
  if (deathReport?.dominant) {
    return `Break ${deathReport.dominant} — different entry, wait for two, no same path.`;
  }
  if (stickyLo?.trim() && !/structural variable|one sticky/i.test(stickyLo)) {
    const s = stickyLo.trim();
    // Expand one-word death patterns into a real LO
    if (/^(overchase|facecheck|greedy|tilt|solo)$/i.test(s)) {
      return `Break ${s} — name the high-% exit before you walk in.`;
    }
    if (s.split(/\s+/).length >= 4) return s;
  }
  if (leaks[0] && !/no hard leak/i.test(leaks[0])) {
    return `Kill this leak: ${leaks[0].slice(0, 60)}`;
  }
  return "One high-% job per fight — numbers, HP, convert.";
}

/**
 * Build the full post-game report.
 */
export function buildPostGameReport(opts: {
  ctx: GameContext;
  memory: MatchMemory;
  analytics?: MatchAnalytics | null;
  grade?: MatchGrade | null;
  deathReport?: DeathPatternReport | null;
  result?: "win" | "loss" | "unknown";
  stickyLo?: string | null;
}): PostGameReport {
  const {
    ctx,
    memory,
    analytics: a = null,
    grade = null,
    deathReport = null,
    result = "unknown",
    stickyLo = null,
  } = opts;
  const you = ctx.you;
  const durationMin = Math.max(1, Math.round((ctx.gameTime || 0) / 60));
  const scoreline = you
    ? `${you.championName} ${you.kills}/${you.deaths}/${you.assists} · CS ${you.creeps} · ${durationMin}m`
    : memory.champion;

  const timeline = memory.events
    .filter((e) => e.kind !== "coached")
    .slice(-12)
    .map((e) => ({ t: fmt(e.t), kind: e.kind, note: e.note }));

  const habitRows: PostGameHabitFix[] = topHabits(memory, 1).map((h) => ({
    label: h.label,
    count: h.count,
    fix: habitFix(h),
  }));

  const strengths = you ? deriveStrengths(you, a, grade) : ["Session complete."];
  const leaks = you ? deriveLeaks(you, memory, deathReport, grade) : [];
  const lo = nextLo(leaks, habitRows, deathReport, stickyLo);
  const loCard = formatPostGameLoCard(lo, grade?.letter, habitRows[0]?.label || leaks[0]);

  const narrative: string[] = [];
  if (memory.narrativeBeats.length) {
    narrative.push(...memory.narrativeBeats.slice(0, 3));
    if (memory.narrativeBeats.length > 3) {
      narrative.push(...memory.narrativeBeats.slice(-2));
    }
  } else if (you) {
    narrative.push(
      `Opened as ${you.championName}. Closed ${you.kills}/${you.deaths}/${you.assists} in ${durationMin}m.`
    );
  }

  const focusAreas = [
    habitRows[0] ? `Habit: ${habitRows[0].label} → ${habitRows[0].fix}` : null,
    leaks[0] && !habitRows[0] ? `Leak: ${leaks[0]}` : null,
    strengths[0] ? `Keep: ${strengths[0]}` : null,
    `Next LO: ${lo}`,
    grade?.goals?.find((g) => !g.passed)?.detail
      ? `Missed goal: ${grade.goals.find((g) => !g.passed)!.detail}`
      : null,
  ]
    .filter(Boolean)
    .slice(0, 4) as string[];

  const cards: PostGameCard[] = [
    {
      title: "Grade",
      body: grade
        ? `${grade.letter} (${grade.score}/100) · ${grade.modeLabel || ""}\n${grade.summary}`
        : "Grade unavailable — scoreboard still saved.",
    },
    {
      title: "Habits to kill",
      body: habitRows.length
        ? habitRows.map((h) => `• ${h.label} x${h.count} — ${h.fix}`).join("\n")
        : "No repeating habit locked this game.",
    },
    {
      title: "What went right",
      body: strengths.map((s) => `• ${s}`).join("\n"),
    },
    {
      title: "Leaks",
      body: leaks.map((s) => `• ${s}`).join("\n"),
    },
    {
      title: "Next queue",
      body: loCard,
    },
  ];

  const winProbFinal = a ? estimateWinProb(a) : undefined;

  const speakable = grade
    ? `Grade ${grade.letter}. ${habitRows[0] ? `Kill the habit: ${habitRows[0].label}.` : ""} Next: ${lo}`
    : `Game over. Next queue: ${lo}`;

  const forAi = [
    "## Post-game memory report (prefer this over generic summary fluff)",
    `RESULT: ${result}`,
    `SCORELINE: ${scoreline}`,
    grade ? `GRADE: ${grade.letter} (${grade.score}) ${grade.modeLabel || ""}` : "",
    winProbFinal != null ? `FINAL_BOARD_WINP: ${winProbFinal}% (legal estimate)` : "",
    `STRENGTHS: ${strengths.join(" | ")}`,
    `LEAKS: ${leaks.join(" | ")}`,
    habitRows.length
      ? `HABITS:\n${habitRows.map((h) => `- ${h.label} x${h.count}: ${h.fix}`).join("\n")}`
      : "HABITS: none",
    memory.narrativeBeats.length
      ? `BEATS:\n${memory.narrativeBeats.slice(-10).map((b) => `- ${b}`).join("\n")}`
      : "",
    memory.coachedThemes.length
      ? `COACHED_THEMES: ${memory.coachedThemes.slice(0, 8).join("; ")}`
      : "",
    `NEXT_QUEUE_LO: ${lo}`,
    `FOCUS: ${focusAreas.join(" || ")}`,
    "INSTRUCTION: Write 4–6 bullets: what happened, top habit, one keep, next LO. No filler. Name champs/patterns.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    scoreline,
    result,
    durationMin,
    letter: grade?.letter,
    gradeScore: grade?.score,
    modeLabel: grade?.modeLabel,
    timeline,
    habits: habitRows,
    strengths,
    leaks,
    narrative: narrative.slice(0, 6),
    focusAreas,
    nextQueueLo: lo,
    loCard,
    speakable,
    forAi,
    cards,
    coachedCount: memory.coachedThemes.length,
    peakGold: memory.peakGoldPocket,
    winProbFinal,
  };
}

/** Human-readable multi-line card for chat / system message */
export function formatPostGameReportText(r: PostGameReport): string {
  const lines = [
    `POST-GAME REPORT · ${r.scoreline}`,
    r.letter ? `Grade ${r.letter}${r.gradeScore != null ? ` (${r.gradeScore}/100)` : ""} · ${r.modeLabel || ""}` : "",
    r.result !== "unknown" ? `Result: ${r.result}` : "",
    "",
    "STRENGTHS",
    ...r.strengths.map((s) => `• ${s}`),
    "",
    "LEAKS / HABITS",
    ...(r.habits.length
      ? r.habits.map((h) => `• ${h.label} x${h.count} — ${h.fix}`)
      : r.leaks.map((s) => `• ${s}`)),
    "",
    "FOCUS NEXT QUEUE",
    ...r.focusAreas.map((f) => `• ${f}`),
    "",
    r.loCard,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

export function formatPostGameReportForAi(r: PostGameReport | null): string {
  if (!r) return "";
  return r.forAi;
}
