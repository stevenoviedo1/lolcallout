/**
 * OPT-IN training data logger. OFF by default.
 * Enable with LOLCALLOUT_LOG_PAIRS=1, the agent flag `--log-pairs`,
 * or `npm run dev:log-pairs -w @riftcoach/agent`.
 * Writes {system, user, response, intent, model, ts} lines to a local JSONL file —
 * never uploaded anywhere. Default: ~/.lolcallout/training/pairs.jsonl
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function pairLoggingEnabled(): boolean {
  if (process.argv.includes("--log-pairs")) return true;
  const v = (process.env.LOLCALLOUT_LOG_PAIRS || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function pairLogPath(): string {
  return (
    process.env.LOLCALLOUT_PAIRS_FILE ||
    path.join(os.homedir(), ".lolcallout", "training", "pairs.jsonl")
  );
}

export function logPair(entry: {
  intent?: string;
  model: string;
  system: string;
  history: { role: string; content: string }[];
  user: string;
  response: string;
}) {
  if (!pairLoggingEnabled() || !entry.response.trim()) return;
  try {
    const file = pairLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) {
    console.warn("[agent] pair log failed", e);
  }
}
