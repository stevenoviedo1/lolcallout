/**
 * Full-match roleplay — you are the player, coach speaks each beat.
 * Run: node scripts/roleplay-match.mjs
 */
import { computeMatchAnalytics } from "../packages/shared/dist/analytics.js";
import {
  synthesizeEliteCallouts,
  pickEliteCallout,
} from "../packages/shared/dist/eliteCoach.js";
import {
  emptyMatchMemory,
  updateMatchMemory,
  rememberSpoken,
  topHabits,
} from "../packages/shared/dist/matchMemory.js";
import { detectModeProfile } from "../packages/shared/dist/modes.js";
import {
  detectCoachInsights,
  emptyWatchState,
  pickSpeakableInsight,
} from "../packages/shared/dist/insights.js";
import { deepReasonBoard } from "../packages/shared/dist/deepReason.js";
import { computeOracleBrain } from "../packages/shared/dist/oracleBrain.js";
import { computeTacticalBrain } from "../packages/shared/dist/tacticalBrain.js";
import { computeObjClockBrain } from "../packages/shared/dist/objClockBrain.js";
import { buildPostGameReport, formatPostGameReportText } from "../packages/shared/dist/postGameReport.js";
import { gradeMatch } from "../packages/shared/dist/goals.js";
import { readBattle } from "../packages/shared/dist/battleReader.js";

function you(o = {}) {
  return {
    championName: "Ahri",
    level: 6,
    currentGold: 400,
    kills: 0,
    deaths: 0,
    assists: 0,
    creeps: 40,
    currentHealth: 1100,
    maxHealth: 1400,
    summonerSpells: ["Flash", "Ignite"],
    items: ["Lost Chapter"],
    isDead: false,
    laneRole: "MIDDLE",
    ...o,
  };
}

function p(name, team, k, d, a, level, dead = false, creeps = 70) {
  return { championName: name, team, level, kills: k, deaths: d, assists: a, creeps, isDead: dead };
}

function board(youK, youD, youA, youLv, opts = {}) {
  const {
    allyDead = [],
    enemyDead = [],
    zedK = 2,
    jinxK = 1,
  } = opts;
  return [
    p("Ahri", "ORDER", youK, youD, youA, youLv, false, 80 + youK * 10),
    p("LeeSin", "ORDER", 2, 1, 3, youLv, allyDead.includes("LeeSin")),
    p("Jinx", "ORDER", jinxK, 1, 2, youLv, allyDead.includes("Jinx")),
    p("Nami", "ORDER", 0, 1, 4, Math.max(5, youLv - 1), allyDead.includes("Nami")),
    p("Ornn", "ORDER", 1, 2, 2, youLv - 1, allyDead.includes("Ornn")),
    p("Zed", "CHAOS", zedK, 1, 1, youLv, enemyDead.includes("Zed")),
    p("Viego", "CHAOS", 2, 2, 1, youLv, enemyDead.includes("Viego")),
    p("Jhin", "CHAOS", 1, 1, 0, youLv - 1, enemyDead.includes("Jhin")),
    p("Lulu", "CHAOS", 0, 1, 2, youLv - 2, enemyDead.includes("Lulu")),
    p("Sett", "CHAOS", 1, 0, 1, youLv - 1, enemyDead.includes("Sett")),
  ];
}

