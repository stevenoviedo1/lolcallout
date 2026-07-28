/**
 * Coach BRAIN — multi-layer structural + growth intelligence for League.
 *
 * ADDITIVE only: never replaces craftCoachLine / insights / option generators.
 * Layers stack: analytics → options → brain re-rank → growth LO → AI context.
 *
 * Informed by:
 * - Macro/tempo/wave/vision structure (coaching frameworks)
 * - Esports cognition (flexibility, inhibition, decision quality)
 * - Deliberate practice (Ericsson) + 3-block / single LO culture
 * - Decision checklists (value on map, worth tradeoffs)
 * - Ecological affordances (what the board invites)
 * - Pattern map (economy / vision / movement / fighting / game state)
 * - VOD feedback loop (when lost control)
 */

import type { MatchAnalytics } from "./analytics.js";
import type { PlayOption } from "./coachLines.js";
import {
  assessMistakeRisks,
  buildThreatModel,
  getRoleModel,
  inferFightRole,
  nextMinutePlan,
  phaseScript,
  rolePrioritiesNow,
  winConScript,
  type FightRole,
  type MistakeRisk,
  type RoleModel,
  type ThreatModel,
} from "./brainModels.js";

// ─── Core types ─────────────────────────────────────────────

export type TempoState = "owning" | "even" | "reacting";

export type StructureFocus =
  | "survive"
  | "reset"
  | "wave"
  | "tempo"
  | "numbers"
  | "objective"
  | "vision"
  | "fight"
  | "identity";

/** Pattern-map categories (MOBA macro training taxonomies) */
export type PatternCategory =
  | "economy"
  | "vision"
  | "map_movement"
  | "fighting"
  | "game_state";

/** Mental-stack attention order for load-aware coaching */
export type StackItem =
  | "self_hp_gold"
  | "numbers"
  | "threat"
  | "objective_clock"
  | "win_con"
  | "wave_job"
  | "role_job";

export interface GrowthState {
  learningObjective: string;
  trains: "flexibility" | "inhibition" | "decision" | "structure" | "recovery";
  practiceIntent: string;
  growthNote: string;
}

/** Five golden decision checks (value tradeoff coaching) */
export interface DecisionChecklist {
  what: string;
  why: string;
  gain: string;
  cost: string;
  worthIt: string;
}

/** What the legal board currently "invites" */
export interface BoardAffordance {
  id: string;
  invite: string;
  strength: number; // 0–100
}

export interface CoachBrainState {
  tempo: TempoState;
  tempoScore: number;
  focus: StructureFocus;
  concept: string;
  read: string;
  why: string;
  reviewQuestions: string[];
  tags: string[];
  growth: GrowthState;

  // ── Expanded layers (additive) ──
  /** Pattern-map bucket for this moment */
  pattern: PatternCategory;
  /** Attention order — protect working memory */
  mentalStack: StackItem[];
  /** Most valuable thing on the map right now (one sentence) */
  highestValue: string;
  /** Decision checklist for AI / what-now depth */
  checklist: DecisionChecklist;
  /** Top board affordances */
  affordances: BoardAffordance[];
  /** Power / spike read */
  spikeNote: string;
  /** Cognitive load warning if board is chaotic */
  load: "low" | "medium" | "high";
  /** Short VOD-style review seeds */
  vodSeeds: string[];

  // ── Role / phase / threat models (additive) ──
  roleModel: RoleModel;
  fightRole: FightRole;
  fightRoleNote: string;
  phaseHeadline: string;
  phasePriorities: string[];
  rolePriorities: string[];
  threat: ThreatModel | null;
  mistakeRisks: MistakeRisk[];
  winConLine: string;
  /** Next 60s step plan */
  nextMinute: string[];
  /** Counterplay one-liner vs threat or deficit */
  counterplay: string;
  /** Heuristic map clock (obj windows from minute + mode) */
  mapClock: string;
  /** Escalating throw pattern if greed/low-% stack */
  throwLadder: string | null;
}

// ─── Compute brain ──────────────────────────────────────────

