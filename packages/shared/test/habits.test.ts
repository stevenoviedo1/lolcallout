import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameHabitTracker, emptyHabitProfile, recordGame, computeHabits, formatHabitsForAi, habitPlanLine, sanitizeHabitProfile,
  type GameHabitRecord,
} from "../src/index.js";
import { ctx } from "./helpers.js";

const rec = (o: Partial<GameHabitRecord> = {}): GameHabitRecord => ({
  endedAt: new Date(0).toISOString(), champion: "Ahri", role: "MIDDLE", durationSec: 1800, deaths: 5,
  deathsWhileAhead: 0, deathsBeforeObjective: 0, deathsAfterObjective: 0, csPerMin: 7.5, csTarget: 7.5,
  controlWardsBought: 3, highGoldDeaths: 0, avgGoldAtDeath: 600, ...o,
});

test("tracker records deaths with gold, objectives, wards", () => {
  const t = new GameHabitTracker();
  const c = ctx({ gameTime: 500 });
  c.you!.currentGold = 1700;
  t.ingest(c);
  const c2 = ctx({ gameTime: 560, objectiveEvents: [{ type: "DRAGON", gameTime: 590, payload: {} }] });
  c2.you!.deaths = 2;
  c2.you!.isDead = true;
  c2.you!.currentGold = 1750;
  c2.you!.items = [...(c2.you!.items ?? []), "Control Ward"];
  t.ingest(c2);
  const c3 = ctx({ gameTime: 1200, objectiveEvents: c2.objectiveEvents });
  c3.you!.deaths = 2;
  t.ingest(c3);
  const r = t.finish()!;
  assert.equal(r.deaths, 1);
  assert.equal(r.highGoldDeaths, 1);
  assert.equal(r.deathsBeforeObjective, 1);
  assert.equal(r.controlWardsBought, 1);
  assert.equal(r.champion, "Ahri");
  assert.ok(r.csPerMin > 0);
});

test("rolling profile keeps top 3 habits and plan line", () => {
  let p = emptyHabitProfile();
  for (let i = 0; i < 5; i++) p = recordGame(p, rec({ highGoldDeaths: i < 4 ? 1 : 0, controlWardsBought: i % 2 }));
  assert.equal(p.rolling.games, 5);
  assert.ok(p.top.length >= 1 && p.top.length <= 3);
  assert.equal(p.top[0].id, "high_gold_deaths");
  assert.match(habitPlanLine(p)!, /Last 5 games you died with 1500\+ gold 4 times — consider basing earlier/);
  assert.match(formatHabitsForAi(p), /PLAYER HABITS/);
  assert.equal(computeHabits([]).length, 0);
});

test("profile caps at 20 games and sanitizes garbage", () => {
  let p = emptyHabitProfile();
  for (let i = 0; i < 25; i++) p = recordGame(p, rec());
  assert.equal(p.games.length, 20);
  assert.equal(sanitizeHabitProfile({ nope: 1 }).games.length, 0);
  assert.equal(sanitizeHabitProfile(JSON.parse(JSON.stringify(p))).games.length, 20);
});
