/** Session goals + post-game grading */

export type GoalId = "cs_pace" | "deaths_cap" | "kda_floor" | "survive_early";

export interface SessionGoal {
  id: GoalId;
  label: string;
  /** Target value depending on goal */
  target: number;
}

export interface GoalResult {
  id: GoalId;
  label: string;
  target: number;
  actual: number;
  passed: boolean;
  detail: string;
}

export interface MatchGrade {
  letter: "S" | "A" | "B" | "C" | "D" | "F";
  score: number; // 0-100
  summary: string;
  goals: GoalResult[];
  habits: string[];
}

/** Session learning objectives (Meeko-style focus for the queue block) */
export const DEFAULT_GOALS: SessionGoal[] = [
  { id: "cs_pace", label: "Learning: CS pace (per 10)", target: 70 },
  { id: "deaths_cap", label: "Learning: deaths under", target: 5 },
  { id: "survive_early", label: "Learning: deaths before 14:00 under", target: 2 },
];

export function gradeMatch(input: {
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  gameTimeSec: number;
  earlyDeaths: number;
  goals?: SessionGoal[];
  repeatDeathPattern?: string | null;
}): MatchGrade {
  const goals = input.goals?.length ? input.goals : DEFAULT_GOALS;
  const minutes = Math.max(input.gameTimeSec / 60, 1);
  const csPer10 = (input.creeps / minutes) * 10;
  const kda =
    input.deaths === 0
      ? input.kills + input.assists
      : (input.kills + input.assists) / Math.max(input.deaths, 1);

  const results: GoalResult[] = goals.map((g) => {
    if (g.id === "cs_pace") {
      const actual = Math.round(csPer10 * 10) / 10;
      const passed = actual >= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual,
        passed,
        detail: `${actual} CS/10 (target ${g.target})`,
      };
    }
    if (g.id === "deaths_cap") {
      const passed = input.deaths <= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual: input.deaths,
        passed,
        detail: `${input.deaths} deaths (cap ${g.target})`,
      };
    }
    if (g.id === "survive_early") {
      const passed = input.earlyDeaths <= g.target;
      return {
        id: g.id,
        label: g.label,
        target: g.target,
        actual: input.earlyDeaths,
        passed,
        detail: `${input.earlyDeaths} deaths before 14:00 (cap ${g.target})`,
      };
    }
    // kda_floor
    const actual = Math.round(kda * 100) / 100;
    const passed = actual >= g.target;
    return {
      id: g.id,
      label: g.label,
      target: g.target,
      actual,
      passed,
      detail: `KDA ratio ${actual} (target ${g.target})`,
    };
  });

  let score = 55;
  // KDA influence
  score += Math.min(20, kda * 4);
  score -= Math.min(25, input.deaths * 4);
  score += Math.min(15, csPer10 / 8);
  if (input.earlyDeaths <= 1) score += 8;
  if (input.earlyDeaths >= 3) score -= 10;
  const passedCount = results.filter((r) => r.passed).length;
  score += passedCount * 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let letter: MatchGrade["letter"] = "C";
  if (score >= 92) letter = "S";
  else if (score >= 85) letter = "A";
  else if (score >= 72) letter = "B";
  else if (score >= 58) letter = "C";
  else if (score >= 40) letter = "D";
  else letter = "F";

  // Consistency ep: high-% discipline, man advantage, lose gracefully
  const habits: string[] = [];
  if (input.repeatDeathPattern) {
    habits.push(`Low-% loop: ${input.repeatDeathPattern} — subtract it; keep the rest.`);
  }
  if (input.deaths >= 6) {
    habits.push("Man advantage first: most throws are low-% into bad numbers — red light holds.");
  }
  if (input.earlyDeaths >= 3) {
    habits.push("Survive to 14: only high-% with allies visible — comfort with inaction.");
  }
  if (csPer10 < 60) {
    habits.push("Logistics: crash before base — high-% gold, not ego trades.");
  }
  if (!habits.length) {
    habits.push("Only high-% plays you can explain (numbers, HP, CDs, allies).");
    habits.push("Behind: lose gracefully — mosquito pressure, make them sweat, don't roll over.");
  }
  if (habits.length < 3) {
    habits.push("Review: when did you lose tempo/control — not only why you lost the game.");
  }
  if (habits.length < 3) {
    habits.push("Tight LP curve: mid-50s on games you control; one rank at a time.");
  }

  const summary = `${letter} grade (${score}/100) · ${input.kills}/${input.deaths}/${input.assists} · ${input.creeps} CS · ${passedCount}/${results.length} learning objectives`;

  return { letter, score, summary, goals: results, habits: habits.slice(0, 3) };
}
