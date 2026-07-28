/**
 * Normalize coach text so TTS does not read KDA as calendar dates, etc.
 * Optimized for LIVE callouts — prefer the shortest actionable line.
 */

export function toSpeakable(text: string, maxChars = 200): string {
  let t = text.replace(/\r/g, "");

  // Prefer explicit LIVE: line (instant coach)
  const live = t.match(/LIVE:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
  if (live) {
    t = live;
  } else if (/CAUSE:|FIX:|NEXT:|ACTION:|CALLOUT:/i.test(t)) {
    // Prefer single best coaching line — not the whole essay
    const action = t.match(/ACTION:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
    const callout = t.match(/CALLOUT:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
    const fix = t.match(/FIX:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
    const next = t.match(/NEXT:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
    const cause = t.match(/CAUSE:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
    // One line only for speed (was fix+next essays)
    t = callout || action || fix || next || cause || t;
  }

  // Strip labels
  t = t
    .replace(/VERDICT:\s*/gi, "")
    .replace(/ACTION:\s*/gi, "")
    .replace(/NOTE:\s*/gi, "")
    .replace(/CALLOUT:\s*/gi, "")
    .replace(/LIVE:\s*/gi, "")
    .replace(/CAUSE:\s*/gi, "")
    .replace(/FIX:\s*/gi, "")
    .replace(/AVOID:\s*/gi, "")
    .replace(/NEXT:\s*/gi, "")
    .replace(/PATTERN:\s*/gi, "")
    .replace(/POST-GAME SUMMARY/gi, "Post game.")
    .replace(/\bN\/A\b/gi, "");

  // Never speak useless narration
  t = t
    .replace(/\byou (just )?died\.?\s*/gi, "")
    .replace(/\byou're dead\.?\s*/gi, "")
    .replace(/\byou are dead\.?\s*/gi, "")
    .replace(/\bdeath detected\.?\s*/gi, "")
    .replace(/\bdeath review\.?\s*/gi, "");

  // KDA / scores: 4/1/3 → "4 kills, 1 death, 3 assists"
  t = t.replace(
    /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/g,
    (_m, k, d, a) => {
      const kills = Number(k);
      const deaths = Number(d);
      const assists = Number(a);
      const kd = `${kills} ${kills === 1 ? "kill" : "kills"}`;
      const dd = `${deaths} ${deaths === 1 ? "death" : "deaths"}`;
      const aa = `${assists} ${assists === 1 ? "assist" : "assists"}`;
      return `${kd}, ${dd}, ${aa}`;
    }
  );

  t = t.replace(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b(?!\s*\/)/g, (_m, a, b) => `${a} to ${b}`);

  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, min, sec) => {
    const m = Number(min);
    const s = Number(sec);
    const ms = `${m} ${m === 1 ? "minute" : "minutes"}`;
    if (s === 0) return ms;
    return `${ms} ${s}`;
  });

  t = t.replace(/\bL(\d{1,2})\b/g, "level $1");
  t = t.replace(/\blvl\.?\s*(\d{1,2})\b/gi, "level $1");

  t = t.replace(/\b(\d+(?:\.\d+)?)k\s*g(?:old)?\b/gi, "$1 thousand gold");
  t = t.replace(/\b(\d{3,5})\s*g\b/gi, "$1 gold");
  t = t.replace(/\b(\d{3,5})g\b/gi, "$1 gold");

  t = t.replace(/\bCS\b/g, "farm");
  t = t.replace(/\bHP\b/g, "health");
  t = t.replace(/\bMP\b/g, "mana");
  t = t.replace(/\bjg\b/gi, "jungle");
  t = t.replace(/\bobj\b/gi, "objective");
  t = t.replace(/\bult\b/gi, "ultimate");
  t = t.replace(/\bbot\b/gi, "bot lane");
  t = t.replace(/\bmid\b/gi, "mid");
  t = t.replace(/\btop\b/gi, "top");

  t = t.replace(/\b(\d{1,3})%\b/g, "$1 percent");

  t = t
    .replace(/[•\-*]\s*/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .trim();

  if (t.length > maxChars) {
    t = t.slice(0, maxChars).replace(/\s+\S*$/, "") + ".";
  }
  return t;
}
