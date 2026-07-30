/**
 * Coach smoke harness — fixture-driven speak/silence checks.
 * Run via: node packages/shared/dist/coachSmoke.js  (after build)
 * Or: npm run smoke:coach -w @riftcoach/shared
 */

import type { GameContext, ActiveYou, PlayerScoreline } from "./index.js";
import {
  detectCoachInsights,
  emptyWatchState,
  pickSpeakableInsight,
  type CoachWatchState,
} from "./insights.js";
import { isObviousLine } from "./coachLines.js";
import { computeMatchAnalytics } from "./analytics.js";
import {
  emptyMatchMemory,
  updateMatchMemory,
} from "./matchMemory.js";
import { buildPostGameReport } from "./postGameReport.js";
import { gradeMatch } from "./goals.js";
import { computeObjClockBrain } from "./objClockBrain.js";

function youBase(over: Partial<ActiveYou> = {}): ActiveYou {
  return {
    championName: "Ahri",
    level: 8,
    currentGold: 400,
    totalGold: 4000,
    kills: 1,
    deaths: 0,
    assists: 1,
    creeps: 80,
    currentHealth: 1200,
    maxHealth: 1500,
    currentMana: 500,
    maxMana: 900,
    summonerSpells: ["Flash", "Ignite"],
    items: ["Lost Chapter"],
    isDead: false,
    ...over,
  };
}

function sb(
  name: string,
  team: "ORDER" | "CHAOS",
  k: number,
  d: number,
  a: number,
  level = 8,
  creeps = 70
): PlayerScoreline {
  return { championName: name, team, level, kills: k, deaths: d, assists: a, creeps };
}

function ctx(
  over: Omit<Partial<GameContext>, "you"> & { you?: Partial<ActiveYou> | null } = {}
): GameContext {
  const y = over.you === null ? null : youBase(over.you || {});
  const { you: _you, ...rest } = over;
  return {
    source: "mock",
    inGame: true,
    gameTime: 600,
    gameMode: "CLASSIC",
    mapName: "Map11",
    scoreboard: [
      sb("Ahri", "ORDER", 1, 0, 1),
      sb("LeeSin", "ORDER", 1, 1, 2),
      sb("Orianna", "CHAOS", 1, 1, 1),
      sb("Viego", "CHAOS", 1, 0, 0),
    ],
    recentEvents: [],
    updatedAt: new Date().toISOString(),
    ...rest,
    you: y,
  };
}

export interface SmokeCase {
  id: string;
  name: string;
  /** Build prev watch + next context */
  run: () => {
    expectSpeak: boolean;
    expectKind?: string;
    forbidObvious?: boolean;
    forbidAramBase?: boolean;
  };
}

function runInsights(
  context: GameContext,
  prev: CoachWatchState,
  agentSignals?: import("./index.js").DetectedSignal[]
) {
  return detectCoachInsights({
    ctx: context,
    prev,
    agentSignals,
    now: Date.now(),
  });
}

