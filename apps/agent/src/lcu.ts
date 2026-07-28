/**
 * Best-effort LCU (League Client Update) access for champ select.
 * Unsupported by Riot officially — fail soft always.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent, fetch as undiciFetch } from "undici";
import type { ChampSelectState } from "@riftcoach/shared";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

function findLockfile(): string | null {
  const candidates = [
    path.join("C:\\", "Riot Games", "League of Legends", "lockfile"),
    path.join(os.homedir(), "Riot Games", "League of Legends", "lockfile"),
    process.env.LEAGUE_LOCKFILE || "",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function parseLockfile(content: string): { port: string; password: string } | null {
  // name:pid:port:password:protocol
  const parts = content.trim().split(":");
  if (parts.length < 5) return null;
  return { port: parts[2], password: parts[3] };
}

export async function fetchChampSelect(): Promise<ChampSelectState | null> {
  try {
    const lf = findLockfile();
    if (!lf) return null;
    const parsed = parseLockfile(fs.readFileSync(lf, "utf8"));
    if (!parsed) return null;

    const auth = Buffer.from(`riot:${parsed.password}`).toString("base64");
    const base = `https://127.0.0.1:${parsed.port}`;

    const res = await undiciFetch(`${base}/lol-champ-select/v1/session`, {
      dispatcher: insecureAgent,
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(800),
    });

    if (res.status === 404) {
      return {
        active: false,
        message: "Not in champ select",
        updatedAt: new Date().toISOString(),
      };
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      myTeam?: Array<{ championId?: number; assignedPosition?: string }>;
      theirTeam?: Array<{ championId?: number }>;
      bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
      localPlayerCellId?: number;
    };

    const me =
      data.myTeam?.find((t, i) => i === data.localPlayerCellId) ||
      data.myTeam?.find((t) => t.championId && t.championId > 0) ||
      data.myTeam?.[0];

    return {
      active: true,
      myChampionId: me?.championId || undefined,
      assignedPosition: me?.assignedPosition || undefined,
      allies: (data.myTeam || [])
        .map((t) => (t.championId && t.championId > 0 ? String(t.championId) : ""))
        .filter(Boolean),
      enemies: (data.theirTeam || [])
        .map((t) => (t.championId && t.championId > 0 ? String(t.championId) : ""))
        .filter(Boolean),
      bans: [
        ...(data.bans?.myTeamBans || []).map(String),
        ...(data.bans?.theirTeamBans || []).map(String),
      ],
      message: "Champ select active",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