export function computeCoachBrain(a: MatchAnalytics): CoachBrainState {
  const hp = a.you.hpPct;
  const gold = a.you.gold;
  const manAdv = a.team.alive - a.enemy.alive;
  const role = a.you.roleHint;

  const tempoScore = computeTempoScore(a);
  const tempo: TempoState =
    tempoScore >= 18 ? "owning" : tempoScore <= -18 ? "reacting" : "even";

  const { focus, why, concept } = pickFocus(a, tempo, manAdv);
  const pattern = focusToPattern(focus);
  const growth = buildGrowthState(a, focus, tempo, concept);
  const affordances = buildAffordances(a, tempo, manAdv);
  const checklist = buildChecklist(a, focus, tempo, manAdv);
  const mentalStack = buildMentalStack(a, focus);
  const highestValue = buildHighestValue(a, focus, tempo, manAdv);
  const spikeNote = buildSpikeNote(a);
  const load = computeLoad(a, manAdv);
  const reviewQuestions = buildReviewQuestions(role);
  const vodSeeds = buildVodSeeds(a, focus, tempo);

  const roleModel = getRoleModel(role);
  const fight = inferFightRole(a, roleModel);
  const phase = phaseScript(a.phase);
  const threat = buildThreatModel(a);
  const mistakeRisks = assessMistakeRisks(a);
  const winConLine = winConScript(a.winCon, a);
  const nextMinute = nextMinutePlan(a, fight.note);
  const rolePriorities = rolePrioritiesNow(a, roleModel);
  const counterplay = buildCounterplay(a, threat, tempo, manAdv);
  const mapClock = buildMapClock(a);
  const throwLadder = buildThrowLadder(a, mistakeRisks, tempo, manAdv);

  const read = [
    `TEMPO: ${tempo} (${tempoScore > 0 ? "+" : ""}${tempoScore})`,
    `FOCUS: ${focus} · PATTERN: ${pattern}`,
    `VALUE: ${highestValue}`,
    `FIGHT ROLE: ${fight.role}`,
    `ROLE: ${role} · phase ${a.phase} · ${a.clockLabel}`,
    `BOARD: ${a.team.alive}v${a.enemy.alive} · killLead ${a.killLead} · winCon ${a.winCon}`,
    threat ? `THREAT: ${threat.name} (${threat.severity})` : "THREAT: none marked",
    `LOAD: ${load} · SPIKE: ${spikeNote}`,
    `MAP CLOCK: ${mapClock}`,
    throwLadder ? `THROW LADDER: ${throwLadder}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const tags = [
    `tempo:${tempo}`,
    `focus:${focus}`,
    `pattern:${pattern}`,
    `role:${role}`,
    `fight:${fight.role}`,
    `phase:${a.phase}`,
    `load:${load}`,
    a.noRecall ? "mode:norecall" : "mode:sr",
  ];

  return {
    tempo,
    tempoScore,
    focus,
    concept,
    read,
    why,
    reviewQuestions,
    tags,
    growth,
    pattern,
    mentalStack,
    highestValue,
    checklist,
    affordances,
    spikeNote,
    load,
    vodSeeds,
    roleModel,
    fightRole: fight.role,
    fightRoleNote: fight.note,
    phaseHeadline: phase.headline,
    phasePriorities: phase.priorities,
    rolePriorities,
    threat,
    mistakeRisks,
    winConLine,
    nextMinute,
    counterplay,
    mapClock,
    throwLadder,
  };
}

function buildMapClock(a: MatchAnalytics): string {
  if (a.aram) return "ARAM: no base — fight windows on cooldowns and numbers only";
  if (a.arena) return "Arena: round job — don't save for a map that isn't there";
  const m = a.minute;
  const obj = a.objectiveWindows[0];
  if (obj) return obj;
  if (m < 4) return "Open: crash + level 2/3 look · jungle path respect";
  if (m < 8) return "Early: plates + first obj setup when wave is pushed";
  if (m < 14) return "Mid rotate: herald/drake path — arrive with wave, not late fog";
  if (m < 20) return "Mid-late: tower → next major obj · track fed threat";
  if (m < 28) return "Baron threat phase — group for next major, no random sides";
  return "Close game: elder/baron + one clean siege, zero ego";
}

function buildThrowLadder(
  a: MatchAnalytics,
  risks: MistakeRisk[],
  tempo: TempoState,
  manAdv: number
): string | null {
  const deaths = Number((a.you.kda || "0/0/0").split("/")[1]) || 0;
  const greed = risks.find((r) => r.kind === "greed_gold");
  const force = risks.find((r) => r.kind === "force_behind" || r.kind === "low_pct_fight");
  const noMan = risks.find((r) => r.kind === "no_man_advantage");

  if (deaths >= 3 && (force || tempo === "reacting")) {
    return "Rung 3 — tilt ladder: zero hero plays, only high-% farm/hold until spawn";
  }
  if (manAdv <= -2 || noMan) {
    return "Rung 2 — deficit: red light fights, catch waves, wait numbers";
  }
  if (greed && a.you.gold >= 1300 && !a.noRecall) {
    return "Rung 1 — logistics throw risk: crash → base before the next fight";
  }
  if (a.pressure === "winning" && deaths >= 2) {
    return "Lead bleed: stop hunting kills — spend lead on towers/obj";
  }
  return null;
}

function buildCounterplay(
  a: MatchAnalytics,
  threat: ThreatModel | null,
  tempo: TempoState,
  manAdv: number
): string {
  if (threat) {
    return `${threat.respect}. ${threat.onlyFightWhen}.`;
  }
  if (manAdv <= -2) {
    return "Counterplay deficit: refuse fights, catch waves, wait for spawn numbers.";
  }
  if (tempo === "reacting") {
    return "Counterplay reacting: crash/safe farm first, then move — stop pure reaction.";
  }
  if (a.pressure === "winning") {
    return "Counterplay lead: force towers/obj; deny their comeback via greed.";
  }
  return "Counterplay even: take first move after crash; only high-% with variables named.";
}

function computeTempoScore(a: MatchAnalytics): number {
  const hp = a.you.hpPct;
  const manAdv = a.team.alive - a.enemy.alive;
  let s = 0;
  s += Math.max(-30, Math.min(30, a.killLead * 6));
  s += Math.max(-15, Math.min(15, a.levelLead * 8));
  s += manAdv * 12;
  if (a.enemy.dead >= 2) s += 25;
  if (a.team.dead >= 2) s -= 25;
  if (a.pressure === "winning") s += 10;
  if (a.pressure === "losing") s -= 10;
  if (a.riskFlags.includes("gold_in_pocket") && !a.noRecall) s -= 8;
  if (hp != null && hp < 35) s -= 15;
  if (hp != null && hp > 70 && a.you.gold < 800) s += 3; // healthy, free to move
  if (a.you.powerSpike) s += 6;
  if (a.minute >= 14 && a.objectiveWindows[0] && a.killLead > 0) s += 5;
  // Fed threat on board softens "owning" feel
  if (a.fedEnemies.length >= 2) s -= 6;
  else if (a.fedEnemies[0]) s -= 3;
  // Role tempo modifiers (who sets initiative)
  if (a.you.roleHint === "JUNGLE" && manAdv > 0) s += 4;
  if (a.you.roleHint === "SUPPORT" && a.team.dead === 0 && a.minute < 14) s += 2;
  if (a.you.roleHint === "CARRY" && a.team.dead >= 2) s -= 4; // ADC alone is fragile
  return Math.max(-100, Math.min(100, Math.round(s)));
}

function pickFocus(
  a: MatchAnalytics,
  tempo: TempoState,
  manAdv: number
): { focus: StructureFocus; why: string; concept: string } {
  const hp = a.you.hpPct;
  const gold = a.you.gold;
  const role = a.you.roleHint;

  if (a.you.isDead || (hp != null && hp < 28)) {
    return {
      focus: "survive",
      why: "Structure collapses if you donate — fix HP/gold first.",
      concept: "Logistics before macro: you can't own tempo dead or low HP.",
    };
  }
  if (a.team.dead >= 2 || a.enemy.dead >= 2 || Math.abs(manAdv) >= 2) {
    return {
      focus: "numbers",
      why:
        manAdv > 0
          ? "Man advantage is a timed window — convert before spawn."
          : "Man deficit is a red light — hold structure, wait for spawn.",
      concept: "Numbers are the first decision checkbox.",
    };
  }
  if (
    !a.noRecall &&
    (a.riskFlags.includes("gold_in_pocket") || gold >= 1300) &&
    a.enemy.dead < 2
  ) {
    return {
      focus: "reset",
      why: "Unsynced gold breaks tempo — crash then reset to own the next window.",
      concept: "Reset timing: crash → base → move first after.",
    };
  }
  if (a.objectiveWindows[0] && a.minute >= 8 && tempo !== "reacting") {
    return {
      focus: "objective",
      why: "Objective clock is a structure anchor — arrive with wave and numbers.",
      concept: "Objectives reward tempo, not late fog walks.",
    };
  }
  if (tempo === "reacting" && a.pressure === "losing") {
    if (role === "SUPPORT") {
      return {
        focus: "vision",
        why: "Behind: vision + peel rebuild information and calm.",
        concept: "Losing gracefully: rebuild structure, don't emotional force.",
      };
    }
    if (role === "JUNGLE") {
      return {
        focus: "tempo",
        why: "Behind: farm tempo, only high-% looks — don't force low-%.",
        concept: "Losing gracefully: rebuild structure, don't emotional force.",
      };
    }
    return {
      focus: "wave",
      why: "Behind: waves create space — mosquito pressure without rolling over.",
      concept: "Losing gracefully: rebuild structure, don't emotional force.",
    };
  }
  if (role === "SUPPORT" && a.minute < 16) {
    return {
      focus: "vision",
      why: "Support: waves crash → you move first → vision chains → map control.",
      concept: "Vision is an extension of tempo.",
    };
  }
  if (role === "JUNGLE") {
    return tempo === "owning"
      ? {
          focus: "objective",
          why: "Jungle owns setup when ahead — vision into obj.",
          concept: "Jungle: you set the map's pulse.",
        }
      : {
          focus: "tempo",
          why: "Jungle tempo: clear into high-% looks; comfort with inaction.",
          concept: "Jungle: you set the map's pulse.",
        };
  }
  if (a.phase === "early" || a.levelLead < -0.8) {
    return {
      focus: "wave",
      why: "Early structure is waves — crash before move, freeze when weak.",
      concept: "Waves are geometry: force where the enemy must be.",
    };
  }
  if (tempo === "owning") {
    return {
      focus: "tempo",
      why: "You have initiative — take towers/obj, don't gift it back hunting kills.",
      concept: "Own tempo: decide the next fight location.",
    };
  }
  return {
    focus: "wave",
    why: "Even game — shove then move first to take initiative.",
    concept: "Play first, not faster.",
  };
}

function focusToPattern(focus: StructureFocus): PatternCategory {
  switch (focus) {
    case "reset":
    case "wave":
      return "economy";
    case "vision":
      return "vision";
    case "tempo":
    case "objective":
      return "map_movement";
    case "numbers":
    case "fight":
      return "fighting";
    case "survive":
    case "identity":
    default:
      return "game_state";
  }
}

function buildMentalStack(a: MatchAnalytics, focus: StructureFocus): StackItem[] {
  // Order matters: top of stack = check first (working-memory friendly)
  const stack: StackItem[] = ["self_hp_gold", "numbers"];
  if (a.fedEnemies[0]) stack.push("threat");
  if (a.minute >= 8) stack.push("objective_clock");
  stack.push("win_con");
  if (focus === "wave" || focus === "reset") stack.push("wave_job");
  stack.push("role_job");
  // Deduplicate while preserving order
  return [...new Set(stack)];
}

function buildHighestValue(
  a: MatchAnalytics,
  focus: StructureFocus,
  tempo: TempoState,
  manAdv: number
): string {
  const c = a.you.champ;
  if (a.you.isDead) return `${c}: best value is next-spawn habit, not tilt`;
  if (a.you.hpPct != null && a.you.hpPct < 28) {
    return a.you.gold >= 700 && !a.noRecall
      ? "Survive with gold → base (don't donate shutdown)"
      : "Survive first → give wave / max range";
  }
  if (manAdv <= -2 || a.team.dead >= 2) return "Hold structure until numbers recover";
  if (manAdv >= 2 || a.enemy.dead >= 2) {
    if (a.minute >= 8 && a.objectiveWindows[0]) return "Convert numbers into objective or plates";
    return "Convert numbers into plates / tempo now";
  }
  if (!a.noRecall && a.you.gold >= 1300 && a.enemy.dead < 2) {
    return "Reset for spike (crash → base) before the next window";
  }
  if (focus === "objective" || (a.objectiveWindows[0] && tempo === "owning")) {
    return `Setup / take ${a.objectiveWindows[0]?.split("—")[0]?.trim() || "objective"} with tempo`;
  }
  if (a.you.roleHint === "SUPPORT") return "Enable map: crash → vision → peel";
  if (a.you.roleHint === "JUNGLE") {
    return tempo === "owning" ? "Create map: vision into obj" : "Efficient camps → high-% look only";
  }
  if (tempo === "owning") return "Spend lead on towers/obj, not ego kills";
  if (tempo === "reacting") return "Rebuild: safe wave / mosquito pressure, no low-%";
  return "Take initiative: crash wave then move first";
}

function buildAffordances(
  a: MatchAnalytics,
  tempo: TempoState,
  manAdv: number
): BoardAffordance[] {
  const list: BoardAffordance[] = [];
  const push = (id: string, invite: string, strength: number) => {
    if (strength > 0) list.push({ id, invite, strength: Math.min(100, strength) });
  };

  if (a.you.hpPct != null && a.you.hpPct < 28) {
    push("leave", "Board invites leave / base — fight is low-%", 95);
  }
  if (a.enemy.dead >= 2) {
    push("convert", "Board invites convert (plates/obj) before spawn", 90 + a.enemy.dead * 2);
  }
  if (a.team.dead >= 2) {
    push("hold", "Board invites hold — no river contest", 92);
  }
  if (manAdv >= 1 && a.you.hpPct != null && a.you.hpPct > 50) {
    push("short_fight", "Board invites short fight or shove with numbers", 70 + manAdv * 10);
  }
  if (!a.noRecall && a.you.gold >= 1300) {
    push("reset", "Board invites reset for item spike after crash", 75 + Math.min(15, a.you.gold / 200));
  }
  if (a.objectiveWindows[0] && a.minute >= 8 && tempo !== "reacting") {
    push("obj", `Board invites objective setup: ${a.objectiveWindows[0].split("—")[0].trim()}`, 80);
  }
  if (tempo === "owning" && a.killLead >= 3) {
    push("siege", "Board invites towers/siege — not one more kill", 78);
  }
  if (tempo === "reacting" && a.pressure === "losing") {
    push("mosquito", "Board invites tenacious side pressure / farm — not roll over", 72);
  }
  if (a.you.roleHint === "SUPPORT" && a.minute < 14) {
    push("roam_ward", "Support board invites crash → roam/ward on timer", 68);
  }
  if (a.you.roleHint === "JUNGLE" && manAdv < 0) {
    push("jg_farm", "Jungle board invites camps, not forced river", 80);
  }
  if (a.you.level === 6 || a.you.level === 11 || a.you.level === 16) {
    push("spike", `Level ${a.you.level} spike invites a planned fight window`, 65);
  }

  return list.sort((x, y) => y.strength - x.strength).slice(0, 5);
}

function buildChecklist(
  a: MatchAnalytics,
  focus: StructureFocus,
  tempo: TempoState,
  manAdv: number
): DecisionChecklist {
  const what = buildHighestValue(a, focus, tempo, manAdv);
  const why =
    focus === "numbers"
      ? manAdv > 0
        ? "Timed man advantage expires on respawn"
        : "Fighting without numbers is low-%"
      : focus === "reset"
        ? "Item spike multiplies every later fight"
        : focus === "survive"
          ? "Your death is free gold and lost tempo"
          : "This play owns or recovers initiative";

  const gain =
    manAdv > 0
      ? "Plates / obj / tempo before they spawn"
      : tempo === "owning"
        ? "Towers, vision, map control"
        : "Survival, gold, and the next clean window";

  const cost =
    a.you.hpPct != null && a.you.hpPct < 40
      ? "Risk of death / shutdown"
      : manAdv < 0
        ? "Likely throw if you force"
        : a.you.gold >= 1200 && !a.noRecall
          ? "Sitting on gold delays spike"
          : "Time and cooldowns";

  const worthIt =
    focus === "survive" || manAdv <= -2
      ? "Only if the play is leave/hold — forcing is not worth it"
      : manAdv >= 2 || a.enemy.dead >= 2
        ? "Yes — convert the window now"
        : tempo === "owning"
          ? "Yes if it spends lead on structure (towers/obj)"
          : "Only high-% plays you can name the variables for";

  return { what, why, gain, cost, worthIt };
}

function buildSpikeNote(a: MatchAnalytics): string {
  if (a.you.powerSpike) return a.you.powerSpike;
  if (a.you.level === 6) return "ult online — planned fight window";
  if (a.you.level === 11 || a.you.level === 16) return "ult rank up — fight value spikes";
  if (a.you.gold >= 1600 && !a.noRecall) return "buy gold for major item — reset value high";
  if (a.you.gold >= 1100 && !a.noRecall) return "component gold — crash-base valuable";
  if (a.levelLead >= 1.5) return "level lead — short trades favored";
  if (a.levelLead <= -1.2) return "level deficit — avoid all-ins";
  return "no hard spike — play structure";
}

function computeLoad(a: MatchAnalytics, manAdv: number): "low" | "medium" | "high" {
  let score = 0;
  if (a.you.hpPct != null && a.you.hpPct < 35) score += 2;
  if (Math.abs(manAdv) >= 2) score += 2;
  if (a.fedEnemies[0]) score += 1;
  if (a.team.dead + a.enemy.dead >= 3) score += 2;
  if (a.objectiveWindows[0] && a.minute >= 12) score += 1;
  if (a.pressure === "losing" && a.killLead <= -4) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function buildReviewQuestions(role: MatchAnalytics["you"]["roleHint"]): string[] {
  return [
    "When did I lose control (tempo), not just why did I lose?",
    "Which wave setup caused map collapse — or created our window?",
    "Did I move first after reset, or react the whole mid game?",
    "What was I doing / why / gain / cost / worth it — on the throw play?",
    role === "SUPPORT" || role === "JUNGLE"
      ? "Where did vision (or lack of it) change the next fight?"
      : "Did I crash before base, or reset unsynced?",
  ];
}

function buildVodSeeds(
  a: MatchAnalytics,
  focus: StructureFocus,
  tempo: TempoState
): string[] {
  const seeds: string[] = [];
  seeds.push(`Watch deaths: was man advantage missing? (focus was ${focus})`);
  seeds.push("Mark first time you became a passenger (reacting only).");
  if (a.you.gold >= 1000) seeds.push("Check every base: crash first or unsynced reset?");
  if (a.fedEnemies[0]) seeds.push(`Track ${a.fedEnemies[0].split("(")[0]}: when did you face-check them?`);
  if (tempo === "owning") seeds.push("When ahead: did leads become towers/obj or random fights?");
  if (a.you.roleHint === "JUNGLE") seeds.push("Count low-% river walks with no lane shove.");
  seeds.push("End VOD with 1–2 fixes only (working memory).");
  return seeds.slice(0, 5);
}

function buildGrowthState(
  a: MatchAnalytics,
  focus: StructureFocus,
  tempo: TempoState,
  _concept: string
): GrowthState {
  const role = a.you.roleHint;
  let trains: GrowthState["trains"] = "structure";
  let learningObjective = "One structural variable this block — name it every death.";
  let practiceIntent = "One variable only — protect working memory.";
  let growthNote =
    "Experts grow mental models with feedback, not hours alone. One LO per block.";

  if (focus === "survive" || focus === "reset") {
    trains = "inhibition";
    learningObjective =
      focus === "survive"
        ? "Inhibit the fight when HP/gold says leave."
        : "Inhibit greeding — crash then reset before the next play.";
    practiceIntent = "Train impulse control: red-light the low-% hold.";
    growthNote = "Top LoL players show stronger impulse control. Leaving is skill.";
  } else if (focus === "numbers") {
    trains = "decision";
    learningObjective =
      a.team.alive > a.enemy.alive
        ? "Convert man advantage before spawn — green light only."
        : "Red light on man deficit — practice comfortable inaction.";
    practiceIntent = "Checkbox: numbers first, then fight or hold.";
    growthNote = "Decision quality separates ranks; man advantage is the first reliable cue.";
  } else if (focus === "tempo" || focus === "objective") {
    trains = "flexibility";
    learningObjective =
      tempo === "owning"
        ? "Switch from kills to towers/obj — reconfigure the job."
        : "Switch from passive farm to first-move after crash.";
    practiceIntent = "Train task-switching: new board = new job.";
    growthNote = "Cognitive flexibility predicts rank. Switch roles mid-game.";
  } else if (focus === "vision") {
    trains = "structure";
    learningObjective = "Vision after you move first — info is tempo.";
    practiceIntent = "Link wave crash → move → ward (one chain).";
    growthNote = "Vision is not a support chore; it is the tempo loop.";
  } else if (focus === "wave") {
    trains = "structure";
    learningObjective =
      role === "JUNGLE"
        ? "Only high-% looks off shoved waves / camps tempo."
        : "Crash before base or roam — waves create the next affordance.";
    practiceIntent = "Wave geometry: force where they must be.";
    growthNote = "Most mid collapses start with bad waves — structure before fights.";
  } else if (tempo === "reacting" && a.pressure === "losing") {
    trains = "recovery";
    learningObjective = "Lose gracefully — one tenacious angle, no tilt narrative.";
    practiceIntent = "Emotional regulation: input quality while behind.";
    growthNote = "Affective control is performance; structure reduces chaos-feel and tilt.";
  }

  if (role === "JUNGLE" && focus !== "survive" && (trains === "flexibility" || trains === "decision")) {
    learningObjective = "Jungle: high-% only — comfort with inaction between looks.";
  }
  if (role === "SUPPORT" && (focus === "vision" || focus === "wave")) {
    learningObjective = "Support: crash → move first → vision; enable, don't idle.";
  }
  if (role === "CARRY" && a.phase === "late") {
    learningObjective = "ADC late: max-range DPS job — switch off side-quest brain.";
    trains = "flexibility";
  }
  if (role === "CARRY" && a.phase === "early" && focus === "wave") {
    learningObjective = "ADC early: crash/trade on wave timing — don't random all-in.";
  }
  if (role === "FLEX" && focus === "wave" && tempo !== "owning") {
    learningObjective = "Solo/flex: wave control first — freeze when weak, crash when strong.";
  }
  if (a.fedEnemies[0] && focus !== "survive" && trains !== "inhibition") {
    // Soft overlay when threat dominates mental model
    const threat = a.fedEnemies[0].split("(")[0].trim();
    if (threat && learningObjective.length < 70) {
      growthNote = `${growthNote} Respect ${threat} as permanent board tax.`;
    }
  }

  return { learningObjective, trains, practiceIntent, growthNote };
}

// ─── Option re-rank (additive) ──────────────────────────────

export function applyBrainToOptions(
  options: PlayOption[],
  brain: CoachBrainState
): PlayOption[] {
  if (!options.length) return options;

  const { focus, tempo, pattern, load, affordances } = brain;
  const topAfford = new Set(affordances.slice(0, 3).map((x) => x.id));

  return options.map((o) => {
    let boost = 0;
    const id = o.id.toLowerCase();
    const line = o.line.toLowerCase();
    const blob = `${id} ${line}`;

    // Focus alignment
    if (focus === "survive" && /(base|%|max range|disengage|spawn)/.test(blob)) boost += 25;
    if (focus === "reset" && /(base|crash|shop|component|gold)/.test(blob)) boost += 22;
    if (focus === "wave" && /(shove|crash|wave|plate|tower|cs)/.test(blob)) boost += 18;
    if (focus === "tempo" && /(move first|rotate|tempo|ahead|obj|tower)/.test(blob)) boost += 16;
    if (focus === "numbers" && /(green light|red light|man |dead|hold tower|plates)/.test(blob))
      boost += 24;
    if (focus === "objective" && /(obj|drake|baron|herald|pit|setup)/.test(blob)) boost += 20;
    if (focus === "vision" && /(ward|vision|peel|track|river)/.test(blob)) boost += 18;
    if (focus === "fight" && /(engage|fight|all-in|ult)/.test(blob)) boost += 12;

    // Pattern map alignment
    if (pattern === "economy" && /(gold|base|crash|plate|cs|component)/.test(blob)) boost += 8;
    if (pattern === "vision" && /(ward|vision|peel|track)/.test(blob)) boost += 8;
    if (pattern === "map_movement" && /(move|rotate|obj|group|shove)/.test(blob)) boost += 8;
    if (pattern === "fighting" && /(green light|red light|fight|engage|hold)/.test(blob)) boost += 8;
    if (pattern === "game_state" && /(stabilize|spike|survive|best option)/.test(blob)) boost += 6;

    // Affordance alignment
    if (topAfford.has("convert") && /(plate|obj|green light|convert)/.test(blob)) boost += 12;
    if (topAfford.has("hold") && /(hold|red light|inaction|tower range)/.test(blob)) boost += 12;
    if (topAfford.has("reset") && /(base|crash|shop)/.test(blob)) boost += 10;
    if (topAfford.has("leave") && /(base|max range|disengage|give)/.test(blob)) boost += 14;
    if (topAfford.has("mosquito") && /(mosquito|sweat|farm|peel)/.test(blob)) boost += 10;
    if (topAfford.has("jg_farm") && /(camp|clear|high-%|inaction)/.test(blob)) boost += 12;

    // Tempo ownership
    if (tempo === "owning" && /(tower|obj|plate|siege|group)/.test(line)) boost += 10;
    if (tempo === "owning" && /(kill hunt|one more kill|fog chase)/.test(line)) boost -= 15;
    if (tempo === "reacting" && /(hold|farm|mosquito|peel|clear camp|inaction)/.test(line))
      boost += 12;
    if (tempo === "reacting" && /(force|all-in|dive)/.test(line)) boost -= 12;

    // High load → prefer shorter structural safety
    if (load === "high") {
      if (/(hold|base|red light|max range|spawn)/.test(blob)) boost += 8;
      if (/(force|dive|all-in|fog)/.test(blob)) boost -= 10;
    }

    // Fight-role alignment
    const fr = brain.fightRole;
    if (fr === "peel" && /(peel|protect|stack|bodyblock|carry)/.test(blob)) boost += 10;
    if (fr === "dps_backline" && /(max range|dps|tower|group)/.test(blob)) boost += 10;
    if (fr === "secondary_engage" && /(secondary|not first|high-%|hold)/.test(blob)) boost += 8;
    if (fr === "split" && /(mosquito|side|sweat|pressure)/.test(blob)) boost += 10;
    if (fr === "pick" && /(pick|overstep|ward|crash)/.test(blob)) boost += 8;

    // Top mistake-risk suppression
    const topRisk = brain.mistakeRisks[0];
    if (topRisk) {
      if (topRisk.kind === "greed_gold" && /(base|crash)/.test(blob)) boost += 12;
      if (topRisk.kind === "no_man_advantage" && /(red light|hold|inaction)/.test(blob)) boost += 12;
      if (topRisk.kind === "force_behind" && /(farm|camp|high-%|inaction)/.test(blob)) boost += 12;
      if (topRisk.kind === "side_alone" && /(group|stack|vision|max range)/.test(blob)) boost += 10;
      if (topRisk.kind === "first_in" && /(secondary|not first|peel|hold)/.test(blob)) boost += 10;
    }

    if (/best option|green light|red light|move first|crash then/.test(line)) boost += 4;

    // Counterplay alignment
    const cp = brain.counterplay.toLowerCase();
    if (cp.includes("refuse") && /(hold|red light|inaction|farm)/.test(blob)) boost += 8;
    if (cp.includes("force towers") && /(tower|obj|plate|siege)/.test(blob)) boost += 8;

    // Spike timing
    if (brain.spikeNote.includes("reset") && /(base|crash|shop)/.test(blob)) boost += 6;
    if (brain.spikeNote.includes("ult") && /(ult|fight|all-in|engage)/.test(blob)) boost += 5;

    // Win-con script keywords
    const wc = brain.winConLine.toLowerCase();
    if (wc.includes("stabilize") && /(hold|farm|base|high-%)/.test(blob)) boost += 6;
    if (wc.includes("snowball") && /(plate|tower|obj|convert)/.test(blob)) boost += 6;
    if (wc.includes("scale") && /(farm|cs|base|component)/.test(blob)) boost += 5;

    return { ...o, score: o.score + boost };
  });
}

// ─── Formatters ─────────────────────────────────────────────

export function formatBrainForAi(brain: CoachBrainState): string {
  const aff = brain.affordances
    .slice(0, 4)
    .map((x) => `- [${x.strength}] ${x.id}: ${x.invite}`)
    .join("\n");
  const mistakes = brain.mistakeRisks
    .slice(0, 3)
    .map((m) => `- [${m.risk}] ${m.kind}: ${m.label} → ${m.fix}`)
    .join("\n");

  return [
    "## Coach brain (structure — choose with this; don't ignore analytics)",
    brain.read,
    `CONCEPT: ${brain.concept}`,
    `WHY: ${brain.why}`,
    `HIGHEST VALUE NOW: ${brain.highestValue}`,
    `PATTERN MAP: ${brain.pattern}`,
    `MENTAL STACK (check in order): ${brain.mentalStack.join(" → ")}`,
    "THINK: Macro=when+why. Tempo=initiative. Waves=pressure geometry. Vision=tempo loop.",
    "CHOOSE: Best option for THIS role+board that protects or steals tempo.",
    "",
    "### Role OS",
    `IDENTITY: ${brain.roleModel.identity}`,
    `FIGHT ROLE: ${brain.fightRole} — ${brain.fightRoleNote}`,
    `WIN CON SCRIPT: ${brain.winConLine}`,
    `COUNTERPLAY: ${brain.counterplay}`,
    "ROLE PRIORITIES NOW:",
    ...brain.rolePriorities.slice(0, 4).map((p) => `- ${p}`),
    "",
    "### Phase script",
    brain.phaseHeadline,
    ...brain.phasePriorities.slice(0, 4).map((p) => `- ${p}`),
    "",
    "### Next ~60s plan",
    ...brain.nextMinute.map((s, i) => `${i + 1}. ${s}`),
    `MAP CLOCK: ${brain.mapClock}`,
    brain.throwLadder ? `THROW LADDER: ${brain.throwLadder}` : "",
    "",
    "### Decision checklist (answer before forcing a play)",
    `WHAT: ${brain.checklist.what}`,
    `WHY: ${brain.checklist.why}`,
    `GAIN: ${brain.checklist.gain}`,
    `COST: ${brain.checklist.cost}`,
    `WORTH IT: ${brain.checklist.worthIt}`,
    "",
    "### Board affordances (legal invites)",
    aff || "- (none strong)",
    "",
    "### Mistake risks on this board",
    mistakes || "- (low)",
    brain.threat
      ? `THREAT MODEL: ${brain.threat.name} [${brain.threat.severity}] — ${brain.threat.respect}`
      : "THREAT MODEL: none marked fed",
    "",
    "## Growth brain (science-informed)",
    `LO (one only): ${brain.growth.learningObjective}`,
    `TRAINS: ${brain.growth.trains} · ${brain.growth.practiceIntent}`,
    `NOTE: ${brain.growth.growthNote}`,
    "RULES: Hours≠skill without feedback. One LO/block. Flexibility=switch jobs. Inhibition=skip low-%.",
    loadLine(brain),
    "",
    "### VOD seeds (post-game)",
    ...brain.vodSeeds.map((s) => `- ${s}`),
    "### Review questions",
    ...brain.reviewQuestions.map((q) => `- ${q}`),
  ].join("\n");
}

function loadLine(brain: CoachBrainState): string {
  if (brain.load === "high") {
    return "LOAD: HIGH — keep callouts ultra short; prefer hold/reset safety; no multi-tip essays.";
  }
  if (brain.load === "medium") {
    return "LOAD: MEDIUM — one fact + one play; optional short why.";
  }
  return "LOAD: LOW — can include brief structural why.";
}

export function formatGrowthProtocol(brain: CoachBrainState): string {
  return [
    `Learning objective: ${brain.growth.learningObjective}`,
    `Trains: ${brain.growth.trains}`,
    `Block plan: ${brain.growth.practiceIntent}`,
    `Highest value now: ${brain.highestValue}`,
    `Fight role: ${brain.fightRole}`,
    `Next minute: ${brain.nextMinute.join(" → ")}`,
    brain.mistakeRisks[0]
      ? `Top risk: ${brain.mistakeRisks[0].label} → ${brain.mistakeRisks[0].fix}`
      : "Top risk: none elevated",
    "After 2–3 games: when did you lose tempo? one habit to subtract next block.",
    ...brain.vodSeeds.slice(0, 2).map((s) => `VOD: ${s}`),
  ].join("\n");
}

export function brainSpeakHint(brain: CoachBrainState, champ: string): string {
  const fightBit =
    brain.fightRole === "peel"
      ? " fight job peel"
      : brain.fightRole === "dps_backline"
        ? " fight job max-range DPS"
        : brain.fightRole === "secondary_engage"
          ? " not first in"
          : brain.fightRole === "split"
            ? " side pressure"
            : "";

  // High load: ultra short safety
  if (brain.load === "high") {
    if (brain.focus === "survive") return `${champ}: leave / base — don't donate.`;
    if (brain.focus === "numbers" && brain.tempo === "reacting")
      return `${champ}: red light — hold for spawn.`;
    if (brain.focus === "numbers") return `${champ}: convert numbers now or hold.`;
    return `${champ}: one job — ${brain.focus}.`;
  }

  // Prefer highest-value phrasing when load allows
  if (brain.highestValue) {
    let short =
      brain.highestValue.length > 88
        ? brain.highestValue.slice(0, 85) + "…"
        : brain.highestValue;
    // Attach fight role on fight/numbers windows only
    if (
      fightBit &&
      (brain.focus === "fight" || brain.focus === "numbers" || brain.focus === "objective") &&
      short.length < 70
    ) {
      short = `${short} —${fightBit}`;
    }
    return `${champ}: ${short}`;
  }

  switch (brain.focus) {
    case "survive":
      return `${champ}: structure first — fix HP/gold before macro.`;
    case "reset":
      return `${champ}: reset timing — crash then base to own next tempo.`;
    case "wave":
      return `${champ}: wave is leverage — crash or catch before you move.`;
    case "tempo":
      return brain.tempo === "owning"
        ? `${champ}: you own tempo — take towers/obj, don't donate it.`
        : `${champ}: fight for tempo — move first after the next crash.`;
    case "numbers":
      return `${champ}: numbers window — green light convert or red light hold${fightBit}.`;
    case "objective":
      return `${champ}: obj structure — wave + numbers before pit${fightBit}.`;
    case "vision":
      return `${champ}: vision is tempo — ward after you move first.`;
    case "fight":
      return `${champ}: fight only with intention and numbers${fightBit}.`;
    default:
      return `${champ}: ${brain.concept}`;
  }
}

