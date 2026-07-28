/**
 * Static coaching models that feed the live coach brain.
 * ADDITIVE knowledge base — role OS, phase scripts, fight roles, mistake taxonomy.
 * Not live state; pure reference + pure functions over MatchAnalytics.
 */

import type { MatchAnalytics, MacroPhase, WinCon } from "./analytics.js";

export type FightRole =
  | "engage"
  | "secondary_engage"
  | "peel"
  | "poke"
  | "dps_backline"
  | "front_to_back"
  | "pick"
  | "split"
  | "setup";

export type MistakeKind =
  | "low_pct_fight"
  | "unsynced_reset"
  | "no_man_advantage"
  | "first_in"
  | "greed_gold"
  | "late_obj"
  | "side_alone"
  | "force_behind"
  | "ignore_threat"
  | "idle_map";

export interface RoleModel {
  role: MatchAnalytics["you"]["roleHint"];
  /** What this role's "job OS" is */
  identity: string;
  /** Default fight role */
  defaultFightRole: FightRole;
  /** Phase priorities (early → late) */
  earlyPriorities: string[];
  midPriorities: string[];
  latePriorities: string[];
  /** Common egregious mistakes for this role */
  commonMistakes: MistakeKind[];
  /** One-line "best default" when board is quiet */
  quietDefault: string;
}

export interface PhaseScript {
  phase: MacroPhase;
  headline: string;
  priorities: string[];
  avoid: string[];
}

export interface ThreatModel {
  name: string;
  severity: "soft" | "hard" | "delete";
  respect: string;
  onlyFightWhen: string;
}

export interface MistakeRisk {
  kind: MistakeKind;
  risk: number; // 0–100 current board risk
  label: string;
  fix: string;
}

const ROLE_MODELS: Record<MatchAnalytics["you"]["roleHint"], RoleModel> = {
  SUPPORT: {
    role: "SUPPORT",
    identity: "Enable map: crash → vision → peel/engage on timer",
    defaultFightRole: "peel",
    earlyPriorities: [
      "Crash bot before roam",
      "River/tri vision on timer",
      "Track ADC location always",
      "Only all-in with level/numbers",
    ],
    midPriorities: [
      "Ward ahead of group",
      "Peel for highest threat to carries",
      "Move first after crash — no idle bot",
      "Set obj vision 30–40s early",
    ],
    latePriorities: [
      "Face-check is not your job alone",
      "Peel vs dive; engage only if that's your kit",
      "Control wards + deny vision",
      "Die for carry only if trade is winning",
    ],
    commonMistakes: ["idle_map", "first_in", "side_alone", "low_pct_fight"],
    quietDefault: "Crash nearest wave, set vision, stack with carry",
  },
  JUNGLE: {
    role: "JUNGLE",
    identity: "Set the map's pulse: camps tempo → high-% looks → obj setup",
    defaultFightRole: "secondary_engage",
    earlyPriorities: [
      "Full clear into first scuttle unless free gank",
      "Gank only shoved / low-HP / no-summ lanes",
      "Track enemy jg by camps + lane prio (no fog invent)",
      "Comfort with inaction between looks",
    ],
    midPriorities: [
      "You call start/no-start on obj",
      "Farm opposite when lanes dead",
      "Vision into next obj with lead",
      "Skip low-% mid river walks",
    ],
    latePriorities: [
      "Smite + numbers before pit",
      "Flank or peel by kit — not random",
      "Protect lead: no solo invades without info",
      "Match split with cover or collapse",
    ],
    commonMistakes: ["low_pct_fight", "force_behind", "late_obj", "no_man_advantage"],
    quietDefault: "Clear toward high-% lane or next obj setup",
  },
  CARRY: {
    role: "CARRY",
    identity: "DPS + spacing: wave → item → max-range damage",
    defaultFightRole: "dps_backline",
    earlyPriorities: [
      "CS under tower if pressured",
      "Trade only with minion + support",
      "Crash before base",
      "No river alone",
    ],
    midPriorities: [
      "Share side/mid waves with team",
      "Reset on spike gold",
      "Group for obj with DPS angle",
      "Never first face-check",
    ],
    latePriorities: [
      "Max range — you are the win con often",
      "Position for front-to-back",
      "No side alone vs fed threat",
      "Take towers after won fights",
    ],
    commonMistakes: ["side_alone", "first_in", "greed_gold", "ignore_threat"],
    quietDefault: "Crash wave, stay with vision, prep next DPS fight",
  },
  FLEX: {
    role: "FLEX",
    identity: "Lane + map hybrid: wave ownership then first move",
    defaultFightRole: "pick",
    earlyPriorities: [
      "Wave first — freeze weak, shove to move",
      "Track deaths on board before all-in",
      "Crash → base or roam",
      "Respect level gaps",
    ],
    midPriorities: [
      "Side wave into mid prio",
      "TP/move only with crash",
      "Convert leads to plates/towers",
      "Don't chase past river",
    ],
    latePriorities: [
      "Split only if team can receive pressure",
      "Group for soul/baron/elder",
      "Know engage vs peel by kit",
      "Spend gold — no full-build walk-up int",
    ],
    commonMistakes: ["unsynced_reset", "low_pct_fight", "side_alone", "force_behind"],
    quietDefault: "Shove then move first — force them to react",
  },
};

