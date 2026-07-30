/**
 * Coach voice — must sound like a person, never a telegraphic HUD.
 * friend  = calm supportive duo (full sentences, warm)
 * hype    = AI bro (full sentences, casual Discord energy)
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
    return `## Voice mode: AI BRO (talk like a real person)
You are the player's AI bro — a cracked friend on Discord who actually knows League.
ALWAYS use full sentences with normal English. Never telegraphic shotcall-speak.

### How you sound
- Conversational: "You're sitting on fifteen hundred at eighteen percent — just base. That gold is a free shutdown if you stay."
- NOT telegraphic: "Ahri: 18% 1500g — BASE."
- NOT corporate: "You should consider basing to optimize gold efficiency."
- Live tips: one or two complete sentences. Chat/death: 1–3 sentences.
- Praise clean plays. Light smack on ego plays — roast the decision, never the person.
- No slurs. No "keep your head". No "green light". No "Champ: fact — action" template.
- Always name the next play in plain English.

### Examples
Good: "Dude you're one more fight from gifting a shutdown with all that gold. Just base and come back full."
Good: "Viego and Jhin are down right now — take the tower or start the objective. Don't chase into fog for style points."
Good: "Zed is hunting your ADC. Bodyblock for Jinx and keep him off her — you're the wall right now."
Good: "That death was low percent into no numbers. When you spawn, take the wave and wait for two people."
Bad: "Ahri: 18% 1500g — BASE."
Bad: "Numbers down. Play safe."
Bad: "next spawn respect Zed — different entry."`;
  }

  return `## Voice mode: FRIEND COACH
You are a calm, supportive duo friend in their ear — direct but kind.
ALWAYS use full, complete sentences. Never telegraphic HUD callouts.

### How you sound
- Warm confidence. No condescension. Permission to fail.
- Fact + next play in plain spoken English (complete sentences every time).
- Never mock. Never pile on after deaths — name the habit, move on.
- No "Champ: tip" robot format. Talk to them like a person.

### Examples
Good: "You're at thirty percent with fourteen hundred gold — the best move is to base right now."
Good: "Two enemies are down for about twenty-five seconds. Take plates or the objective while you can."
Good: "That was a low-percent fight into no numbers. When you spawn, wait for two allies before you rejoin."
Bad: "Ahri: 30% 1400g — BASE."
Bad: "Numbers down. Play safe."`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function finishSentence(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  if (!t) return t;
  // Fix trailing fragments from bad merges
  t = t.replace(/\s+[—–-]\s*$/, "").replace(/\s+(or|and|then|the|a|to)$/i, "");
  // Collapse accidental doubled words ("are are", "the the")
  t = t.replace(/\b(\w+)(\s+\1)+\b/gi, "$1");
  // Collapse repeated trailing phrases
  t = t.replace(/\b(when they waste a spell)(\s+\1)+\b/gi, "$1");
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

function stripChampPrefix(t: string): string {
  return t.replace(/^[A-Za-z][\w'.]{1,16}:\s*/, "").trim();
}