const beats = [
  {
    t: "03:40",
    gameTime: 220,
    scene: "You (Ahri mid) just hit 6. Wave crashing. Zed is also 6.",
    you: you({ level: 6, creeps: 42, currentGold: 650, currentHealth: 1050, maxHealth: 1400 }),
    scoreboard: board(0, 0, 0, 6, { zedK: 1 }),
    events: [],
    personality: "hype",
  },
  {
    t: "06:15",
    gameTime: 375,
    scene: "You got a kill on Zed but you're at 22% HP sitting on 1100g. Ego says one more wave.",
    you: you({
      level: 7,
      kills: 1,
      deaths: 0,
      assists: 0,
      creeps: 68,
      currentGold: 1100,
      currentHealth: 280,
      maxHealth: 1450,
    }),
    scoreboard: board(1, 0, 0, 7, { zedK: 1, enemyDead: ["Zed"] }),
    events: [{ type: "DEATH", gameTime: 370, message: "ChampionKill: Ahri → Zed" }],
    personality: "hype",
  },
  {
    t: "08:02",
    gameTime: 482,
    scene: "You ignored the base call, died to jungle collapse. Dead with 1300g. Overchase habit forming.",
    you: you({
      level: 7,
      kills: 1,
      deaths: 1,
      assists: 0,
      creeps: 70,
      currentGold: 1300,
      currentHealth: 0,
      maxHealth: 1450,
      isDead: true,
    }),
    scoreboard: board(1, 1, 0, 7, { zedK: 2 }),
    events: [
      { type: "DEATH", gameTime: 478, message: "ChampionKill: Viego → Ahri" },
      { type: "HERALD", gameTime: 480, message: "Herald taken by ORDER" },
    ],
    deathReport: { total: 1, early: 1, mid: 0, late: 0, dominant: "overchase" },
    personality: "friend",
  },
  {
    t: "12:40",
    gameTime: 760,
    scene: "Dragon UP. You have numbers (+2). Lee and Jinx with you. Viego and Jhin dead.",
    you: you({
      level: 10,
      kills: 3,
      deaths: 1,
      assists: 2,
      creeps: 120,
      currentGold: 600,
      currentHealth: 1300,
      maxHealth: 1650,
    }),
    scoreboard: board(3, 1, 2, 10, {
      enemyDead: ["Viego", "Jhin"],
      zedK: 3,
      jinxK: 4,
    }),
    events: [
      { type: "DEATH", gameTime: 750, message: "ChampionKill: LeeSin → Viego" },
      { type: "DEATH", gameTime: 755, message: "ChampionKill: Jinx → Jhin" },
      { type: "DRAGON", gameTime: 700, message: "Dragon slain earlier — respawn soon" },
    ],
    personality: "hype",
  },
  {
    t: "18:20",
    gameTime: 1100,
    scene: "Teamfight bot. Zed diving Jinx. You're Nami support in this beat — peel job.",
    you: {
      championName: "Nami",
      level: 11,
      currentGold: 500,
      kills: 1,
      deaths: 2,
      assists: 9,
      creeps: 20,
      currentHealth: 900,
      maxHealth: 1400,
      summonerSpells: ["Flash", "Exhaust"],
      items: ["Moonstone", "Boots"],
      isDead: false,
      laneRole: "UTILITY",
    },
    scoreboard: [
      p("Ahri", "ORDER", 4, 2, 4, 12),
      p("LeeSin", "ORDER", 3, 2, 5, 11),
      p("Jinx", "ORDER", 6, 1, 3, 12),
      p("Nami", "ORDER", 1, 2, 9, 11),
      p("Ornn", "ORDER", 1, 3, 4, 11, true),
      p("Zed", "CHAOS", 7, 2, 2, 12),
      p("Viego", "CHAOS", 3, 3, 2, 11),
      p("Jhin", "CHAOS", 2, 2, 1, 11),
      p("Lulu", "CHAOS", 0, 2, 4, 10),
      p("Sett", "CHAOS", 2, 1, 2, 11, true),
    ],
    events: [
      { type: "DEATH", gameTime: 1095, message: "ChampionKill: Zed → Ornn" },
      { type: "DEATH", gameTime: 1098, message: "ChampionKill: Sett died" },
    ],
    personality: "hype",
  },
  {
    t: "22:10",
    gameTime: 1330,
    scene: "ACE. All 5 enemies dead. You have 1600g. Baron is up. Don't fountain dive.",
    you: you({
      level: 14,
      kills: 6,
      deaths: 2,
      assists: 5,
      creeps: 190,
      currentGold: 1600,
      currentHealth: 1400,
      maxHealth: 1900,
    }),
    scoreboard: [
      p("Ahri", "ORDER", 6, 2, 5, 14),
      p("LeeSin", "ORDER", 4, 2, 6, 13),
      p("Jinx", "ORDER", 8, 1, 4, 14),
      p("Nami", "ORDER", 1, 2, 12, 12),
      p("Ornn", "ORDER", 2, 3, 6, 13),
      p("Zed", "CHAOS", 7, 4, 2, 13, true),
      p("Viego", "CHAOS", 3, 5, 2, 12, true),
      p("Jhin", "CHAOS", 2, 4, 1, 12, true),
      p("Lulu", "CHAOS", 0, 3, 5, 11, true),
      p("Sett", "CHAOS", 2, 3, 3, 12, true),
    ],
    events: [
      { type: "DEATH", gameTime: 1320, message: "ChampionKill: Ahri → Zed" },
      { type: "DEATH", gameTime: 1322, message: "ChampionKill: Jinx → Viego" },
      { type: "DEATH", gameTime: 1324, message: "ChampionKill: LeeSin → Jhin" },
      { type: "DEATH", gameTime: 1326, message: "ChampionKill: Ornn → Lulu" },
      { type: "DEATH", gameTime: 1328, message: "ChampionKill: Nami → Sett" },
    ],
    personality: "hype",
  },
  {
    t: "24:00",
    gameTime: 1440,
    scene: "You died again chasing into fog after the ace convert. Tilt re-enter.",
    you: you({
      level: 14,
      kills: 6,
      deaths: 3,
      assists: 5,
      creeps: 195,
      currentGold: 200,
      currentHealth: 0,
      maxHealth: 1900,
      isDead: true,
    }),
    scoreboard: board(6, 3, 5, 14, { enemyDead: ["Jhin"], zedK: 8, jinxK: 8 }),
    events: [{ type: "DEATH", gameTime: 1435, message: "ChampionKill: Zed → Ahri" }],
    deathReport: { total: 3, early: 1, mid: 1, late: 1, dominant: "overchase" },
    personality: "friend",
  },
];

