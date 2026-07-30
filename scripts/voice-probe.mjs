import { toNaturalTalk, isTelegraphicLine } from "../packages/shared/dist/personality.js";

const cases = [
  ["Ahri: 18% 1500g — BASE.", "hype"],
  ["Ahri: 18% 1500g — BASE.", "friend"],
  ["Ahri: Viego down ~25s — plates/obj.", "hype"],
  ["Zed down — plates or obj now, not a fog chase.", "friend"],
  ["Ahri: next spawn respect Zed — different entry, wait for two.", "hype"],
  ["6 up — E charm → Q → W → R for finish when they waste a spell.", "hype"],
  [
    "Viego and Jhin are down — take the tower or objective. Don't chase into fog for style points.",
    "hype",
  ],
  ["18% and 1500g — leave and base. That gold is a shutdown if you stay.", "hype"],
  ["Teamfight — look E charm on Zed; leave if they turn.", "hype"],
  ["Ahri: 3v5 — leave. Zed farms you if you stay.", "friend"],
  ["1600g but Zed and Viego are down — take the tower", "hype"],
  ["Viego and Jhin are are down — take the tower", "hype"],
  ["When you spawn, respect Zed — take a different entry, wait for two allies, then rejoin.", "friend"],
  ["Ahri: secondary on Zed. First-in is how you int this.", "hype"],
  ["LeeSin: path Zed. Flash only if the kill is free.", "hype"],
];

let fails = 0;
for (const [line, mode] of cases) {
  const out = toNaturalTalk(line, /** @type any */ (mode));
  const bad =
    isTelegraphicLine(out) ||
    /\bare are\b/i.test(out) ||
    /^[A-Za-z][\w']{1,16}:\s/.test(out) ||
    /\bwhen they waste a spell when they waste/i.test(out) ||
    // single name + "are down" grammar (multi "X and Y are" is fine)
    (/\b[A-Z][a-z]+\s+are down\b/.test(out) && !/\band\b/i.test(out));
  if (bad) fails++;
  console.log(bad ? "BAD " : "ok  ", mode.padEnd(6), "→", out);
}
console.log(fails ? `\n${fails} issues` : "\nall voice probes clean");
process.exit(fails ? 1 : 0);