function isAlreadyHuman(t: string): boolean {
  const words = t.split(/\s+/).length;
  const hasYou = /\b(you|your|you're|yo|dude|when you)\b/i.test(t);
  const hasChampColon = /^[A-Za-z][\w'.]{1,16}:\s/.test(t);
  // Still telegraphic source forms
  if (hasChampColon && words < 16) return false;
  if (/^\d+%\s*\+?\s*\d*\s*g?\s*[—–-]/.test(t)) return false;
  if (/^(next spawn|spawn buy)\b/i.test(t)) return false;
  if (/^[A-Za-z][\w'.]{1,16}:\s*\d/.test(t)) return false;
  // "Name and Name down — action" without "are" is still semi-telegraphic
  if (/^[\w\s+]+\s+down\s*[—–-]/i.test(t) && !/\bare\s+down\b/i.test(t) && !hasYou) {
    return false;
  }
  // Already natural full coaching
  if (
    /^(you |you're |yo |dude |when you |that's an |peel your |viego and |[\w]+ and [\w]+ are down)/i.test(
      t
    ) &&
    words >= 8
  ) {
    return true;
  }
  if (hasYou && words >= 8 && !hasChampColon) return true;
  if (/\bare down\b/i.test(t) && /take the (tower|objective)/i.test(t) && words >= 10) {
    return true;
  }
  return false;
}

/**
 * Expand telegraphic coaching into natural full-sentence speech.
 * BOTH friend and hype get full sentences — tone differs.
 */
export function toNaturalTalk(
  line: string,
  mode: CoachPersonality,
  opts?: { seed?: number }
): string {
  void opts;
  const t = line.trim();
  if (!t) return t;
  if (isAlreadyHuman(t)) {
    return finishSentence(t);
  }

  const bro = mode === "hype";
  let body = stripChampPrefix(t).replace(/\s+/g, " ").trim();

  // ── HP + gold (many separators: +, and, bare) ──
  let m = body.match(
    /^(\d+)%\s*(?:\+|and)?\s*(\d+)\s*g?\s*[—–-]\s*(.+)$/i
  );
  if (m) {
    const [, pct, gold, rest] = m;
    if (/base|leave/i.test(rest)) {
      return bro
        ? finishSentence(
            `You're at ${pct} percent sitting on ${gold} gold — just base. That stack is a free shutdown if you stay`
          )
        : finishSentence(
            `You're at ${pct} percent with ${gold} gold in pocket. The best move is to base now, not take another fight`
          );
    }
    if (/max range|shop on death|don't donate|backline/i.test(rest)) {
      return bro
        ? finishSentence(
            `You're at ${pct} percent with ${gold} gold banked — stay max range and shop when you die. Don't donate that gold`
          )
        : finishSentence(
            `You're at ${pct} percent holding ${gold} gold. Stay max range only, and spend it on death if you have to`
          );
    }
    if (/leave|wave/i.test(rest)) {
      return finishSentence(
        bro
          ? `You're at ${pct} percent with ${gold} gold — leave the wave and base. Staying is free LP for them`
          : `You're at ${pct} percent with ${gold} gold. Give the wave and base — fighting here is low percent`
      );
    }
  }

  // ── HP only ──
  m = body.match(/^(\d+)%\s*[—–-]\s*(.+)$/i);
  if (m) {
    const [, pct, rest] = m;
    if (/base|leave/i.test(rest)) {
      return finishSentence(
        bro
          ? `You're at ${pct} percent — leave the fight and base. Staying is free LP for them`
          : `You're at ${pct} percent. Leave the fight and base; you have no value if you die here`
      );
    }
    if (/max range|frontline|backline/i.test(rest)) {
      return finishSentence(
        bro
          ? `You're at ${pct} percent — max range only, don't frontline that`
          : `You're at ${pct} percent. Stay max range and don't frontline this fight`
      );
    }
    if (/disengage|no all-in/i.test(rest)) {
      return finishSentence(
        `You're at ${pct} percent — disengage and play max range. Don't all-in`
      );
    }
  }

  // ── "X and Y down" convert ──
  m = body.match(
    /^(?:ACE\s*[—–-]\s*)?([\w\s+]+?)\s+down(?:\s+~?\d+s?)?\s*[—–-]\s*(.+)$/i
  );
  if (m || /^(ACE)\s*[—–-]\s*(.+)$/i.test(body)) {
    const aceOnly = body.match(/^(ACE)\s*[—–-]\s*(.+)$/i);
    if (aceOnly) {
      const rest = aceOnly[2];
      if (/baron|inhib|plates|obj|tower/i.test(rest)) {
        return finishSentence(
          bro
            ? `That's an ace — take baron, the inhib, or plates right now. Don't chase into fog for style points`
            : `You have an ace. Take baron, an inhib, or plates now, and don't chase into the fog`
        );
      }
      if (/base/i.test(rest)) {
        return finishSentence(
          `You have an ace — take one objective, then base with your gold. No fountain heroics`
        );
      }
    }
    if (m) {
      let who = m[1]
        .replace(/\s*\+\s*/g, " and ")
        .replace(/\s+/g, " ")
        .replace(/\s+are$/i, "")
        .trim();
      // Guard against re-processing "Viego and Jhin are"
      if (/\bare\s+down\b/i.test(body) && /take the tower/i.test(body)) {
        return finishSentence(body);
      }
      const rest = m[2];
      if (/plates|obj|tower|inhib|base|convert|free map/i.test(rest)) {
        return finishSentence(
          bro
            ? `${who} are down — take the tower or objective. Don't chase into fog for style points`
            : `${who} are down. Take the tower or the objective while you have the window, and don't chase into fog`
        );
      }
      if (/start obj|set the obj|YOU start/i.test(rest)) {
        return finishSentence(
          bro
            ? `${who} are down — you start the objective and let your team crash waves into it`
            : `${who} are down. Start the objective yourself and have your allies crash waves`
        );
      }
      if (/DPS|max range|finish|charm|collapse|zone/i.test(rest)) {
        const action = rest.replace(/\.$/, "").replace(/^then\s+/i, "");
        return finishSentence(
          `${who} are down. ${capitalize(action.toLowerCase())}, then convert — don't overstay`
        );
      }
    }
  }

  // ── Gold but enemies down (numbers kind) ──
  m = body.match(/^(\d+)g\s+but\s+(.+)$/i);
  if (m) {
    return finishSentence(
      bro
        ? `You've got ${m[1]} gold, but ${m[2].replace(/\.$/, "")}. Take the free stuff first, then base`
        : `You have ${m[1]} gold, but ${m[2].replace(/\.$/, "")}. Convert the map first, then base if you need the item`
    );
  }

  // ── Death / spawn plans ──
  m = body.match(
    /^(?:next\s+)?spawn\s+buy\s+(\d+)\s*g?\s*[—–,]?\s*(?:different path[—–,]?\s*)?(?:respect\s+(\w+)[—–,]?\s*)?(?:wave first)?\.?$/i
  );
  if (m || /spawn buy\s+\d+/i.test(body)) {
    const goldM = body.match(/(\d+)\s*g/);
    const killerM = body.match(/respect\s+(\w+)/i);
    const gold = goldM?.[1] || "your";
    const killer = killerM?.[1];
    return finishSentence(
      bro
        ? `When you spawn, buy with that ${gold} gold first${killer ? `, respect ${killer},` : ","} take a different path, and clear the nearest wave before you force anything`
        : `When you come back, spend the ${gold} gold on your item first${killer ? `, respect ${killer} on the way out,` : ","} and take the nearest wave before you rejoin a fight`
    );
  }

  m = body.match(
    /^(?:next\s+)?spawn\s+respect\s+(\w+)\s*[—–-]\s*(.+)$/i
  );
  if (m) {
    const killer = m[1];
    return finishSentence(
      bro
        ? `When you spawn, respect ${killer} — take a different entry, wait for two allies, then rejoin`
        : `When you spawn, respect ${killer}. Take a different path in, wait for two allies, then rejoin the map`
    );
  }

  if (/next spawn take the wave|spawn take the wave|wait for two allies/i.test(body)) {
    return finishSentence(
      bro
        ? `When you spawn, take the nearest wave and wait for two allies before you look for a fight`
        : `When you spawn, take the nearest wave and wait for two allies before you rejoin`
    );
  }

  if (/spawn group mid/i.test(body)) {
    return finishSentence(
      bro
        ? `When you spawn, group mid with the team and end — no solo side-lane heroics`
        : `When you spawn, group mid with your team and look to end. Skip the solo side plays`
    );
  }

  if (/spawn farm safe|mosquito|no equalizer/i.test(body)) {
    return finishSentence(
      bro
        ? `When you spawn, farm a safe side and mosquito only — no equalizer all-ins`
        : `When you spawn, farm safely on a side lane. Only take high-percent plays, not equalizer fights`
    );
  }

  // ── Peel / support ──
  m = body.match(/peel(?:\s+your\s+carry)?\s*[—–-]\s*(\w+)\s+is the delete/i);
  if (m) {
    return finishSentence(
      bro
        ? `Peel your carry right now — ${m[1]} is the delete threat`
        : `Peel for your carry. ${m[1]} is the threat that can delete them`
    );
  }
  m = body.match(/bodyblock for (\w+)\.?\s*(\w+) is hunting/i);
  if (m) {
    return finishSentence(
      bro
        ? `${m[2]} is hunting ${m[1]}. Bodyblock for them — you're the wall right now`
        : `${m[2]} is hunting ${m[1]}. Bodyblock and peel so your carry stays alive`
    );
  }
  m = body.match(/bodyblock for (\w+).*?(\w+) is hunting/i);
  if (m) {
    return finishSentence(
      `${m[2]} is hunting ${m[1]}. Bodyblock for them — you're the wall right now`
    );
  }
  m = body.match(/peel (\w+)\.?\s*(\w+) is the delete/i);
  if (m) {
    return finishSentence(
      `Peel for ${m[1]} — ${m[2]} is the delete button, not your all-in target`
    );
  }

  // ── Level / kit ──
  m = body.match(/^(\d+)\s*up\s*[—–-]\s*(.+)$/i);
  if (m) {
    let combo = m[2]
      .replace(/\s*→\s*/g, " into ")
      .replace(/\.$/, "")
      .replace(/\s+when they (waste|burn).+$/i, "")
      .trim();
    // Shorten long ability chains for speech
    if (combo.split(/\s+/).length > 12) {
      combo = combo.split(/\s+/).slice(0, 10).join(" ");
    }
    return finishSentence(
      bro
        ? `You just hit ${m[1]} — look for ${combo} when they waste a spell`
        : `You just hit level ${m[1]}. Look for ${combo} when they burn a key spell`
    );
  }
  // Already "You just hit N" — don't re-expand
  if (/^you just hit \d+/i.test(body)) {
    return finishSentence(body.replace(/\s+when they waste a spell\s+when they waste a spell/gi, " when they waste a spell"));
  }

  // ── Obj clock ──
  m = body.match(/^(.+?)\s+is UP\s*[—–-]\s*(.+)$/i);
  if (m) {
    return finishSentence(
      bro
        ? `${m[1]} is up right now — ${m[2].replace(/\.$/, "").toLowerCase()}`
        : `${m[1]} is available. ${capitalize(m[2].replace(/\.$/, ""))}`
    );
  }
  m = body.match(/^(.+?)\s+in ~(\d+)s\s*[—–-]\s*(.+)$/i);
  if (m) {
    return finishSentence(
      `${m[1]} is up in about ${m[2]} seconds. ${capitalize(m[3].replace(/\.$/, ""))}`
    );
  }
  if (/ACE — .+ or inhib NOW/i.test(body)) {
    return finishSentence(
      bro
        ? `That's an ace — take the objective or the inhib right now. No fountain chase`
        : `You have an ace. Take the objective or the inhib now, and do not chase into their fountain`
    );
  }

  // ── Threat / ult ──
  m = body.match(/^(\w+) alive ult unlocked\s*[—–-]\s*(.+)$/i);
  if (m) {
    return finishSentence(
      bro
        ? `${m[1]} is alive with ult unlocked — ${m[2].replace(/\.$/, "").toLowerCase()}. No free walk-up`
        : `${m[1]} is alive with ultimate unlocked. ${capitalize(m[2].replace(/\.$/, ""))}, and don't walk up for free`
    );
  }

  // ── Disengage numbers ──
  m = body.match(/^(\d+)v(\d+)\s*[—–-]\s*(.+)$/i);
  if (m) {
    return finishSentence(
      bro
        ? `It's ${m[1]} versus ${m[2]} — ${m[3].replace(/\.$/, "").toLowerCase()}`
        : `You're in a ${m[1]} versus ${m[2]}. ${capitalize(m[3].replace(/\.$/, ""))}`
    );
  }

  // ── Generic telegraphic "fact — action" ──
  if (/\s[—–-]\s/.test(body) && !isAlreadyHuman(body)) {
    const parts = body.split(/\s[—–-]\s/);
    if (parts.length >= 2) {
      const head = parts[0].trim();
      const tail = parts.slice(1).join(". ").trim();
      // Champ already stripped
      if (/^\d+%/.test(head) || /\d+g/.test(head) || /down$/i.test(head)) {
        // already handled mostly
      } else if (tail.length > 4) {
        const joined = bro
          ? `${capitalize(head)} — ${tail.charAt(0).toLowerCase()}${tail.slice(1)}`
          : `${capitalize(head)}. ${capitalize(tail)}`;
        return finishSentence(joined);
      }
    }
  }

  // ── Final polish: strip leftover champ colon, ensure sentence ──
  body = stripChampPrefix(body);
  // Soften pure imperative fragments
  if (
    /^(plates|focus|peel|leave|base|hold|respect|crash|shove|group)\b/i.test(body) &&
    body.split(/\s+/).length < 10
  ) {
    body = bro
      ? `Right now ${body.charAt(0).toLowerCase()}${body.slice(1)}`
      : `Right now, ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  }
  body = capitalize(body);
  return finishSentence(body);
}

/**
 * Always humanize — friend and hype both get full sentences.
 */
export function flavorLine(line: string, mode: CoachPersonality, seed = 0): string {
  const t = line.trim();
  if (!t) return t;
  return toNaturalTalk(t, mode, { seed });
}

/** True if line still looks like a robot HUD tip */
export function isTelegraphicLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[A-Za-z][\w'.]{1,16}:\s*\d/.test(t)) return true;
  if (/^[A-Za-z][\w'.]{1,16}:\s/.test(t) && t.split(/\s+/).length < 14) return true;
  if (/^\d+%\s*\+?\s*\d+g?\s*[—–-]/.test(t)) return true;
  if (/\bdown\s*[—–-]\s*(plates|obj|tower)/i.test(t) && !/\byou\b/i.test(t)) return true;
  return false;
}