export function getRoleModel(role: MatchAnalytics["you"]["roleHint"]): RoleModel {
  return ROLE_MODELS[role] || ROLE_MODELS.FLEX;
}

export function phaseScript(phase: MacroPhase): PhaseScript {
  switch (phase) {
    case "early":
      return {
        phase: "early",
        headline: "Early: waves, levels, first spike — not tab theory essays",
        priorities: [
          "Own first 3 waves / clear path",
          "Track deaths before forcing",
          "Crash before base",
          "High-% only with level or numbers",
        ],
        avoid: ["River without info", "All-in down levels", "Sit on buy gold"],
      };
    case "mid":
      return {
        phase: "mid",
        headline: "Mid: tempo loops — crash → move → vision/obj",
        priorities: [
          "Sync resets with wave",
          "Arrive first to obj setups",
          "Convert man advantage windows",
          "Spend leads on towers",
        ],
        avoid: ["Unsynced bases", "Random mid skirmish", "Ignore side waves"],
      };
    case "late":
    default:
      return {
        phase: "late",
        headline: "Late: one fight / one obj decides — structure over heroics",
        priorities: [
          "Group with win-con plan",
          "Vision before pit",
          "Max-range / role job in fight",
          "No solo sides vs fed threats",
        ],
        avoid: ["Facecheck", "Drip-feed 1v5", "Chase past inhib without vision"],
      };
  }
}

export function inferFightRole(
  a: MatchAnalytics,
  roleModel: RoleModel
): { role: FightRole; note: string } {
  const role = a.you.roleHint;
  const kit = a.you.champ;
  const manAdv = a.team.alive - a.enemy.alive;

  if (role === "SUPPORT") {
    if (a.winCon === "protect_carry" || a.pressure === "losing") {
      return { role: "peel", note: `${kit}: peel job — bodyblock threats, not side quests` };
    }
    if (manAdv >= 1 && a.pressure === "winning") {
      return { role: "setup", note: `${kit}: setup vision/engage for the convert` };
    }
    return { role: roleModel.defaultFightRole, note: `${kit}: default support — enable, don't idle` };
  }
  if (role === "JUNGLE") {
    if (manAdv < 0 || a.team.dead >= 2) {
      return { role: "setup", note: `${kit}: jg — no force; farm and set next look` };
    }
    return {
      role: "secondary_engage",
      note: `${kit}: secondary engage — let them blow CDs first when possible`,
    };
  }
  if (role === "CARRY") {
    if (a.phase === "late" || a.winCon === "protect_carry") {
      return { role: "dps_backline", note: `${kit}: max-range DPS — never first in` };
    }
    return { role: "dps_backline", note: `${kit}: DPS windows after team starts` };
  }
  // FLEX / top-mid
  if (a.winCon === "pick" || a.winCon === "snowball") {
    return { role: "pick", note: `${kit}: look for overstep picks, skip blind 5v5` };
  }
  if (a.winCon === "siege" || a.winCon === "close_game") {
    return { role: "front_to_back", note: `${kit}: wave into tower / group fight plan` };
  }
  if (a.pressure === "losing" && a.phase !== "early") {
    return { role: "split", note: `${kit}: mosquito side pressure if kit allows — make them sweat` };
  }
  return { role: roleModel.defaultFightRole, note: `${kit}: play identity — ${roleModel.identity}` };
}

export function buildThreatModel(a: MatchAnalytics): ThreatModel | null {
  const raw = a.fedEnemies[0];
  if (!raw) return null;
  const name = raw.split("(")[0].trim();
  // Heuristic severity from kill lead pressure + name presence
  const hard =
    a.pressure === "losing" || a.killLead <= -3 || /assassin|zed|talon|rengar|kha|pyke/i.test(name);
  const severity: ThreatModel["severity"] = hard
    ? "delete"
    : a.killLead <= -1
      ? "hard"
      : "soft";
  return {
    name,
    severity,
    respect:
      severity === "delete"
        ? `Only fight ${name} with CC + numbers — never first in or side alone`
        : `Track ${name}; no facecheck into them`,
    onlyFightWhen:
      severity === "delete"
        ? "Flash/ult down or 2+ allies with you"
        : "You have man advantage or wave crash + exit",
  };
}