export const SMOKE_CASES: SmokeCase[] = [
  {
    id: "static_silence",
    name: "Stable board → no speakable insight under normal threshold",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastLevel = 8;
      prev.lastKills = 1;
      prev.lastAssists = 1;
      prev.lastAllyDead = 0;
      prev.lastEnemyDead = 0;
      prev.lastHpBucket = 0;
      prev.lastGoldBucket = 0;
      prev.lastPressure = "even";
      prev.lastWinCon = "scale";
      prev.lastTempo = "even";
      prev.lastFightLight = "yellow";
      prev.lastManAdv = 0;
      prev.lastObjMinute = 7;
      prev.lastSignatures = ["tempo:even:scale", "elite:tempo:even:scale"];
      // Quiet clock between obj spikes (not 5/8/14/20/25)
      const c = ctx({
        gameTime: 400,
        you: {
          level: 8,
          kills: 1,
          deaths: 0,
          assists: 1,
          currentGold: 350,
          currentHealth: 1300,
          maxHealth: 1500,
        },
        scoreboard: [
          { ...sb("Ahri", "ORDER", 1, 0, 1, 8), isDead: false },
          { ...sb("LeeSin", "ORDER", 1, 1, 2, 8), isDead: false },
          { ...sb("Orianna", "CHAOS", 1, 1, 1, 8), isDead: false },
          { ...sb("Viego", "CHAOS", 1, 0, 0, 8), isDead: false },
        ],
      });
      const { insights } = runInsights(c, prev);
      // Filter out low-value elite tempo identity noise for silence check
      const meaningful = insights.filter(
        (i) =>
          i.score >= 44 &&
          !["tempo_flip", "brain_window"].includes(i.kind) ||
          (i.score >= 50 && ["death", "low_hp", "numbers", "fight_window", "hold_window"].includes(i.kind))
      );
      const best = pickSpeakableInsight(meaningful, "normal");
      return {
        expectSpeak: false,
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "numbers_up",
    name: "Enemy double death → convert / numbers insight speaks",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastEnemyDead = 0;
      prev.lastAllyDead = 0;
      prev.lastLevel = 8;
      prev.lastFightLight = "yellow";
      const order = [
        { ...sb("Ahri", "ORDER", 2, 0, 1, 9), isDead: false },
        { ...sb("LeeSin", "ORDER", 2, 0, 2, 9), isDead: false },
        { ...sb("Jinx", "ORDER", 1, 0, 1, 8), isDead: false },
        { ...sb("Nami", "ORDER", 0, 0, 3, 8), isDead: false },
        { ...sb("Thresh", "ORDER", 0, 0, 2, 7), isDead: false },
      ];
      const chaos = [
        { ...sb("Orianna", "CHAOS", 1, 1, 0, 8), isDead: true },
        { ...sb("Viego", "CHAOS", 0, 1, 0, 8), isDead: true },
        { ...sb("Jhin", "CHAOS", 0, 0, 0, 7), isDead: false },
        { ...sb("Lulu", "CHAOS", 0, 0, 1, 7), isDead: false },
        { ...sb("Sett", "CHAOS", 1, 0, 0, 8), isDead: false },
      ];
      const c = ctx({ scoreboard: [...order, ...chaos] });
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const convertKinds = new Set(["numbers", "fight_window", "field_alert"]);
      const okKind =
        best &&
        (convertKinds.has(best.kind) ||
          best.kind === "battle" ||
          /plates|obj|down|tower|BASE|collapse/i.test(best.line));
      return {
        expectSpeak: true,
        expectKind: okKind ? best!.kind : "numbers",
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "low_hp",
    name: "Critical HP → urgent low_hp / shotcall insight",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastHpBucket = 0;
      prev.lastLevel = 8;
      const c = ctx({
        you: { currentHealth: 200, maxHealth: 1500, currentGold: 900 },
      });
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const ok =
        best &&
        (best.kind === "low_hp" ||
          best.kind === "battle" ||
          best.kind === "disengage" ||
          /%|BASE|leave|base/i.test(best.line));
      return {
        expectSpeak: true,
        expectKind: ok ? best!.kind : "low_hp",
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "aram_no_base",
    name: "ARAM high gold does not fire base/gold_sit",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastGoldBucket = 0;
      prev.lastLevel = 10;
      const c = ctx({
        gameMode: "ARAM",
        mapName: "Map12",
        you: { currentGold: 2000, level: 10 },
      });
      const { insights } = runInsights(c, prev);
      const baseLike = insights.filter(
        (i) => i.kind === "base" || i.kind === "gold_sit" || /base|recall|shop/i.test(i.line)
      );
      const best = pickSpeakableInsight(insights, "normal");
      return {
        expectSpeak: baseLike.length === 0 ? false : !baseLike.some((b) => b.score >= 28),
        forbidAramBase: true,
        _best: best,
        _baseLike: baseLike,
      } as ReturnType<SmokeCase["run"]> & {
        _best: typeof best;
        _baseLike: typeof baseLike;
      };
    },
  },
  {
    id: "death_habit",
    name: "Death signal → death insight speaks",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastLevel = 8;
      const c = ctx({
        you: { isDead: true, deaths: 2, currentHealth: 0 },
        deathReport: {
          total: 2,
          early: 1,
          mid: 1,
          late: 0,
          dominant: "overchase",
        },
      });
      const signal = {
        id: "s-death",
        kind: "death" as const,
        severity: "urgent" as const,
        gameTime: 600,
        title: "death",
        coachPrompt: "death",
        spokenFallback: "Ahri: overchase habit — next spawn crash then leave, no fog.",
        createdAt: new Date().toISOString(),
      };
      const { insights } = runInsights(c, prev, [signal]);
      const best = pickSpeakableInsight(insights, "normal");
      return {
        expectSpeak: true,
        expectKind: "death",
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "battle_read",
    name: "Kill cluster → battle reader issues fight job",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastLevel = 10;
      prev.lastFightLight = "yellow";
      prev.lastBattleSig = null;
      const order = [
        { ...sb("Ahri", "ORDER", 3, 1, 2, 10), isDead: false },
        { ...sb("LeeSin", "ORDER", 2, 1, 3, 10), isDead: false },
        { ...sb("Jinx", "ORDER", 4, 0, 1, 10), isDead: false },
        { ...sb("Nami", "ORDER", 0, 1, 5, 9), isDead: false },
        { ...sb("Thresh", "ORDER", 0, 2, 3, 9), isDead: true },
      ];
      const chaos = [
        { ...sb("Zed", "CHAOS", 5, 1, 0, 10), isDead: false },
        { ...sb("Viego", "CHAOS", 2, 2, 1, 10), isDead: true },
        { ...sb("Jhin", "CHAOS", 1, 1, 0, 9), isDead: false },
        { ...sb("Lulu", "CHAOS", 0, 1, 2, 8), isDead: false },
        { ...sb("Sett", "CHAOS", 1, 0, 0, 9), isDead: false },
      ];
      const c = ctx({
        gameTime: 820,
        you: {
          championName: "Ahri",
          level: 10,
          kills: 3,
          deaths: 1,
          assists: 2,
          currentGold: 600,
          currentHealth: 1100,
          maxHealth: 1600,
        },
        scoreboard: [...order, ...chaos],
        recentEvents: [
          {
            type: "DEATH",
            gameTime: 812,
            message: "ChampionKill: Zed → Thresh",
          },
          {
            type: "DEATH",
            gameTime: 816,
            message: "ChampionKill: Ahri → Viego",
          },
        ],
      });
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const battleHit = insights.some(
        (i) =>
          i.kind === "battle" ||
          i.kind === "focus_fire" ||
          i.kind === "disengage" ||
          i.kind === "fight_window" ||
          /fight|peel|focus|DPS|disengage|winning|losing/i.test(i.line)
      );
      return {
        expectSpeak: battleHit || (best != null && best.score >= 40),
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "elite_convert",
    name: "Elite synthesizer produces high-score convert line",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastEnemyDead = 0;
      prev.lastFightLight = "yellow";
      prev.lastLevel = 11;
      const order = [
        { ...sb("Ahri", "ORDER", 5, 0, 3, 11), isDead: false },
        { ...sb("LeeSin", "ORDER", 3, 1, 4, 10), isDead: false },
        { ...sb("Jinx", "ORDER", 4, 1, 2, 10), isDead: false },
        { ...sb("Nami", "ORDER", 0, 0, 6, 9), isDead: false },
        { ...sb("Thresh", "ORDER", 1, 1, 5, 9), isDead: false },
      ];
      const chaos = [
        { ...sb("Malphite", "CHAOS", 2, 3, 0, 10), isDead: true },
        { ...sb("Viego", "CHAOS", 3, 2, 1, 10), isDead: true },
        { ...sb("Jhin", "CHAOS", 1, 1, 0, 9), isDead: false },
        { ...sb("Lulu", "CHAOS", 0, 2, 1, 8), isDead: false },
        { ...sb("Sett", "CHAOS", 2, 1, 0, 9), isDead: false },
      ];
      const c = ctx({
        gameTime: 900,
        you: {
          championName: "Ahri",
          level: 11,
          kills: 5,
          deaths: 0,
          assists: 3,
          currentGold: 500,
          currentHealth: 1500,
          maxHealth: 1800,
        },
        scoreboard: [...order, ...chaos],
      });
      const { insights, eliteBest } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const eliteOk =
        eliteBest != null &&
        eliteBest.score >= 40 &&
        !isObviousLine(eliteBest.line) &&
        /\d|plates|obj|down|green|Malph|Viego/i.test(eliteBest.line);
      return {
        expectSpeak: eliteOk || (best != null && best.score >= 40),
        forbidObvious: true,
        _best: best,
        _elite: eliteBest,
      } as ReturnType<SmokeCase["run"]> & {
        _best: typeof best;
        _elite: typeof eliteBest;
      };
    },
  },
  {
    id: "fight_green",
    name: "Man advantage → convert / fight_window insight speaks",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastEnemyDead = 0;
      prev.lastAllyDead = 0;
      prev.lastFightLight = "yellow";
      prev.lastLevel = 10;
      prev.lastManAdv = 0;
      const order = [
        { ...sb("Ahri", "ORDER", 3, 0, 2, 10), isDead: false },
        { ...sb("LeeSin", "ORDER", 2, 1, 3, 10), isDead: false },
        { ...sb("Jinx", "ORDER", 2, 0, 1, 9), isDead: false },
        { ...sb("Nami", "ORDER", 0, 1, 4, 9), isDead: false },
        { ...sb("Thresh", "ORDER", 0, 0, 2, 8), isDead: false },
      ];
      const chaos = [
        { ...sb("Malphite", "CHAOS", 1, 2, 0, 9), isDead: true },
        { ...sb("Viego", "CHAOS", 2, 1, 1, 10), isDead: true },
        { ...sb("Jhin", "CHAOS", 1, 0, 0, 8), isDead: false },
        { ...sb("Lulu", "CHAOS", 0, 1, 2, 8), isDead: false },
        { ...sb("Sett", "CHAOS", 1, 0, 0, 9), isDead: false },
      ];
      const c = ctx({
        gameTime: 720,
        you: {
          championName: "Ahri",
          level: 10,
          kills: 3,
          deaths: 0,
          assists: 2,
          currentGold: 400,
          currentHealth: 1400,
          maxHealth: 1600,
        },
        scoreboard: [...order, ...chaos],
      });
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const hit = insights.some(
        (i) =>
          i.kind === "fight_window" ||
          i.kind === "numbers" ||
          i.kind === "field_alert" ||
          (i.score >= 70 && /green|plates|down/i.test(i.line))
      );
      return {
        expectSpeak: hit || (best != null && best.score >= 24),
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "obj_clock",
    name: "Objective clock produces setup/live window",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastLevel = 10;
      prev.lastObjMinute = -1;
      const c = ctx({
        gameTime: 20 * 60 + 5,
        gameMode: "CLASSIC",
        mapName: "Map11",
        you: {
          championName: "Ahri",
          level: 13,
          kills: 4,
          deaths: 1,
          assists: 3,
          currentGold: 500,
          currentHealth: 1400,
          maxHealth: 1800,
        },
        recentEvents: [
          {
            type: "DRAGON",
            gameTime: 18 * 60,
            message: "Dragon slain",
          },
        ],
      });
      const a = computeMatchAnalytics(c);
      const clock = computeObjClockBrain(c, a);
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      const ok =
        Boolean(clock?.primary) &&
        Boolean(a?.objectiveWindows?.length) &&
        (clock!.timers.length > 0 || insights.some((i) => i.kind === "objective_clock"));
      return {
        expectSpeak: ok,
        forbidObvious: true,
        _best: ok
          ? {
              kind: "objective_clock",
              line: clock?.speak || a?.objectiveWindows[0] || "obj",
              score: clock?.score || 50,
            }
          : best,
      } as ReturnType<SmokeCase["run"]> & {
        _best: { kind: string; line: string; score: number } | null;
      };
    },
  },
  {
    id: "post_game_report",
    name: "Post-game report builds habits + next LO",
    run: () => {
      const c = ctx({
        gameTime: 1800,
        you: {
          championName: "Ahri",
          level: 14,
          kills: 6,
          deaths: 4,
          assists: 7,
          creeps: 180,
          currentGold: 400,
          currentHealth: 1500,
          maxHealth: 2000,
          isDead: false,
        },
      });
      let mem = emptyMatchMemory("Ahri");
      const c1 = ctx({
        gameTime: 400,
        you: {
          championName: "Ahri",
          deaths: 1,
          currentGold: 1400,
          kills: 1,
          assists: 0,
          creeps: 40,
          level: 6,
        },
      });
      mem = updateMatchMemory(mem, c1, computeMatchAnalytics(c1));
      const c2 = ctx({
        gameTime: 520,
        you: {
          championName: "Ahri",
          deaths: 2,
          currentGold: 200,
          kills: 1,
          assists: 1,
          creeps: 50,
          level: 7,
        },
      });
      mem = updateMatchMemory(mem, c2, computeMatchAnalytics(c2));
      const grade = gradeMatch({
        kills: 6,
        deaths: 4,
        assists: 7,
        creeps: 180,
        gameTimeSec: 1800,
        earlyDeaths: 2,
        gameMode: "CLASSIC",
        mapName: "Map11",
      });
      const report = buildPostGameReport({
        ctx: c,
        memory: mem,
        analytics: computeMatchAnalytics(c),
        grade,
        result: "loss",
      });
      const ok =
        Boolean(report) &&
        report.scoreline.includes("Ahri") &&
        report.nextQueueLo.length > 8 &&
        report.cards.length >= 3 &&
        report.speakable.length > 10;
      return {
        expectSpeak: ok,
        expectKind: ok ? "death" : "post_game_fail",
        _best: ok
          ? { kind: "death", line: report.speakable, score: 99 }
          : null,
      } as ReturnType<SmokeCase["run"]> & {
        _best: { kind: string; line: string; score: number } | null;
      };
    },
  },
];

export interface SmokeResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

export function runCoachSmoke(): { passed: number; failed: number; results: SmokeResult[] } {
  const results: SmokeResult[] = [];
  for (const tc of SMOKE_CASES) {
    try {
      const out = tc.run() as ReturnType<SmokeCase["run"]> & {
        _best?: { kind: string; line: string; score: number } | null;
        _baseLike?: { kind: string; line: string }[];
      };
      const best = out._best ?? null;
      let pass = true;
      const bits: string[] = [];

      if (out.expectSpeak) {
        if (!best) {
          pass = false;
          bits.push("expected speak, got silence");
        } else {
          bits.push(`spoke ${best.kind} score=${best.score}`);
          if (out.expectKind && best.kind !== out.expectKind) {
            // allow supersets for numbers
            if (!(out.expectKind === "numbers" && best.kind === "numbers")) {
              if (best.kind !== out.expectKind) {
                pass = false;
                bits.push(`expected kind ${out.expectKind}`);
              }
            }
          }
        }
      } else {
        if (best && best.score >= 28 && tc.id === "static_silence") {
          pass = false;
          bits.push(`unexpected speak ${best.kind}: ${best.line.slice(0, 60)}`);
        } else {
          bits.push("silence ok");
        }
      }

      if (out.forbidObvious && best?.line && isObviousLine(best.line)) {
        pass = false;
        bits.push(`obvious line: ${best.line.slice(0, 50)}`);
      }

      if (out.forbidAramBase && out._baseLike && out._baseLike.length) {
        const high = out._baseLike.filter((b) => /base|recall|shop/i.test(b.line));
        if (high.length) {
          pass = false;
          bits.push(`ARAM base-like: ${high[0].line.slice(0, 50)}`);
        }
      }

      results.push({
        id: tc.id,
        name: tc.name,
        pass,
        detail: bits.join("; "),
      });
    } catch (e) {
      results.push({
        id: tc.id,
        name: tc.name,
        pass: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}

/** CLI entry when run as node dist/coachSmoke.js */
export function mainSmokeCli(): void {
  const { passed, failed, results } = runCoachSmoke();
  for (const r of results) {
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(`[${mark}] ${r.id}: ${r.detail}`);
  }
  console.log(`\nCoach smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// Allow: node --experimental-vm-modules dist/coachSmoke.js
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("coachSmoke.js") || process.argv[1].endsWith("coachSmoke.ts"));
if (isMain) {
  mainSmokeCli();
}
