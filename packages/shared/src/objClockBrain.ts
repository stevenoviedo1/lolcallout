/**
 * Objective clock brain — legal Live Client only.
 * Uses game clock + observed DRAGON/BARON/HERALD events (no fog invent).
 * Estimates setup windows and speakable macro lines.
 */

import type { GameContext, GameEvent, GameMode } from "./index.js";
import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";

export type ObjKind = "dragon" | "baron" | "herald" | "grubs" | "elder" | "wave";

export interface ObjTimer {
  kind: ObjKind;
  label: string;
  /** Seconds until estimated availability; 0 = up / contest now */
  etaSec: number;
  /** true when we saw a take and are counting respawn */
  fromEvent: boolean;
  urgency: "setup" | "live" | "soon" | "later";
  speak: string | null;
}

export interface ObjClockBrain {
  /** Active / upcoming objectives ranked by urgency */
  timers: ObjTimer[];
  primary: ObjTimer | null;
  /** Cannon / crash wave hint */
  waveHint: string | null;
  /** Phase label for AI */
  phaseLabel: string;
  /** Speakable premium line when macro edge is high */
  speak: string | null;
  score: number;
  forAi: string;
  /** Labels for analytics.objectiveWindows compatibility */
  windowLabels: string[];
}

/** Standard first-spawn / respawn knowledge (public game data, not fog) */
const DRAGON_FIRST = 5 * 60;
const DRAGON_RESPAWN = 5 * 60;
const HERALD_FIRST = 8 * 60;
const HERALD_DESPAWN = 19 * 60 + 45;
const BARON_FIRST = 20 * 60;
const BARON_RESPAWN = 6 * 60;
const ELDER_AFTER_SOUL_GAP = 6 * 60; // rough after soul dragon

function isNoObjMode(mode: GameMode, aram: boolean, arena: boolean): boolean {
  return aram || arena || mode === "ARAM" || mode === "ARENA";
}

function lastEventOf(events: GameEvent[], type: GameEvent["type"]): GameEvent | null {
  let best: GameEvent | null = null;
  for (const e of events || []) {
    if (e.type === type) {
      if (!best || e.gameTime >= best.gameTime) best = e;
    }
  }
  return best;
}

function countEvents(events: GameEvent[], type: GameEvent["type"]): number {
  return (events || []).filter((e) => e.type === type).length;
}

function urgencyFor(eta: number): ObjTimer["urgency"] {
  if (eta <= 0) return "live";
  if (eta <= 45) return "setup";
  if (eta <= 90) return "soon";
  return "later";
}

function etaTimer(
  kind: ObjKind,
  label: string,
  etaSec: number,
  fromEvent: boolean,
  champ: string
): ObjTimer {
  const eta = Math.max(0, Math.round(etaSec));
  const urgency = urgencyFor(eta);
  let speak: string | null = null;
  if (urgency === "live") {
    speak = `${champ}: ${label} is UP — contest only with numbers / vision.`;
  } else if (urgency === "setup") {
    speak = `${champ}: ${label} in ~${eta}s — crash wave and arrive early.`;
  } else if (urgency === "soon") {
    speak = `${champ}: ${label} in ~${eta}s — start pathing / vision.`;
  }
  return { kind, label, etaSec: eta, fromEvent, urgency, speak };
}

/**
 * Compute objective + wave clock from context + analytics.
 */
