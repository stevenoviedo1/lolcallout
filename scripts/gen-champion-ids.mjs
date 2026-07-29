import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "packages/shared/src/championIds.ts");

const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
const v = versions[0];
const data = await (
  await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`)
).json();

const entries = Object.values(data.data).sort((a, b) => Number(a.key) - Number(b.key));
const body = entries.map((c) => `  ${c.key}: ${JSON.stringify(c.name)},`).join("\n");

const src = `/**
 * Auto-generated from Data Dragon ${v} (${entries.length} champions).
 * Run: node scripts/gen-champion-ids.mjs
 */

export const CHAMPION_BY_ID: Record<number, string> = {
${body}
};

export function championNameFromId(
  id: number | string | undefined | null
): string | undefined {
  if (id == null || id === "" || id === 0 || id === "0") return undefined;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return CHAMPION_BY_ID[n];
}

/** If value is a bare champion id (e.g. "136"), return display name. */
export function resolveChampionLabel(
  nameOrId: string | number | undefined | null
): string {
  if (nameOrId == null || nameOrId === "") return "Unknown";
  const s = String(nameOrId).trim();
  if (/^\\d+$/.test(s)) return championNameFromId(s) || s;
  return s;
}
`;

fs.writeFileSync(out, src, "utf8");
console.log("Wrote", out, "champs=", entries.length, "136=", data.data.AurelionSol?.name);
