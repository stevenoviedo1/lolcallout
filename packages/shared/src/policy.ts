/**
 * Riot-policy filter for LIVE callouts (docs/RIOT_POLICY.md).
 * Rejects commands, countdowns-to-act, enemy cooldown/ult timers and opponent
 * predictions. Post-game and champ select text is NOT run through this.
 */

const ALWAYS_BANNED: [RegExp, string][] = [
  [/\bnow\b/i, "now"],
  [/\b(go|goes|leave|collapse|focus|dive|rush|hurry)\b/i, "imperative verb"],
  [/\b(you (should|must|need to|have to))\b/i, "prescription"],
  [/\bbest (option|play|move) is\b/i, "chooses for the player"],
  [/\b(cooldown|cd)s?\b/i, "cooldown"],
  [/\b(flash|ult|ultimate|r|summoners?)\s+(is\s+)?(down|up|back|ready|burned|used)\b/i, "enemy ability state"],
  [/\b(in|for)\s+~?\d+\s*(s|sec|secs|seconds)\b/i, "countdown"],
  [/\b(expect|about to|is going to|will (probably|likely|try|force|come))\b/i, "opponent prediction"],
  [/\b(jungle (path|route)|is (top|bot|mid)side|in the fog)\b/i, "hidden-info tracking"],
];

/** Imperative verbs that are fine mid-sentence ("trades you take") but not as a command. */
const IMPERATIVE_START = /(^|[.!?:;—–-]\s*|,\s*|\b(then|and)\s+)(take|base|recall|back|push|shove|fight|group|kill|engage|all[- ]in|start|ward|buy|hit|reset|rotate|stop|avoid|don't|do not|play|farm|kite|hold|wait|chase|invade|contest|trade|flip)\b(?!\s+(is|are|or|and|vs|options?|timing|window)\b|[,—–-])/i;

export interface PolicyVerdict {
  ok: boolean;
  reasons: string[];
}

export function checkLivePolicy(line: string): PolicyVerdict {
  const text = String(line || "").replace(/^(CALLOUT|LIVE|NEXT|NOTE):\s*/gim, "");
  const reasons: string[] = [];
  for (const [re, why] of ALWAYS_BANNED) if (re.test(text)) reasons.push(why);
  if (IMPERATIVE_START.test(text)) reasons.push("imperative");
  if (/!{1,}/.test(text) && /[A-Z]{4,}/.test(text)) reasons.push("shouting");
  return { ok: reasons.length === 0, reasons };
}

export function isLivePolicySafe(line: string): boolean {
  return checkLivePolicy(line).ok;
}
