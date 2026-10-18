/**
 * AI coaching no longer runs on this server. All generation happens locally on
 * the player's PC (apps/agent → Ollama). The server only keeps auth, Stripe,
 * sessions and stores summaries the desktop generated locally.
 */

export const AI_GONE_MESSAGE =
  "AI coaching now runs locally on your PC (Ollama via the LOLCallout agent). Update the desktop app — this server no longer generates AI replies.";

export function coachAiStatus() {
  return {
    configured: false,
    mode: "local" as const,
    note: "AI runs on the player's PC via Ollama; server has no AI provider.",
    appDesktopTarget: "0.6.0",
  };
}

export function parseSummaryBullets(raw: string): {
  bullets: string[];
  focusAreas: string[];
} {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"))
    .map((l) => l.replace(/^[-•*]\s*/, ""))
    .slice(0, 6);
  const focusAreas = bullets.slice(0, 3);
  if (bullets.length === 0) {
    return {
      bullets: [raw.slice(0, 280)],
      focusAreas: ["Review VOD of first death", "CS consistency", "Objective timers"],
    };
  }
  return { bullets, focusAreas };
}
