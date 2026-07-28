/** Cost / frequency controls — still allows real coaching */

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
   * When true: speak high-value moments only.
   * When false: speak almost every signal (more talkative).
   */
  urgentVoiceOnly: boolean;
  maxSpokenPerGame: number;
  /** Always use AI for cues when session + key available */
  backgroundAiCallouts: boolean;
  maxAiCalloutsPerGame: number;
}

export const DEFAULT_COST_SAVER: CostSaverPrefs = {
  // Keep ON but tempo/kills/numbers are in LIVE_SPEAK so you still get live guide
  urgentVoiceOnly: true,
  maxSpokenPerGame: 50,
  backgroundAiCallouts: true,
  maxAiCalloutsPerGame: 50,
};

/** High-value moments when Cost Saver is ON (include level spikes) */
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
