import type { GameMode } from "@riftcoach/shared";

export function modeLabel(mode?: GameMode | string, mapName?: string): string {
  const m = String(mode || "").toUpperCase();
  const map = (mapName || "").toLowerCase();
  if (m === "CLASSIC" || map === "map11") return "SR";
  if (m === "ARAM" || map === "map12") return "ARAM";
  if (m === "ARENA" || map === "map30") return "Arena";
  if (m === "URF") return "URF";
  if (m && m !== "UNKNOWN" && m !== "OTHER") return m;
  return "—";
}

export function modeFullLabel(mode?: GameMode | string, mapName?: string): string {
  const short = modeLabel(mode, mapName);
  if (short === "SR") return "Summoner's Rift";
  if (short === "Arena") return "Arena";
  if (short === "ARAM") return "ARAM";
  return short;
}

export function hpPct(current?: number, max?: number): number | null {
  if (current == null || max == null || max <= 0) return null;
  return Math.round((current / max) * 100);
}
