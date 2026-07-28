import { Agent, fetch as undiciFetch } from "undici";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameContext } from "@riftcoach/shared";
import { emptyContext } from "@riftcoach/shared";
import { normalizeAllGameData } from "./normalize.js";

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const LIVE_BASE = process.env.LIVE_CLIENT_BASE || "https://127.0.0.1:2999";

async function fetchActivePlayerName(): Promise<string | null> {
  try {
    const res = await undiciFetch(`${LIVE_BASE}/liveclientdata/activeplayername`, {
      dispatcher: insecureAgent,
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // API may return JSON string or raw quoted name
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return text.replace(/^"|"$/g, "").trim() || null;
    }
  } catch {
    return null;
  }
}

export async function fetchLiveContext(): Promise<GameContext | null> {
  try {
    const url = `${LIVE_BASE}/liveclientdata/allgamedata`;
    const res = await undiciFetch(url, {
      dispatcher: insecureAgent,
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const activeName = await fetchActivePlayerName();
    return normalizeAllGameData(json, "live", activeName);
  } catch {
    return null;
  }
}

export function loadMockContext(): GameContext {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../fixtures/mock-live-context.json"),
    path.resolve(process.cwd(), "fixtures/mock-live-context.json"),
    path.resolve(process.cwd(), "../../fixtures/mock-live-context.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return {
        ...raw,
        source: "mock",
        updatedAt: new Date().toISOString(),
        // Simulate clock ticking in mock mode
        gameTime: Number(raw.gameTime || 0) + ((Date.now() / 1000) % 120),
      } as GameContext;
    }
  }
  return {
    ...emptyContext(),
    source: "mock",
    inGame: true,
    gameTime: 600,
    gameMode: "CLASSIC",
    you: {
      championName: "Ahri",
      level: 9,
      currentGold: 1200,
      kills: 2,
      deaths: 1,
      assists: 1,
      creeps: 90,
    },
    updatedAt: new Date().toISOString(),
  };
}