function clock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  LOLCallout ROLEPLAY — full match sim (you = player)       ║");
console.log("║  Coach brains: oracle · deep · tactical · obj · elite      ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

let mem = emptyMatchMemory("Ahri");
let prev = emptyWatchState();
const spoken = [];
let lastPersonality = "hype";

for (const beat of beats) {
  lastPersonality = beat.personality || "hype";
  const ctx = {
    source: "mock",
    inGame: true,
    gameTime: beat.gameTime,
    gameMode: "CLASSIC",
    mapName: "Map11",
    you: beat.you,
    scoreboard: beat.scoreboard,
    recentEvents: beat.events || [],
    deathReport: beat.deathReport,
    updatedAt: new Date().toISOString(),
  };

  const a = computeMatchAnalytics(ctx);
  mem = updateMatchMemory(mem, ctx, a);
  if (beat.deathReport?.dominant) mem.focus = beat.deathReport.dominant;

  const mode = detectModeProfile({ gameMode: "CLASSIC", mapName: "Map11" });
  const deep = deepReasonBoard(a, mode, lastPersonality);
  const oracle = a ? computeOracleBrain(a, deep, lastPersonality) : null;
  const tac = a ? computeTacticalBrain(a, mode) : null;
  const clockB = computeObjClockBrain(ctx, a, mode);
  const battle = readBattle(ctx);
  const elite = synthesizeEliteCallouts({
    ctx,
    analytics: a,
    mode,
    memory: mem,
    personality: lastPersonality,
    seed: beat.gameTime,
  });
  const eliteBest = pickEliteCallout(elite, "normal");

  const { insights, next } = detectCoachInsights({
    ctx,
    prev,
    memory: mem,
    personality: lastPersonality,
    agentSignals: beat.you.isDead
      ? [
          {
            id: `death-${beat.gameTime}`,
            kind: "death",
            severity: "urgent",
            gameTime: beat.gameTime,
            title: "death",
            coachPrompt: "death",
            spokenFallback: "",
            createdAt: new Date().toISOString(),
          },
        ]
      : undefined,
  });
  prev = next;
  const spokenInsight = pickSpeakableInsight(insights, "normal");
  const line = spokenInsight?.line || eliteBest?.line || "(silence — board quiet)";
  const kind = spokenInsight?.kind || eliteBest?.kind || "silence";
  const score = spokenInsight?.score ?? eliteBest?.score ?? 0;

  if (line && line !== "(silence — board quiet)") {
    mem = rememberSpoken(mem, line, beat.gameTime);
    spoken.push({ t: beat.t, line });
  }

  console.log(`──────── ${beat.t} ────────`);
  console.log(`SCENE: ${beat.scene}`);
  console.log(
    `BOARD: winP=${oracle?.winProb ?? "?"} conf=${oracle?.confidence ?? "?"} light=${a?.fightLight} man=${a?.manAdvantage >= 0 ? "+" : ""}${a?.manAdvantage} hp=${a?.you?.hpPct != null ? Math.round(a.you.hpPct) + "%" : "dead"} battle=${battle?.phase}/${battle?.yourJob}`
  );
  console.log(
    `BRAIN: deep=${deep?.best?.id}(net=${deep?.best?.net}) threat=${tac?.primaryThreat || "-"} obj=${clockB?.primary ? `${clockB.primary.label} ${clockB.primary.urgency} ~${clockB.primary.etaSec}s` : "-"}`
  );
  if (oracle?.sequence?.length) {
    console.log(`SEQ: ${oracle.sequence.map((s) => `[${s.t}] ${s.action}`).join(" → ")}`);
  }
  console.log(`COACH [${kind} @${score}]: ${line}`);
  if (elite[1]) console.log(`  (alt) ${elite[1].line}`);
  console.log("");
}

// ── Post-game ──
const finalYou = beats[beats.length - 1].you;
const finalCtx = {
  source: "mock",
  inGame: true,
  gameTime: 28 * 60,
  gameMode: "CLASSIC",
  mapName: "Map11",
  you: {
    ...you({
      level: 15,
      kills: 7,
      deaths: 3,
      assists: 8,
      creeps: 210,
      currentGold: 400,
      currentHealth: 1600,
      maxHealth: 2000,
    }),
  },
  scoreboard: board(7, 3, 8, 15, { zedK: 8, jinxK: 10, enemyDead: [] }),
  recentEvents: [{ type: "BARON", gameTime: 25 * 60, message: "Baron taken" }],
  deathReport: { total: 3, early: 1, mid: 1, late: 1, dominant: "overchase" },
  updatedAt: new Date().toISOString(),
};
const finalA = computeMatchAnalytics(finalCtx);
mem = updateMatchMemory(mem, finalCtx, finalA);
const grade = gradeMatch({
  kills: 7,
  deaths: 3,
  assists: 8,
  creeps: 210,
  gameTimeSec: 28 * 60,
  earlyDeaths: 1,
  repeatDeathPattern: "overchase",
  gameMode: "CLASSIC",
  mapName: "Map11",
  scoreboard: finalCtx.scoreboard,
  team: "ORDER",
});
const report = buildPostGameReport({
  ctx: finalCtx,
  memory: mem,
  analytics: finalA,
  grade,
  deathReport: finalCtx.deathReport,
  result: "win",
  stickyLo: mem.focus,
});

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  POST-GAME MEMORY REPORT                                   ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(formatPostGameReportText(report));
console.log("\n── Habits locked ──");
for (const h of topHabits(mem, 1)) {
  console.log(`  • ${h.label} x${h.count}`);
}
console.log("\n── Lines spoken this game ──");
for (const s of spoken) {
  console.log(`  ${s.t}  ${s.line}`);
}
console.log("\n── TTS ──");
console.log(`  "${report.speakable}"`);
console.log("\n✓ roleplay complete");
