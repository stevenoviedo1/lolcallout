/**
 * Frequency controls. AI now runs locally (free), so caps exist only to keep
 * the player's GPU from being hammered mid-fight and to avoid voice spam.
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
  /** Use local AI for cues when Ollama + model are available */
  backgroundAiCallouts: boolean;
  /** Soft per-match ceiling (local = free; this is a sanity cap, not a budget) */
  maxAiCalloutsPerGame: number;
  /** Minimum gap between local AI generations so the GPU stays free for the game */
  minAiGapMs: number;
}

export const DEFAULT_COST_SAVER: CostSaverPrefs = {
  // Guide mode: speak worthy insights (score gate + 5-min theme cool)
  urgentVoiceOnly: false,
  /** Cap spoken lines per match (cost + less spam) */
  maxSpokenPerGame: 36,
  backgroundAiCallouts: true,
  /** Local AI is free — generous cap; the rate gap is what protects FPS */
  maxAiCalloutsPerGame: 120,
  /** ≥8s between local generations (agent also runs one generation at a time) */
  minAiGapMs: 8_000,
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
  aiCalloutsSoFar: number,
  lastAiAt = 0,
  now = Date.now()
): boolean {
  if (prefs.backgroundAiCallouts !== true) return false;
  const gap = prefs.minAiGapMs ?? DEFAULT_COST_SAVER.minAiGapMs;
  if (lastAiAt && now - lastAiAt < gap) return false;
  return aiCalloutsSoFar < (prefs.maxAiCalloutsPerGame ?? DEFAULT_COST_SAVER.maxAiCalloutsPerGame);
}