export function computeObjClockBrain(
  ctx: GameContext,
  a: MatchAnalytics | null,
  mode?: ModeProfile
): ObjClockBrain | null {
  if (!ctx.inGame || !ctx.you) return null;
  const aram = Boolean(a?.aram || mode?.family === "ARAM");
  const arena = Boolean(a?.arena || mode?.family === "ARENA");
  if (isNoObjMode(ctx.gameMode, aram, arena)) {
    return {
      timers: [],
      primary: null,
      waveHint: null,
      phaseLabel: aram ? "ARAM (no jungle obj)" : "Arena",
      speak: null,
      score: 0,
      forAi: "## Obj clock\nNO_JUNGLE_OBJECTIVES (mode)",
      windowLabels: [],
    };
  }

  const t = Math.max(0, Math.floor(ctx.gameTime));
  const champ = ctx.you.championName || "You";
  const events = ctx.recentEvents || [];
  const timers: ObjTimer[] = [];
  const man = a?.manAdvantage ?? 0;
  const green = a?.fightLight === "green";
  const red = a?.fightLight === "red";
  const enemyDead = a?.enemy.dead ?? 0;

  // ── Dragon ──
  const lastDrake = lastEventOf(events, "DRAGON");
  const drakeCount = countEvents(events, "DRAGON");
  if (lastDrake) {
    const eta = lastDrake.gameTime + DRAGON_RESPAWN - t;
    // Soul path after 3–4 drakes is heuristic; still legal board language
    const label =
      drakeCount >= 3 ? "Dragon (soul path)" : drakeCount >= 4 ? "Elder path" : "Dragon";
    if (drakeCount >= 4 && t >= BARON_FIRST) {
      timers.push(etaTimer("elder", "Elder dragon", Math.max(0, eta), true, champ));
    } else {
      timers.push(etaTimer("dragon", label, eta, true, champ));
    }
  } else if (t < DRAGON_FIRST) {
    timers.push(etaTimer("dragon", "First dragon", DRAGON_FIRST - t, false, champ));
  } else {
    // Up or unknown — treat as live contest opportunity on SR mid+
    timers.push(etaTimer("dragon", "Dragon", 0, false, champ));
  }

  // ── Herald / grubs window (pre-baron) ──
  if (t < BARON_FIRST) {
    const lastHerald = lastEventOf(events, "HERALD");
    if (lastHerald) {
      // Herald is one-time-ish per spawn window; after take, no second until late
      // Don't spam herald after take
    } else if (t < HERALD_FIRST) {
      timers.push(etaTimer("herald", "Herald / grubs", HERALD_FIRST - t, false, champ));
    } else if (t < HERALD_DESPAWN) {
      timers.push(etaTimer("herald", "Herald", 0, false, champ));
    }
  }

  // ── Baron ──
  const lastBaron = lastEventOf(events, "BARON");
  if (t < BARON_FIRST) {
    timers.push(etaTimer("baron", "Baron", BARON_FIRST - t, false, champ));
  } else if (lastBaron) {
    timers.push(
      etaTimer("baron", "Baron", lastBaron.gameTime + BARON_RESPAWN - t, true, champ)
    );
  } else {
    timers.push(etaTimer("baron", "Baron", 0, false, champ));
  }

  // ── Wave crash clock ──
  // Cannon waves: every 3rd wave (~90s early). Approximate with 90s cycle.
  const cycle = t < 14 * 60 ? 90 : t < 25 * 60 ? 60 : 30;
  const mod = t % cycle;
  const toCannon = mod === 0 ? 0 : cycle - mod;
  let waveHint: string | null = null;
  if (toCannon <= 12) {
    waveHint = `${champ}: cannon / crash wave now — shove then move.`;
  } else if (toCannon <= 25 && (green || enemyDead >= 1)) {
    waveHint = `${champ}: crash in ~${toCannon}s then look ${green ? "convert" : "obj"}.`;
  }

  // Sort: live > setup > soon > later, then eta
  const rank = (u: ObjTimer["urgency"]) =>
    u === "live" ? 0 : u === "setup" ? 1 : u === "soon" ? 2 : 3;
  timers.sort((x, y) => rank(x.urgency) - rank(y.urgency) || x.etaSec - y.etaSec);

  // Prefer actionable (not far baron at 12 min)
  const actionable = timers.filter((tm) => tm.urgency !== "later" || tm.etaSec <= 120);
  let primary = actionable[0] || timers[0] || null;

  // Prefer convert-to-obj when green + live/setup
  if (green && enemyDead >= 1) {
    const liveObj = timers.find((tm) => tm.urgency === "live" || tm.urgency === "setup");
    if (liveObj) primary = liveObj;
  }

  // Build speak with board context — silence is coaching on quiet even boards
  let speak: string | null = null;
  let score = 0;
  const quietBoard =
    !green &&
    !red &&
    man === 0 &&
    enemyDead === 0 &&
    (a?.team.dead ?? 0) === 0 &&
    (a?.battlePhase === "idle" || !a?.battlePhase);

  if (primary && !ctx.you.isDead) {
    if (primary.urgency === "live" && green && man >= 1) {
      speak = `${champ}: ${primary.label} UP + numbers — take it, don't chase fog.`;
      score = 82;
    } else if (primary.urgency === "live" && red) {
      speak = `${champ}: ${primary.label} UP but red light — vision only, no force.`;
      score = 64;
    } else if (primary.urgency === "live" && (green || enemyDead >= 1 || man >= 2)) {
      speak = `${champ}: ${primary.label} is UP — contest only with numbers / vision.`;
      score = 70;
    } else if (primary.urgency === "live" && primary.fromEvent && !quietBoard) {
      // Only re-announce after we saw a take when board isn't dead quiet
      speak = `${champ}: ${primary.label} timer — prep the next take with vision.`;
      score = 52;
    } else if (primary.urgency === "setup" && man >= 0 && !quietBoard) {
      speak = primary.speak;
      score = 68;
    } else if (primary.urgency === "setup" && man < 0) {
      speak = `${champ}: ${primary.label} in ~${primary.etaSec}s — don't contest alone; crash and wait.`;
      score = 60;
    } else if (primary.urgency === "soon" && a?.you.roleHint === "JUNGLE") {
      speak = `${champ}: ${primary.label} in ~${primary.etaSec}s — you set the pit; allies crash.`;
      score = 66;
    } else if (waveHint && green && (!primary || primary.urgency === "later")) {
      speak = waveHint;
      score = 48;
    }
    // No generic "Dragon is UP" on quiet yellow boards — silence wins
  }

  // Second-order: ace → force live obj language
  if (!ctx.you.isDead && a && a.enemy.alive === 0 && primary) {
    speak = `${champ}: ACE — ${primary.label} or inhib NOW, no fountain chase.`;
    score = 90;
  }

  const phaseLabel =
    t < 8 * 60
      ? "early river / first obj"
      : t < 14 * 60
        ? "mid rotate (herald/dragon)"
        : t < 20 * 60
          ? "pre-baron soul path"
          : t < 30 * 60
            ? "baron / elder threat"
            : "super late close";

  const windowLabels = timers
    .filter((tm) => tm.urgency !== "later" || tm.etaSec <= 180)
    .slice(0, 4)
    .map((tm) =>
      tm.etaSec <= 0
        ? `${tm.label} UP`
        : `${tm.label} in ~${tm.etaSec}s (${tm.urgency})`
    );
  if (waveHint) windowLabels.push(toCannon <= 12 ? "cannon/crash now" : `crash in ~${toCannon}s`);

  const forAi = [
    "## Objective clock (legal: clock + observed events only)",
    `PHASE: ${phaseLabel} @ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`,
    primary
      ? `PRIMARY: ${primary.label} eta=${primary.etaSec}s urgency=${primary.urgency} fromEvent=${primary.fromEvent}`
      : "PRIMARY: none",
    "TIMERS:",
    ...timers.map(
      (tm) =>
        `- ${tm.kind}: ${tm.label} eta=${tm.etaSec}s ${tm.urgency}${tm.fromEvent ? " [event]" : ""}`
    ),
    waveHint ? `WAVE: ${waveHint}` : "",
    `DRAGON_EVENTS_SEEN: ${drakeCount}`,
    lastBaron ? `LAST_BARON_AT: ${Math.floor(lastBaron.gameTime / 60)}:${String(lastBaron.gameTime % 60).padStart(2, "0")}` : "",
    speak ? `SPEAK_SEED: ${speak}` : "",
    "RULE: Never invent enemy jungle path. Only clock + kill/obj events.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    timers,
    primary,
    waveHint,
    phaseLabel,
    speak,
    score,
    forAi,
    windowLabels,
  };
}

export function formatObjClockForAi(clock: ObjClockBrain | null): string {
  if (!clock) return "";
  return clock.forAi;
}
