import type { ActiveYou, GameContext, GameEvent, GameMode, PlayerScoreline } from "@riftcoach/shared";
import { resolveChampionLabel } from "@riftcoach/shared";

/** Best-effort mapping from Live Client allgamedata → GameContext */
export function normalizeAllGameData(
  raw: unknown,
  source: "live" | "mock",
  activePlayerName?: string | null
): GameContext {
  const data = raw as Record<string, any>;
  const stats = data?.gameData ?? data?.gameStats ?? {};
  const gameTime = Number(stats.gameTime ?? data?.gameTime ?? 0) || 0;
  const mapName = String(stats.mapName ?? data?.mapName ?? "");
  const gameMode = mapMode(stats.gameMode ?? data?.gameMode, mapName);
  const queueType = String(
    stats.queueType ?? stats.gameQueueType ?? data?.queueType ?? data?.gameQueueType ?? ""
  );
  const gameQueueConfigId =
    Number(stats.gameQueueConfigId ?? data?.gameQueueConfigId ?? stats.queueId ?? 0) || undefined;

  const active = data?.activePlayer ?? {};
  const scores = active?.scores ?? {};
  const champStats = active?.championStats ?? {};

  const allPlayers: any[] = data?.allPlayers ?? data?.playerList ?? [];
  const scoreboard: PlayerScoreline[] = allPlayers.map((p) => ({
    riotIdGameName: p.riotIdGameName ?? p.summonerName,
    championName: resolveChampionLabel(p.championName ?? p.rawChampionName ?? "Unknown"),
    team: p.team === "ORDER" || p.team === "CHAOS" ? p.team : "UNKNOWN",
    level: Number(p.level ?? 1),
    kills: Number(p.scores?.kills ?? 0),
    deaths: Number(p.scores?.deaths ?? 0),
    assists: Number(p.scores?.assists ?? 0),
    creeps: Number(p.scores?.creepScore ?? 0),
    isBot: Boolean(p.isBot),
    isDead: Boolean(p.isDead),
    summonerSpells: [p.summonerSpellOne?.displayName, p.summonerSpellTwo?.displayName].filter(
      Boolean
    ) as string[],
    items: Array.isArray(p.items)
      ? p.items.map((i: any) => i?.displayName).filter(Boolean)
      : [],
    laneRole: extractLaneRole(p),
  }));

  // Live Client often omits championName on activePlayer (Riot client change).
  // Prefer allPlayers match by identity, then fall back to active fields.
  const match = findLocalPlayer(allPlayers, active, activePlayerName);
  let you: ActiveYou | null = null;

  if (match) {
    you = playerToYou(match, active);
  } else if (active?.championName || active?.rawChampionName) {
    you = {
      championName: resolveChampionLabel(active.championName ?? active.rawChampionName),
      level: Number(active.level ?? 1),
      currentGold: Number(active.currentGold ?? 0),
      kills: Number(scores.kills ?? 0),
      deaths: Number(scores.deaths ?? 0),
      assists: Number(scores.assists ?? 0),
      creeps: Number(scores.creepScore ?? scores.creeps ?? 0),
      currentHealth: num(champStats.currentHealth),
      maxHealth: num(champStats.maxHealth),
      currentMana: num(champStats.resourceValue ?? champStats.currentMana),
      maxMana: num(champStats.resourceMax ?? champStats.maxMana),
      summonerSpells: extractSpells(active),
      items: extractItems(active),
      isDead: Boolean(active.isDead ?? champStats.currentHealth === 0),
    };
  }

  // Merge live gold/HP from activePlayer onto matched you
  if (you && active && Object.keys(active).length) {
    if (active.currentGold != null) you.currentGold = Number(active.currentGold) || you.currentGold;
    if (active.level != null) you.level = Number(active.level) || you.level;
    if (champStats.currentHealth != null) you.currentHealth = num(champStats.currentHealth);
    if (champStats.maxHealth != null) you.maxHealth = num(champStats.maxHealth);
    if (champStats.resourceValue != null || champStats.currentMana != null) {
      you.currentMana = num(champStats.resourceValue ?? champStats.currentMana);
    }
    if (champStats.resourceMax != null || champStats.maxMana != null) {
      you.maxMana = num(champStats.resourceMax ?? champStats.maxMana);
    }
    const items = extractItems(active);
    if (items.length) you.items = items;
    const spells = extractSpells(active);
    if (spells.length) you.summonerSpells = spells;
    const abilities = extractAbilityLevels(active);
    if (abilities) you.abilityLevels = abilities;
    const lane = extractLaneRole(match) || extractLaneRole(active);
    if (lane) you.laneRole = lane;
  }

  const eventsRaw: any[] = data?.events?.Events ?? data?.events ?? [];
  const recentEvents: GameEvent[] = eventsRaw.slice(-15).map((e) => ({
    type: mapEventType(e.EventName ?? e.eventName ?? e.type),
    gameTime: Number(e.EventTime ?? e.gameTime ?? 0),
    message: summarizeEvent(e),
    payload: e,
  }));

  return {
    source,
    inGame: Boolean(you || allPlayers.length),
    gameTime,
    gameMode,
    mapName: mapName || undefined,
    queueType: queueType || undefined,
    gameQueueConfigId,
    you,
    scoreboard,
    recentEvents,
    updatedAt: new Date().toISOString(),
  };
}

