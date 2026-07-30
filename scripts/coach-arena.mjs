/**
 * Coach arena — roleplay stress test for battle reading + elite callouts.
 * Run: node scripts/coach-arena.mjs
 */
import { computeMatchAnalytics } from "../packages/shared/dist/analytics.js";
import { readBattle } from "../packages/shared/dist/battleReader.js";
import {
  synthesizeEliteCallouts,
  pickEliteCallout,
} from "../packages/shared/dist/eliteCoach.js";
import {
  emptyMatchMemory,
  updateMatchMemory,
} from "../packages/shared/dist/matchMemory.js";
import { detectModeProfile } from "../packages/shared/dist/modes.js";
import {
  detectCoachInsights,
  emptyWatchState,
  pickSpeakableInsight,
} from "../packages/shared/dist/insights.js";
import { isObviousLine } from "../packages/shared/dist/coachLines.js";
import { deepReasonBoard } from "../packages/shared/dist/deepReason.js";
import { computeOracleBrain } from "../packages/shared/dist/oracleBrain.js";

function you(o = {}) {
  return {
    championName: "Ahri",
    level: 11,
    currentGold: 900,
    kills: 4,
    deaths: 1,
    assists: 3,
    creeps: 140,
    currentHealth: 1200,
    maxHealth: 1700,
    summonerSpells: ["Flash", "Ignite"],
    items: ["Ludens Companion", "Sorcerers Shoes", "Needlessly Large Rod"],
    isDead: false,
    ...o,
  };
}

function p(name, team, k, d, a, level, dead = false) {
  return {
    championName: name,
    team,
    level,
    kills: k,
    deaths: d,
    assists: a,
    creeps: 80,
    isDead: dead,
  };
}

