/**
 * Premium strategy layer — turns analytics into coach jobs.
 */

import type { MatchAnalytics, WinCon } from "./analytics.js";

export interface StrategyPlan {
  winCon: WinCon;
  winConLabel: string;
  /** 20–40s job */
  immediateJob: string;
  /** Macro for this phase */
  macroPlan: string;
  /** What to avoid */
  avoid: string;
  /** Logistics: buy/base/vision/group */
  logistics: string[];
  /** Speakable one-liner */
  speak: string;
}

const WIN_CON_LABEL: Record<WinCon, string> = {
  scale: "Scale cleanly",
  snowball: "Snowball lead",
  protect_carry: "Protect / enable carry",
  pick: "Play for picks",
  siege: "Siege and take towers",
  teamfight: "Win the next teamfight",
  stabilize: "Stabilize and stop the bleed",
  close_game: "Close the game",
};

export function buildStrategyPlan(a: MatchAnalytics, speakLine: string): StrategyPlan {
  const phaseMacro: Record<string, string> = {
    early: a.you.roleHint === "SUPPORT"
      ? "Crash wave → ward/roam → return for next crash."
      : "Wave ownership first; only fight with minion + level advantage.",
    mid: "Shove → rotate mid/obj → reset on gold — no dead time in side brush.",
    late: "Catch one wave → regroup → only take fights with vision + numbers.",
  };

  const logistics: string[] = [];
  if (!a.noRecall && a.you.gold >= 1100 && !a.you.isDead) {
    logistics.push(`Base window: ${a.you.gold}g in pocket`);
  }
  if (a.noRecall && a.you.gold >= 1000) {
    logistics.push(`ARAM shop on next death: ${a.you.gold}g`);
  }
  if (a.team.dead >= 1) {
    logistics.push(`Wait for ${a.team.dead} ally respawn before hard engage`);
  }
  if (a.objectiveWindows[0]) logistics.push(`Clock: ${a.objectiveWindows[0]}`);
  if (a.fedEnemies[0]) logistics.push(`Threat track: ${a.fedEnemies[0]}`);
  if (a.you.powerSpike) logistics.push(`Spike: ${a.you.powerSpike}`);

  let avoid = "Don't force a blind 50/50 without numbers.";
  if (a.pressure === "losing") avoid = "No ego all-ins — stop donating gold.";
  if (a.pressure === "winning") avoid = "Don't chase into fog or throw the lead.";
  if (a.aram) avoid = "No solo side walk after a fight; hold for the pack.";

  return {
    winCon: a.winCon,
    winConLabel: WIN_CON_LABEL[a.winCon],
    immediateJob: speakLine,
    macroPlan: phaseMacro[a.phase] || phaseMacro.mid,
    avoid,
    logistics,
    speak: speakLine,
  };
}

export function formatStrategyForAi(plan: StrategyPlan): string {
  return [
    `STRATEGY`,
    `WIN_CON: ${plan.winConLabel} (${plan.winCon})`,
    `IMMEDIATE_JOB: ${plan.immediateJob}`,
    `MACRO: ${plan.macroPlan}`,
    `AVOID: ${plan.avoid}`,
    plan.logistics.length ? `LOGISTICS:\n${plan.logistics.map((l) => `- ${l}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
