#!/usr/bin/env node
/**
 * Local training-pair helper. Logging itself is OPT-IN and OFF by default:
 *   start the agent with  LOLCALLOUT_LOG_PAIRS=1  or  --log-pairs
 *   (npm run dev:agent:log-pairs)
 *
 * This script never uploads anything. Commands:
 *   node scripts/log-pairs.mjs stats            # count pairs per intent
 *   node scripts/log-pairs.mjs export out.jsonl # write chat-format {messages:[...]} for Unsloth SFT
 * Env: LOLCALLOUT_PAIRS_FILE (default ~/.lolcallout/training/pairs.jsonl)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file =
  process.env.LOLCALLOUT_PAIRS_FILE || path.join(os.homedir(), ".lolcallout", "training", "pairs.jsonl");
const [cmd = "stats", outArg] = process.argv.slice(2);

if (!fs.existsSync(file)) {
  console.log(`No pairs yet at ${file}. Logging is off by default — start the agent with LOLCALLOUT_LOG_PAIRS=1.`);
  process.exit(0);
}
const rows = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

if (cmd === "stats") {
  const by = {};
  for (const r of rows) by[r.intent || "free"] = (by[r.intent || "free"] || 0) + 1;
  console.log(`${rows.length} pairs in ${file}`);
  console.table(by);
} else if (cmd === "export") {
  const out = outArg || "lolcoach-sft.jsonl";
  const lines = rows
    .filter((r) => r.response && r.response.trim())
    .map((r) =>
      JSON.stringify({
        messages: [
          { role: "system", content: r.system },
          ...(r.history || []),
          { role: "user", content: r.user },
          { role: "assistant", content: r.response },
        ],
      })
    );
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`wrote ${lines.length} examples → ${out} (review/edit responses before training!)`);
} else {
  console.log("usage: node scripts/log-pairs.mjs [stats | export <out.jsonl>]");
}
