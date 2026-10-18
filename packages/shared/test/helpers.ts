import type { GameContext, PlayerScoreline } from "../src/index.js";

export function player(championName: string, team: "ORDER" | "CHAOS", extra: Partial<PlayerScoreline> = {}): PlayerScoreline {
  return { championName, team, level: 9, kills: 1, deaths: 1, assists: 1, creeps: 80, items: [], ...extra };
}

export function ctx(over: Partial<GameContext> = {}): GameContext {
  const scoreboard = over.scoreboard ?? [
    player("Ahri", "ORDER", { laneRole: "MIDDLE", items: ["Luden's Companion", "Sorcerer's Shoes"] }),
    player("Lee Sin", "ORDER", { laneRole: "JUNGLE" }),
    player("Garen", "ORDER", { laneRole: "TOP" }),
    player("Jinx", "ORDER", { laneRole: "BOTTOM" }),
    player("Lulu", "ORDER", { laneRole: "UTILITY" }),
    player("Zed", "CHAOS", { laneRole: "MIDDLE", items: ["Youmuu's Ghostblade"] }),
    player("Vi", "CHAOS", { laneRole: "JUNGLE" }),
    player("Darius", "CHAOS", { laneRole: "TOP" }),
    player("Caitlyn", "CHAOS", { laneRole: "BOTTOM" }),
    player("Soraka", "CHAOS", { laneRole: "UTILITY" }),
  ];
  return {
    source: "mock",
    inGame: true,
    gameTime: 900,
    gameMode: "CLASSIC",
    you: {
      championName: "Ahri", level: 9, currentGold: 600, kills: 1, deaths: 1, assists: 1, creeps: 80,
      currentHealth: 900, maxHealth: 1500, items: scoreboard[0].items, laneRole: "MIDDLE",
    },
    scoreboard,
    recentEvents: [],
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}