export function assessMistakeRisks(a: MatchAnalytics): MistakeRisk[] {
  const risks: MistakeRisk[] = [];
  const manAdv = a.team.alive - a.enemy.alive;
  const hp = a.you.hpPct;
  const gold = a.you.gold;
  const role = a.you.roleHint;

  const add = (kind: MistakeKind, risk: number, label: string, fix: string) => {
    if (risk >= 25) risks.push({ kind, risk: Math.min(100, risk), label, fix });
  };

  if (manAdv <= -1 && !a.you.isDead) {
    add(
      "no_man_advantage",
      50 + Math.abs(manAdv) * 15,
      "Fighting without numbers",
      "Red light — hold until spawn or vision"
    );
  }
  if (hp != null && hp < 32 && gold >= 600 && !a.noRecall) {
    add("greed_gold", 70, "Low HP with gold still on the map", "Base now — don't donate");
  } else if (gold >= 1400 && !a.noRecall && a.enemy.dead < 2) {
    add("unsynced_reset", 55, "Sitting on spike gold", "Crash one wave then base");
  }
  if (a.fedEnemies[0] && a.pressure !== "winning") {
    const fed = a.fedEnemies[0].split("(")[0].trim();
    add(
      "ignore_threat",
      50,
      `Ignoring fed ${fed}`,
      "Secondary engage only; no side alone"
    );
  }
  if (a.team.dead >= 2) {
    add("low_pct_fight", 75, "Contesting while allies dead", "Clear safe wave; skip river");
  }
  if (role === "CARRY" && a.phase === "late" && manAdv <= 0) {
    add("side_alone", 45, "Carry isolation risk late", "Stack with team vision");
  }
  if (role === "SUPPORT" && a.minute < 14 && a.killLead <= 0) {
    add("idle_map", 40, "Support idling without crash-move", "Crash bot then roam/ward");
  }
  if (role === "JUNGLE" && a.pressure === "losing" && manAdv <= 0) {
    add("force_behind", 55, "Forcing ganks while behind", "Farm camps; only high-% looks");
  }
  if (a.objectiveWindows[0] && a.minute >= 12 && tempoLate(a) && manAdv < 0) {
    add("late_obj", 50, "Walking late to obj without numbers", "Shove first or trade opposite");
  }
  if (hp != null && hp > 60 && manAdv >= 1 && a.you.roleHint !== "CARRY") {
    // first_in risk for non-carries when they might ego
    add("first_in", 30, "Ego first-engage risk", "Know fight role — secondary if not engage kit");
  }

  return risks.sort((x, y) => y.risk - x.risk).slice(0, 5);
}

function tempoLate(a: MatchAnalytics): boolean {
  return a.pressure === "losing" || a.killLead < 0;
}

export function winConScript(winCon: WinCon, a: MatchAnalytics): string {
  const c = a.you.champ;
  switch (winCon) {
    case "stabilize":
      return `${c}: stabilize script — farm, red-light ego, wait for their overstep`;
    case "snowball":
      return `${c}: snowball script — crash → plate/roam; force tempo not idle CS`;
    case "scale":
      return `${c}: scale script — hit item, then high-% fights; mosquito if behind, not AFK`;
    case "protect_carry":
      return `${c}: peel script — bodyblock threats; stack on carry`;
    case "pick":
      return `${c}: pick script — ward choke, punish overstep, skip blind 5v5`;
    case "siege":
      return `${c}: siege script — wave into tower, stop chase past river`;
    case "close_game":
      return `${c}: close script — group baron/elder, no solo sides`;
    case "teamfight":
    default:
      return `${c}: teamfight script — know role, green light only with numbers`;
  }
}

export function nextMinutePlan(a: MatchAnalytics, fightNote: string): string[] {
  const steps: string[] = [];
  const manAdv = a.team.alive - a.enemy.alive;
  if (a.you.isDead) {
    steps.push("Spawn → shop if gold");
    steps.push("Nearest safe wave");
    steps.push("Rejoin only with allies/info");
    return steps;
  }
  if (a.you.hpPct != null && a.you.hpPct < 28) {
    steps.push(a.noRecall ? "Max range only" : "Leave wave → base");
    steps.push("Return full before fights");
    return steps;
  }
  if (manAdv <= -2 || a.team.dead >= 2) {
    steps.push("Hold tower range");
    steps.push("Clear nearest safe wave");
    steps.push("Wait spawn → reassess numbers");
    return steps;
  }
  if (a.enemy.dead >= 2) {
    steps.push("Convert: plates or start obj");
    if (a.you.gold >= 1200 && !a.noRecall) steps.push("Then base on spike gold");
    return steps;
  }
  if (!a.noRecall && a.you.gold >= 1300) {
    steps.push("Crash one wave");
    steps.push("Base for component/item");
    steps.push("Move first after reset");
    return steps;
  }
  steps.push("Crash or catch wave");
  steps.push(fightNote.includes("peel") ? "Stack with carry/vision" : "Move first with allies");
  if (a.objectiveWindows[0] && a.minute >= 8) {
    steps.push(`Orient to ${a.objectiveWindows[0].split("—")[0].trim()}`);
  }
  return steps.slice(0, 4);
}

export function rolePrioritiesNow(a: MatchAnalytics, model: RoleModel): string[] {
  if (a.phase === "early") return model.earlyPriorities;
  if (a.phase === "late") return model.latePriorities;
  return model.midPriorities;
}
