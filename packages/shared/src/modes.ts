/**
 * Game mode / queue recognition for coaching personality.
 * Uses Live Client + optional LCU queue fields. Never invents.
 */

import type { GameMode } from "./index.js";

export type CoachModeFamily =
  | "SR_RANKED"
  | "SR_NORMAL"
  | "SR_UNKNOWN"
  | "ARAM"
  | "ARENA"
  | "URF"
  | "OTHER";

export interface ModeProfile {
  family: CoachModeFamily;
  gameMode: GameMode;
  label: string;
  /** Short rules injected into every brief */
  rules: string[];
  /** Verbs preferred in callouts */
  verbs: string[];
  noRecall: boolean;
  hasWaves: boolean;
  hasObjectives: boolean;
  hasJungle: boolean;
}

/** Detect mode family from Live Client / LCU fields. */
export function detectModeProfile(opts: {
  gameMode?: GameMode | string;
  mapName?: string;
  queueType?: string;
  gameQueueConfigId?: number | string;
}): ModeProfile {
  const mode = String(opts.gameMode || "UNKNOWN").toUpperCase();
  const map = (opts.mapName || "").toLowerCase();
  const queue = `${opts.queueType || ""} ${opts.gameQueueConfigId ?? ""}`.toLowerCase();

  const isAram =
    mode.includes("ARAM") || map === "map12" || map.includes("howling") || queue.includes("aram");
  const isArena =
    mode.includes("CHERRY") ||
    mode.includes("ARENA") ||
    map === "map30" ||
    map.includes("arena") ||
    queue.includes("arena") ||
    queue.includes("cherry");
  const isUrf = mode.includes("URF") || queue.includes("urf");
  const isSr =
    mode.includes("CLASSIC") || map === "map11" || map.includes("summoner") || (!isAram && !isArena && !isUrf && mode !== "UNKNOWN");

  if (isAram) {
    return {
      family: "ARAM",
      gameMode: "ARAM",
      label: "ARAM (Howling Abyss)",
      noRecall: true,
      hasWaves: true,
      hasObjectives: false,
      hasJungle: false,
      verbs: ["HOLD", "POKE", "GROUP", "RESET", "SHOP_ON_DEATH", "MAX_RANGE"],
      rules: [
        "NEVER say base/recall/back to buy while alive",
        "Shop only on death/spawn",
        "Prioritize teamfight timing and not inting alone",
        "Numbers up → shove plates; numbers down → hold for allies",
      ],
    };
  }

  if (isArena) {
    return {
      family: "ARENA",
      gameMode: "ARENA",
      label: "Arena",
      noRecall: true,
      hasWaves: false,
      hasObjectives: false,
      hasJungle: false,
      verbs: ["FIGHT", "BAIT", "RESET", "NEXT_ROUND", "SPIKE"],
      rules: [
        "Think in rounds — don't force lost fights",
        "Item/augment spikes > farm",
        "Play for round win condition",
      ],
    };
  }

  if (isUrf) {
    return {
      family: "URF",
      gameMode: "URF",
      label: "URF",
      noRecall: false,
      hasWaves: true,
      hasObjectives: true,
      hasJungle: true,
      verbs: ["SPAM", "SPACE", "RESET", "DIVE", "BASE"],
      rules: ["CDs are short — spacing still wins", "Keep callouts ultra short"],
    };
  }

  const ranked =
    /ranked|solo|flex|420|440|rankedsolo|rankedflex/.test(queue) ||
    queue.includes("ranked_solo") ||
    queue.includes("ranked_flex");
  const normal = /normal|draft|blind|400|430|490/.test(queue);

  if (isSr || mode === "CLASSIC") {
    return {
      family: ranked ? "SR_RANKED" : normal ? "SR_NORMAL" : "SR_UNKNOWN",
      gameMode: "CLASSIC",
      label: ranked
        ? "Summoner's Rift — Ranked"
        : normal
          ? "Summoner's Rift — Normal"
          : "Summoner's Rift",
      noRecall: false,
      hasWaves: true,
      hasObjectives: true,
      hasJungle: true,
      verbs: ["BASE", "SHOVE", "HOLD", "GROUP", "WARD", "DROP", "ROAM"],
      rules: ranked
        ? [
            "Competitive: punish mistakes, convert leads, protect LP",
            "Wave → base → vision → objective",
            "Never invent fog of war",
          ]
        : [
            "Still coach seriously — habits transfer to ranked",
            "Wave → base → vision → objective",
            "Never invent fog of war",
          ],
    };
  }

  return {
    family: "OTHER",
    gameMode: (mode as GameMode) || "OTHER",
    label: `Other (${mode || "unknown"})`,
    noRecall: false,
    hasWaves: true,
    hasObjectives: true,
    hasJungle: true,
    verbs: ["PLAY", "RESET", "GROUP"],
    rules: ["Stay mode-aware from labeled mode", "No fog invent"],
  };
}
