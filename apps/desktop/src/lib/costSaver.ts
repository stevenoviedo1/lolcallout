/**
 * Cost / frequency controls.
 * Coach still only speaks when insight score clears the threshold (no timer filler).
 * "Urgent only" narrows which cleared insights may voice — default OFF so the guide
 * can talk whenever the board is worth a line.
 */

export type CalloutKind =
  | "death"
  | "base"
  | "low_hp"
  | "objective"
  | "level_up"
  | "game_end"
  | "shutdown"
  | "tempo"
  | "kill"
  | "match_start"
  | "numbers"
  | "generic";

export interface CostSaverPrefs {
  /**
   * When true: high-impact kinds only (death, HP, numbers, kills, obj…).
   * When false (default): any insight that cleared the score gate may speak.
   */
  urgentVoiceOnly: boolean;
  maxSpokenPerGame: number;
  /** Always use AI for cues when session + key available */
  backgroundAiCallouts: boolean;
  maxAiCalloutsPerGame: number;
}

export const DEFAULT_COST_SAVER: CostSaverPrefs = {
  // Guide mode: speak every worthy insight (score gate is the filter)
  urgentVoiceOnly: false,
  maxSpokenPerGame: 80,
  backgroundAiCallouts: true,
  maxAiCalloutsPerGame: 60,
};

/** High-impact moments when "impact only" is ON */
const LIVE_SPEAK: CalloutKind[] = [
  "death",
  "low_hp",
  "base",
  "tempo",
  "kill",
  "numbers",
  "match_start",
  "objective",
  "level_up",
  "shutdown",
  "game_end",
];

export function isUrgentKind(kind: string): boolean {
  return LIVE_SPEAK.includes(kind as CalloutKind);
}

export function shouldSpeakCallout(
  kind: string,
  prefs: CostSaverPrefs,
  spokenSoFar: number
): boolean {
  if (spokenSoFar >= prefs.maxSpokenPerGame) return false;
  if (prefs.urgentVoiceOnly) return isUrgentKind(kind);
  return true;
}

export function shouldRunAiCallout(
  prefs: CostSaverPrefs,
  aiCalloutsSoFar: number
): boolean {
  if (prefs.backgroundAiCallouts !== true) return false;
  return aiCalloutsSoFar < prefs.maxAiCalloutsPerGame;
}