/** Compact HUD string for desktop debug / future UI */
export function formatBrainHud(brain: CoachBrainState): string {
  return [
    `${brain.tempo.toUpperCase()} ${brain.tempoScore > 0 ? "+" : ""}${brain.tempoScore}`,
    brain.focus,
    brain.fightRole,
    brain.pattern,
    brain.threat ? `⚠${brain.threat.name}` : "",
    brain.load === "high" ? "LOAD↑" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Sticky LO helper for multi-game blocks (session memory — caller stores) */
export function mergeSessionLearningObjective(
  previousLo: string | null | undefined,
  brain: CoachBrainState,
  opts?: { forceRefresh?: boolean }
): string {
  if (opts?.forceRefresh || !previousLo?.trim()) {
    return brain.growth.learningObjective;
  }
  // Keep sticky LO unless board is survive-critical
  if (brain.focus === "survive" || brain.load === "high") {
    return brain.growth.learningObjective;
  }
  return previousLo.trim();
}

const BLOCK_LO_KEY = "rc_block_learning_objective";
const BLOCK_LO_GAMES_KEY = "rc_block_lo_games";

/** Cross-game LO for 3-game deliberate practice blocks (localStorage) */
export function loadBlockLearningObjective(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(BLOCK_LO_KEY);
  } catch {
    return null;
  }
}

export function saveBlockLearningObjective(lo: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BLOCK_LO_KEY, lo.trim());
    const n = Number(localStorage.getItem(BLOCK_LO_GAMES_KEY) || "0");
    localStorage.setItem(BLOCK_LO_GAMES_KEY, String(n + 1));
  } catch {
    /* ignore */
  }
}