const scenarios = [
  {
    id: "3v3_teamfight_winning",
    want: ["winning|teamfight|commit|DPS|focus|plates", "named enemy or ally"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 920,
      gameMode: "CLASSIC",
      mapName: "Map11",
      you: you({ currentHealth: 1100 }),
      scoreboard: [
        p("Ahri", "ORDER", 4, 1, 3, 11),
        p("LeeSin", "ORDER", 3, 1, 4, 11),
        p("Jinx", "ORDER", 5, 1, 2, 11),
        p("Nami", "ORDER", 0, 2, 6, 10),
        p("Ornn", "ORDER", 1, 2, 3, 10, true),
        p("Zed", "CHAOS", 6, 2, 1, 11),
        p("Viego", "CHAOS", 2, 3, 2, 10, true),
        p("Jhin", "CHAOS", 2, 1, 1, 10, true),
        p("Lulu", "CHAOS", 0, 1, 3, 9),
        p("Malphite", "CHAOS", 1, 1, 2, 11),
      ],
      recentEvents: [
        { type: "DEATH", gameTime: 910, message: "ChampionKill: Zed → Ornn" },
        { type: "DEATH", gameTime: 914, message: "ChampionKill: Ahri → Viego" },
        { type: "DEATH", gameTime: 917, message: "ChampionKill: LeeSin → Jhin" },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
  {
    id: "losing_disengage_low_hp",
    want: ["disengage|leave|base|%|hold|peel", "not play safe"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 780,
      gameMode: "CLASSIC",
      mapName: "Map11",
      you: you({
        currentHealth: 280,
        maxHealth: 1600,
        currentGold: 1500,
        deaths: 3,
        kills: 2,
      }),
      scoreboard: [
        p("Ahri", "ORDER", 2, 3, 1, 10),
        p("LeeSin", "ORDER", 1, 3, 2, 9, true),
        p("Jinx", "ORDER", 2, 2, 1, 10, true),
        p("Nami", "ORDER", 0, 2, 3, 9, true),
        p("Ornn", "ORDER", 1, 1, 2, 10),
        p("Zed", "CHAOS", 7, 0, 1, 11),
        p("Viego", "CHAOS", 4, 1, 3, 11),
        p("Jhin", "CHAOS", 3, 0, 2, 10),
        p("Lulu", "CHAOS", 1, 1, 4, 10),
        p("Malphite", "CHAOS", 2, 1, 3, 11),
      ],
      recentEvents: [
        { type: "DEATH", gameTime: 770, message: "ChampionKill: Zed → LeeSin" },
        { type: "DEATH", gameTime: 773, message: "ChampionKill: Viego → Jinx" },
        {
          type: "DEATH",
          gameTime: 776,
          message: "ChampionKill: Malphite → Nami",
        },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
  {
    id: "support_peel_jinx",
    want: ["peel|Jinx|Zed|zone", "support job"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 1100,
      gameMode: "CLASSIC",
      mapName: "Map11",
      you: you({
        championName: "Nami",
        level: 12,
        kills: 1,
        deaths: 2,
        assists: 12,
        creeps: 28,
        currentGold: 700,
        currentHealth: 900,
        maxHealth: 1400,
        items: [
          "Moonstone Renewer",
          "Ionian Boots of Lucidity",
          "Staff of Flowing Water",
        ],
      }),
      scoreboard: [
        p("Nami", "ORDER", 1, 2, 12, 12),
        p("Jinx", "ORDER", 6, 2, 3, 12),
        p("Ahri", "ORDER", 4, 3, 5, 12, true),
        p("LeeSin", "ORDER", 2, 4, 6, 11),
        p("Ornn", "ORDER", 1, 3, 4, 11),
        p("Zed", "CHAOS", 8, 1, 2, 13),
        p("Kaisa", "CHAOS", 5, 2, 4, 12),
        p("Thresh", "CHAOS", 1, 3, 8, 11),
        p("Viego", "CHAOS", 3, 2, 3, 12),
        p("Gnar", "CHAOS", 2, 2, 2, 12),
      ],
      recentEvents: [
        { type: "DEATH", gameTime: 1092, message: "ChampionKill: Zed → Ahri" },
        { type: "DEATH", gameTime: 1096, message: "ChampionKill: Kaisa → Ornn" },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
  {
    id: "post_ace_convert",
    want: ["plates|obj|base|convert|down|baron|inhib", "not chase"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 1300,
      gameMode: "CLASSIC",
      mapName: "Map11",
      you: you({ currentHealth: 1400, currentGold: 1800, kills: 6, deaths: 1 }),
      scoreboard: [
        p("Ahri", "ORDER", 6, 1, 4, 13),
        p("LeeSin", "ORDER", 4, 2, 5, 12),
        p("Jinx", "ORDER", 7, 1, 3, 13),
        p("Nami", "ORDER", 1, 1, 10, 12),
        p("Ornn", "ORDER", 2, 2, 5, 12),
        p("Zed", "CHAOS", 4, 4, 1, 12, true),
        p("Viego", "CHAOS", 2, 3, 2, 11, true),
        p("Jhin", "CHAOS", 3, 3, 1, 12, true),
        p("Lulu", "CHAOS", 0, 2, 4, 11, true),
        p("Malphite", "CHAOS", 1, 3, 3, 12, true),
      ],
      recentEvents: [
        { type: "DEATH", gameTime: 1288, message: "ChampionKill: Ahri → Zed" },
        { type: "DEATH", gameTime: 1291, message: "ChampionKill: Jinx → Jhin" },
        {
          type: "DEATH",
          gameTime: 1293,
          message: "ChampionKill: LeeSin → Viego",
        },
        {
          type: "DEATH",
          gameTime: 1295,
          message: "ChampionKill: Ornn → Malphite",
        },
        { type: "DEATH", gameTime: 1297, message: "ChampionKill: Nami → Lulu" },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
  {
    id: "aram_critical",
    want: ["max range|shop|%|stack|hold", "no base/recall while alive"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 600,
      gameMode: "ARAM",
      mapName: "Map12",
      you: you({
        currentHealth: 200,
        maxHealth: 1800,
        currentGold: 2200,
        level: 12,
      }),
      scoreboard: [
        p("Ahri", "ORDER", 5, 3, 8, 12),
        p("Jinx", "ORDER", 4, 4, 5, 12),
        p("LeeSin", "ORDER", 3, 5, 6, 11, true),
        p("Zed", "CHAOS", 6, 2, 4, 12),
        p("Malphite", "CHAOS", 2, 1, 7, 12),
        p("Lulu", "CHAOS", 1, 3, 9, 11),
      ],
      recentEvents: [
        { type: "DEATH", gameTime: 590, message: "ChampionKill: Zed → LeeSin" },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
  {
    id: "jg_obj_setup_green",
    want: ["obj|set|smite|plates|numbers", "jungle voice"],
    ctx: {
      source: "mock",
      inGame: true,
      gameTime: 1250,
      gameMode: "CLASSIC",
      mapName: "Map11",
      you: you({
        championName: "LeeSin",
        level: 11,
        kills: 3,
        deaths: 1,
        assists: 6,
        creeps: 110,
        currentGold: 1100,
        currentHealth: 1500,
        maxHealth: 1900,
        items: ["Eclipse", "Plated Steelcaps", "Scorchclaw Pup"],
      }),
      scoreboard: [
        p("LeeSin", "ORDER", 3, 1, 6, 11),
        p("Ahri", "ORDER", 5, 2, 4, 12),
        p("Jinx", "ORDER", 4, 1, 3, 11),
        p("Nami", "ORDER", 0, 1, 8, 10),
        p("Ornn", "ORDER", 1, 2, 3, 11),
        p("Viego", "CHAOS", 2, 3, 2, 10, true),
        p("Zed", "CHAOS", 3, 2, 1, 11, true),
        p("Jhin", "CHAOS", 2, 1, 2, 11),
        p("Lulu", "CHAOS", 0, 2, 4, 10),
        p("Gnar", "CHAOS", 2, 1, 1, 11),
      ],
      recentEvents: [
        {
          type: "DEATH",
          gameTime: 1240,
          message: "ChampionKill: LeeSin → Viego",
        },
        { type: "DEATH", gameTime: 1244, message: "ChampionKill: Ahri → Zed" },
        { type: "DRAGON", gameTime: 1230, message: "Dragon" },
      ],
      updatedAt: new Date().toISOString(),
    },
  },
];

function scoreLine(line, scenario) {
  const issues = [];
  if (!line) issues.push("EMPTY");
  if (line && isObviousLine(line)) issues.push("OBVIOUS");
  if (
    line &&
    /play safe|numbers down|numbers up|one clear job|farm safe|keep your head|green light|best option is/i.test(
      line
    )
  )
    issues.push("BANNED_PHRASE");
  if (line && scenario.ctx.gameMode === "ARAM" && /\bbase\b|\brecall\b/i.test(line))
    issues.push("ARAM_BASE");
  if (
    line &&
    !/\d|%|:|plates|obj|ult|peel|focus|DPS|disengage|leave|shop|spawn|charm|collapse|bodyblock|tower|inhib|BASE/i.test(
      line
    )
  )
    issues.push("NO_CONCRETE");
  if (line && line.split(/\s+/).length > 22) issues.push("TOO_LONG");
  return issues;
}

let fails = 0;
for (const s of scenarios) {
  const a = computeMatchAnalytics(s.ctx);
  const b = readBattle(s.ctx);
  let mem = emptyMatchMemory(s.ctx.you.championName);
  mem = updateMatchMemory(mem, s.ctx, a);
  const mode = detectModeProfile({
    gameMode: s.ctx.gameMode,
    mapName: s.ctx.mapName,
  });
  const deep = deepReasonBoard(a, mode, "hype");
  const oracle = a ? computeOracleBrain(a, deep, "hype") : null;
  const elite = synthesizeEliteCallouts({
    ctx: s.ctx,
    analytics: a,
    mode,
    memory: mem,
    personality: "hype",
    seed: Math.floor(s.ctx.gameTime),
  });
  const best = pickEliteCallout(elite, "normal");
  const { insights } = detectCoachInsights({
    ctx: s.ctx,
    prev: emptyWatchState(),
    memory: mem,
    personality: "hype",
  });
  const spoken = pickSpeakableInsight(insights, "normal");
  const line = spoken?.line || best?.line || b?.callout || "";
  const issues = scoreLine(line, s);

  console.log("\n=== " + s.id + " ===");
  console.log(
    "battle:",
    b?.phase,
    "heat",
    b?.heat,
    "job",
    b?.yourJob,
    "focus",
    b?.focusTarget,
    "threat",
    b?.primaryThreat
  );
  console.log(
    "oracle: winP",
    oracle?.winProb,
    "conf",
    oracle?.confidence,
    "speak",
    oracle?.shouldSpeak,
    "best",
    deep?.best?.id,
    "net",
    deep?.best?.net
  );
  console.log("seq:", oracle?.sequence?.map((s) => `[${s.t}] ${s.action}`).join(" → "));
  console.log("light", a?.fightLight, "man", a?.manAdvantage, "hp", a?.you?.hpPct?.toFixed?.(0));
  console.log("LINE:", line);
  console.log(
    "top elite:",
    elite
      .slice(0, 3)
      .map((e) => `[${e.score}] ${e.kind}: ${e.line}`)
      .join("\n  ")
  );
  if (issues.length) {
    fails++;
    console.log("ISSUES:", issues.join(", "));
  } else {
    console.log("OK");
  }
}

console.log("\n--- arena done, issue scenarios:", fails, "/", scenarios.length);
process.exit(fails ? 1 : 0);
