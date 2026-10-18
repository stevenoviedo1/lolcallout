/**
 * Local-only habit profile at ~/.lolcallout/profile.json (override with
 * LOLCALLOUT_PROFILE_PATH). Never uploaded: no route here talks to the API.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  emptyHabitProfile,
  recordGame,
  sanitizeHabitProfile,
  type GameHabitRecord,
  type HabitProfile,
} from "@riftcoach/shared";

export function profilePath(): string {
  return process.env.LOLCALLOUT_PROFILE_PATH || join(homedir(), ".lolcallout", "profile.json");
}

let cache: HabitProfile | null = null;

export function loadProfile(): HabitProfile {
  if (cache) return cache;
  try {
    cache = sanitizeHabitProfile(JSON.parse(readFileSync(profilePath(), "utf8")));
  } catch {
    cache = emptyHabitProfile();
  }
  return cache;
}

function save(p: HabitProfile) {
  const file = profilePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2));
  renameSync(tmp, file);
}

export function saveGame(rec: GameHabitRecord): HabitProfile {
  cache = recordGame(loadProfile(), rec);
  try {
    save(cache);
  } catch (e) {
    console.warn("[agent] could not save habit profile:", (e as Error).message);
  }
  return cache;
}

export function resetProfile(): HabitProfile {
  cache = emptyHabitProfile();
  try {
    rmSync(profilePath(), { force: true });
  } catch {
    /* ignore */
  }
  return cache;
}