/** After 3 games, clear block LO so a new focus can form */
export function maybeRotateBlockLearningObjective(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const n = Number(localStorage.getItem(BLOCK_LO_GAMES_KEY) || "0");
    if (n >= 3) {
      localStorage.removeItem(BLOCK_LO_KEY);
      localStorage.setItem(BLOCK_LO_GAMES_KEY, "0");
    }
  } catch {
    /* ignore */
  }
}

/** Prefer block LO → sticky match LO → fresh brain LO */
export function resolveLearningObjective(
  brain: CoachBrainState,
  matchSticky: string | null | undefined
): string {
  const block = loadBlockLearningObjective();
  if (block?.trim()) return block.trim();
  if (matchSticky?.trim()) return matchSticky.trim();
  return brain.growth.learningObjective;
}

/** One-liner for post-game card */
export function formatPostGameLoCard(
  lo: string,
  gradeLetter?: string,
  topHabit?: string
): string {
  const bits = [
    `Next queue LO: ${lo}`,
    gradeLetter ? `Last grade: ${gradeLetter}` : "",
    topHabit ? `Habit to kill: ${topHabit}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

/** Top mistake risk as a speakable warning (optional secondary toast) */
export function topMistakeWarning(brain: CoachBrainState, champ: string): string | null {
  const m = brain.mistakeRisks[0];
  if (!m || m.risk < 55) return null;
  return `${champ}: risk ${m.label.toLowerCase()} — ${m.fix}`;
}
