import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSituationSummary, detectPowerSpikes, estimateTeamGold, farmBenchmark, fightNumbers, formatSituationSummary,
  itemGoldValue, objectiveState, parseTurret, summarySeedLine, ultRankForLevel, isLivePolicySafe, localFallbackLine,
} from "../src/index.js";
import { ctx, player } from "./helpers.js";

test("item gold value + team gold diff", () => {
  assert.equal(itemGoldValue(["Zhonya's Hourglass", 1001]), 3250 + 300);
  const c = ctx();
  const g = estimateTeamGold(c)!;
  assert.equal(g.diff, g.ally - g.enemy);
  assert.ok(g.ally > 0 && g.enemy > 0);
  const rich = ctx({ scoreboard: ctx().scoreboard.map((p) => (p.team === "ORDER" ? { ...p, items: ["Rabadon's Deathcap"] } : p)) });
  assert.match(estimateTeamGold(rich)!.label, /ahead ~/);
});

test("power spikes: items and 6/11/16", () => {
  assert.deepEqual([5, 6, 11, 16].map(ultRankForLevel), [0, 1, 2, 3]);
  const a = ctx();
  const b = ctx({
    scoreboard: a.scoreboard.map((p) =>
      p.championName === "Zed" ? { ...p, level: 11, items: [...p.items!, "Serylda's Grudge"] } : p.championName === "Ahri" ? { ...p, level: 9 } : p
    ),
  });
  const sp = detectPowerSpikes(a, b);
  assert.ok(sp.some((s) => s.championName === "Zed" && s.kind === "item" && /Serylda/.test(s.detail) && !s.ally));
  assert.ok(sp.some((s) => s.championName === "Zed" && s.kind === "level" && /11/.test(s.detail)));
  assert.equal(detectPowerSpikes(null, a).length, 0);
});

test("objective state: dragons, soul point, baron, towers by lane", () => {
  const c = ctx();
  c.scoreboard[0].riotIdGameName = "me";
  c.scoreboard[5].riotIdGameName = "zedmain";
  const ev = (EventName: string, extra: Record<string, unknown>, t: number) => ({
    type: (/Dragon/.test(EventName) ? "DRAGON" : /Baron/.test(EventName) ? "BARON" : /Herald/.test(EventName) ? "HERALD" : "TURRET") as any,
    gameTime: t,
    payload: { EventName, EventID: t, ...extra },
  });
  c.objectiveEvents = [
    ev("DragonKill", { DragonType: "Fire", KillerName: "me" }, 300),
    ev("DragonKill", { DragonType: "Water", KillerName: "me" }, 600),
    ev("DragonKill", { DragonType: "Water", KillerName: "me" }, 900),
    ev("DragonKill", { DragonType: "Earth", KillerName: "zedmain" }, 1200),
    ev("HeraldKill", { KillerName: "zedmain" }, 500),
    ev("BaronKill", { KillerName: "me" }, 1500),
    ev("TurretKilled", { TurretKilled: "Turret_T2_L_03_A", KillerName: "me" }, 700),
    ev("TurretKilled", { TurretKilled: "Turret_T1_R_03_A", KillerName: "zedmain" }, 800),
  ];
  const o = objectiveState(c);
  assert.deepEqual(o.dragons.ORDER, ["Fire", "Water", "Water"]);
  assert.equal(o.soulPoint, "ORDER");
  assert.equal(o.soul, null);
  assert.equal(o.herald.CHAOS, 1);
  assert.equal(o.baron.ORDER, 1);
  assert.equal(o.towersLost.CHAOS.top, 1);
  assert.equal(o.towersLost.ORDER.bot, 1);
  assert.deepEqual(parseTurret("Turret_T1_C_05_A"), { team: "ORDER", lane: "mid" });
});

test("fight numbers", () => {
  const c = ctx({
    scoreboard: ctx().scoreboard.map((p) => (["Zed", "Vi"].includes(p.championName) ? { ...p, isDead: true } : p)),
  });
  const n = fightNumbers(c)!;
  assert.equal(n.label, "5v3");
  assert.equal(n.advantage, 2);
  assert.deepEqual(n.deadEnemies, ["Zed", "Vi"]);
});

test("farm benchmarks by role", () => {
  assert.equal(farmBenchmark("MIDDLE", 150, 120), null);
  const f = farmBenchmark("MIDDLE", 80, 900, 6000)!;
  assert.equal(f.csPerMin, 5.3);
  assert.equal(f.rating, "behind");
  assert.equal(f.gpm, 400);
  assert.equal(farmBenchmark("UTILITY", 30, 900)!.rating, "ahead");
});

test("situation summary is compact text and seeds are policy-safe + specific", () => {
  const c = ctx({
    scoreboard: ctx().scoreboard.map((p) => (["Zed", "Vi"].includes(p.championName) ? { ...p, isDead: true } : p)),
  });
  c.you!.currentGold = 1800;
  const s = buildSituationSummary(c);
  assert.equal(s.role, "MIDDLE");
  assert.equal(s.matchup?.opponent, "Zed");
  const text = formatSituationSummary(s);
  assert.ok(text.split("\n").length <= 12);
  assert.match(text, /NUMBERS 5v3/);
  assert.ok(text.length < 1200);
  const kill = summarySeedLine(s, "kill")!;
  assert.match(kill, /5v3 with Zed and Vi dead/);
  assert.ok(isLivePolicySafe(kill), kill);
  const base = summarySeedLine(s, "base")!;
  assert.match(base, /1800 gold unspent\. \d AD threats — armor items like/);
  assert.ok(isLivePolicySafe(base), base);
  assert.equal(localFallbackLine(c, "base"), base);
});
