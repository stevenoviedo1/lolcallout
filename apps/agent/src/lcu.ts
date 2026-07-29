/**
 * Best-effort LCU (League Client Update) access for champ select.
 * Unsupported by Riot officially — fail soft always.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent, fetch as undiciFetch } from "undici";
import type { ChampSelectState } from "@riftcoach/shared";
import { championNameFromId, resolveChampionLabel } from "@riftcoach/shared";

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

function labelChamp(id?: number): string {
  if (!id || id <= 0) return "";
  return championNameFromId(id) || String(id);
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
      myTeam?: Array<{
        championId?: number;
        championPickIntent?: number;
        assignedPosition?: string;
        cellId?: number;
      }>;
      theirTeam?: Array<{ championId?: number; championPickIntent?: number; cellId?: number }>;
      bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
      localPlayerCellId?: number;
    };

    // localPlayerCellId is a cell id, NOT an array index
    const me =
      data.myTeam?.find((t) => t.cellId === data.localPlayerCellId) ||
      data.myTeam?.find((t) => t.championId && t.championId > 0) ||
      data.myTeam?.[0];

    const myId =
      (me?.championId && me.championId > 0 ? me.championId : 0) ||
      (me?.championPickIntent && me.championPickIntent > 0 ? me.championPickIntent : 0) ||
      undefined;

    const myName = myId ? labelChamp(myId) : undefined;

    return {
      active: true,
      myChampionId: myId,
      myChampion: myName || undefined,
      assignedPosition: me?.assignedPosition || undefined,
      allies: (data.myTeam || [])
        .map((t) => labelChamp(t.championId || t.championPickIntent))
        .filter(Boolean)
        .map((n) => resolveChampionLabel(n)),
      enemies: (data.theirTeam || [])
        .map((t) => labelChamp(t.championId || t.championPickIntent))
        .filter(Boolean)
        .map((n) => resolveChampionLabel(n)),
      bans: [
        ...(data.bans?.myTeamBans || []).map((id) => labelChamp(id) || String(id)),
        ...(data.bans?.theirTeamBans || []).map((id) => labelChamp(id) || String(id)),
      ],
      message: myName ? `Locked ${myName}` : "Champ select active",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