/** Match local player across Riot ID formats (name, name#tag, riotId). */
function findLocalPlayer(
  allPlayers: any[],
  active: any,
  activePlayerName?: string | null
): any | null {
  if (!allPlayers.length) return null;

  const candidates = [
    activePlayerName,
    active?.riotId,
    active?.summonerName,
    active?.riotIdGameName,
    activePlayerName ? String(activePlayerName).split("#")[0] : "",
    active?.riotId ? String(active.riotId).split("#")[0] : "",
    active?.summonerName ? String(active.summonerName).split("#")[0] : "",
  ]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);

  for (const p of allPlayers) {
    if (p.isLocalPlayer === true) return p;
  }

  for (const p of allPlayers) {
    const fields = [
      p.riotId,
      p.riotIdGameName,
      p.summonerName,
      p.riotIdGameName && p.riotIdTagLine
        ? `${p.riotIdGameName}#${p.riotIdTagLine}`
        : "",
      p.riotIdGameName ? String(p.riotIdGameName).split("#")[0] : "",
      p.summonerName ? String(p.summonerName).split("#")[0] : "",
    ]
      .map((s) => String(s || "").trim().toLowerCase())
      .filter(Boolean);

    if (fields.some((f) => candidates.includes(f))) return p;
  }

  return null;
}

function playerToYou(p: any, active: any): ActiveYou {
  const abilityLevels = extractAbilityLevels(active);
  return {
    championName: resolveChampionLabel(p.championName ?? p.rawChampionName ?? "Unknown"),
    level: Number(p.level ?? active?.level ?? 1),
    currentGold: Number(active?.currentGold ?? p.currentGold ?? 0),
    kills: Number(p.scores?.kills ?? 0),
    deaths: Number(p.scores?.deaths ?? 0),
    assists: Number(p.scores?.assists ?? 0),
    creeps: Number(p.scores?.creepScore ?? 0),
    isDead: Boolean(p.isDead),
    summonerSpells: [p.summonerSpellOne?.displayName, p.summonerSpellTwo?.displayName].filter(
      Boolean
    ) as string[],
    items: Array.isArray(p.items)
      ? p.items.map((i: any) => i?.displayName).filter(Boolean)
      : [],
    laneRole: extractLaneRole(p) || extractLaneRole(active),
    abilityLevels: abilityLevels || undefined,
  };
}

/** Live Client role/lane (TOP, MIDDLE, …) — not map coordinates */
function extractLaneRole(p: any): string | undefined {
  if (!p) return undefined;
  const raw = p.position ?? p.rawPosition ?? p.role ?? p.assignedPosition;
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim();
  if (!s || s === "NONE" || s === "UNKNOWN") return undefined;
  // Ignore pure coordinate objects if ever present
  if (typeof raw === "object") return undefined;
  return s;
}

/** Your Q/W/E/R ranks from activePlayer.abilities (enemy CDs never available) */
function extractAbilityLevels(
  active: any
): { Q?: number; W?: number; E?: number; R?: number } | null {
  const ab = active?.abilities;
  if (!ab || typeof ab !== "object") return null;
  const out: { Q?: number; W?: number; E?: number; R?: number } = {};
  for (const key of ["Q", "W", "E", "R"] as const) {
    const slot = ab[key] ?? ab[key.toLowerCase()];
    if (slot && slot.abilityLevel != null) {
      const n = Number(slot.abilityLevel);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

function mapMode(m: unknown, mapName: string): GameMode {
  const s = String(m || "").toUpperCase();
  const map = mapName.toLowerCase();
  if (s.includes("CLASSIC") || map === "map11") return "CLASSIC";
  if (s.includes("ARAM") || map === "map12") return "ARAM";
  if (s.includes("URF")) return "URF";
  if (s.includes("CHERRY") || s.includes("ARENA") || map === "map30") return "ARENA";
  if (!s && !map) return "UNKNOWN";
  return "OTHER";
}

function mapEventType(name: string): GameEvent["type"] {
  const n = (name || "").toLowerCase();
  if (n.includes("gamestart") || n === "game start") return "GAME_START";
  if (n.includes("gameend") || n === "game end") return "GAME_END";
  if (n.includes("championkill") || n.includes("champion kill") || n === "death") return "DEATH";
  if (n.includes("dragon")) return "DRAGON";
  if (n.includes("baron")) return "BARON";
  if (n.includes("herald")) return "HERALD";
  if (n.includes("turret") || n.includes("tower")) return "TURRET";
  if (n.includes("level")) return "LEVEL_UP";
  return "OTHER";
}

function summarizeEvent(e: any): string {
  const name = e.EventName ?? e.eventName ?? e.type ?? "event";
  if (e.KillerName && e.VictimName) return `${name}: ${e.KillerName} → ${e.VictimName}`;
  return String(name);
}

function extractSpells(active: any): string[] {
  const a = active?.summonerSpells ?? {};
  return [a.summonerSpellOne?.displayName, a.summonerSpellTwo?.displayName].filter(
    Boolean
  ) as string[];
}

function extractItems(active: any): string[] {
  if (!Array.isArray(active?.items)) return [];
  return active.items.map((i: any) => i?.displayName).filter(Boolean);
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
