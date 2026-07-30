/**
 * Coach voice modes — player picks the vibe; coaching facts stay the same.
 * friend  = calm supportive duo
 * hype    = AI bro — natural full sentences, praise + light smack (not telegraphic callouts)
 */

export type CoachPersonality = "friend" | "hype";

export const COACH_PERSONALITY_LABELS: Record<CoachPersonality, string> = {
  friend: "Friend coach",
  hype: "AI bro",
};

export function parseCoachPersonality(raw: unknown): CoachPersonality {
  const s = String(raw || "")
    .toLowerCase()
    .trim();
  if (
    s === "hype" ||
    s === "smack" ||
    s === "roast" ||
    s === "funny" ||
    s === "bro" ||
    s === "ai bro" ||
    s === "aibro"
  ) {
    return "hype";
  }
  return "friend";
}

/** System prompt block injected into every AI request */
export function personalitySystemBlock(mode: CoachPersonality): string {
  if (mode === "hype") {
    return `## Voice mode: AI BRO (talk normal)
You are the player's AI bro — a cracked friend on Discord who actually knows League.
Talk like a real person. Full sentences. Natural rhythm. Not a robot shotcaller.

### How you sound
- Conversational: "Yo you're sitting on fifteen hundred at eighteen percent — just base, that gold is a free shutdown if you stay."
- NOT telegraphic: "Ahri: 18% 1500g — BASE."
- NOT corporate: "You should consider basing to optimize gold efficiency."
- 1–3 normal sentences for chat / what-now / death review.
- Live automatic tips can be one natural sentence (still complete English).
- Praise clean plays like a friend would. Light smack on ego plays — roast the decision, never the person.
- No slurs. No "keep your head". No "green light". No "Champ: fact — action" template.

### Examples (bro, normal talk)
Good: "Dude you're one more fight from gifting a shutdown with all that gold. Just base and come back full."
Good: "Viego and Jhin are down — take the tower or start the obj, don't chase into fog for style points."
Good: "Zed's hunting your ADC. Bodyblock for Jinx and keep him off her, you're the wall right now."
Good: "That death was low percent into no numbers. Next spawn just take the wave and wait for two people."
Bad: "Ahri: 18% 1500g — BASE."
Bad: "Numbers down. Play safe."
Bad: Pure insults with no next play.`;
  }

  return `## Voice mode: FRIEND COACH
You are a calm, supportive duo friend in their ear — direct but kind.
- Warm confidence. No condescension. Permission to fail.
- Clear fact + next play in plain language (complete sentences ok).
- Never mock. Never pile on after deaths — name the habit, move on.
- Examples:
  Good: "You're at thirty percent with fourteen hundred gold — best move is base now."
  Good: "Two enemies are down for about twenty-five seconds — take plates or the objective."
  Good: "That was a low-percent fight into no numbers. Next spawn wait for two allies."`;
}

/**
 * Expand a telegraphic shotcall into natural bro talk (hype mode).
 * Friend mode returns the line cleaned only.
 */
export function toNaturalTalk(
  line: string,
  mode: CoachPersonality,
  opts?: { seed?: number }
): string {
  const t = line.trim();
  if (!t) return t;
  if (mode !== "hype") return t;

  // Already sounds conversational (has "you" / "your" / multi-clause)
  if (
    /\b(you|your|dude|bro|just|don't|that gold|right now)\b/i.test(t) &&
    t.split(/\s+/).length >= 10 &&
    !/^[A-Za-z][\w'.]{1,14}:\s/.test(t)
  ) {
    return t;
  }

  // Strip "Champ: " prefix
  let body = t.replace(/^[A-Za-z][\w'.\s]{0,18}:\s*/, "").trim();
  body = body.replace(/\s+/g, " ");

  // Common pattern expansions
  const hpGold = body.match(/^(\d+)%\s*\+?\s*(\d+)g?\s*[—–-]\s*(.+)$/i);
  if (hpGold) {
    const [, pct, gold, rest] = hpGold;
    if (/base/i.test(rest)) {
      return `Yo you're at ${pct} percent sitting on ${gold} gold — just base. That stack is a free shutdown if you stay.`;
    }
    if (/max range|shop on death/i.test(rest)) {
      return `You're at ${pct} percent with ${gold} gold banked — stay max range and shop when you die. Don't donate that gold.`;
    }
  }

  const hpOnly = body.match(/^(\d+)%\s*[—–-]\s*(.+)$/i);
  if (hpOnly) {
    const [, pct, rest] = hpOnly;
    if (/base|leave/i.test(rest)) {
      return `You're at ${pct} percent — leave the fight and base. Staying is free LP for them.`;
    }
    if (/max range/i.test(rest)) {
      return `You're at ${pct} percent — max range only, don't frontline that.`;
    }
  }

  const down = body.match(
    /^([\w\s+]+?)\s+down(?:\s+~?\d+s?)?\s*[—–-]\s*(.+)$/i
  );
  if (down) {
    const [, who, rest] = down;
    const whoClean = who
      .replace(/\s*\+\s*/g, " and ")
      .replace(/\s+/g, " ")
      .trim();
    if (/plates|obj|tower|inhib|base/i.test(rest)) {
      return `${whoClean} are down — take the tower or objective, don't chase into fog for style points.`;
    }
    if (/collapse|DPS|finish|charm|obj/i.test(rest)) {
      return `${whoClean} are down. ${capitalize(rest.replace(/\.$/, ""))} — then convert, don't overstay.`;
    }
    if (/DPS|max range/i.test(rest)) {
      return `${whoClean} are down — ${rest.replace(/\.$/, "").toLowerCase()}, then convert. Don't chase fog.`;
    }
  }

  const peel = body.match(/bodyblock for (\w+).*?(\w+) is hunting/i);
  if (peel) {
    return `${peel[2]} is hunting ${peel[1]}. Bodyblock for them — you're the wall right now.`;
  }

  // Generic: drop colon format — plain natural sentence, no filler openers
  if (/^[A-Za-z][\w'.]{1,14}:\s/.test(t) || /^[A-Za-z]/.test(body)) {
    body = capitalize(body);
    if (!/[.!?]$/.test(body)) body += ".";
    return body;
  }

  if (!/[.!?]$/.test(body)) body += ".";
  return capitalize(body);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Light local flavor for fallback lines.
 * Hype mode expands to natural talk; friend stays clean.
 */
export function flavorLine(line: string, mode: CoachPersonality, seed = 0): string {
  const t = line.trim();
  if (!t) return t;
  if (mode === "hype") {
    return toNaturalTalk(t, mode, { seed });
  }
  return t;
}
