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
      const c = ctx({});
      const { insights } = runInsights(c, prev);
      const best = pickSpeakableInsight(insights, "normal");
      return { expectSpeak: false, forbidObvious: true, _best: best } as ReturnType<
        SmokeCase["run"]
      > & { _best: typeof best };
    },
  },
  {
    id: "numbers_up",
    name: "Enemy double death → numbers insight speaks",
    run: () => {
      const prev = emptyWatchState();
      prev.seenMatchStart = true;
      prev.lastEnemyDead = 0;
      prev.lastAllyDead = 0;
      prev.lastLevel = 8;
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
      return {
        expectSpeak: true,
        expectKind: "numbers",
        forbidObvious: true,
        _best: best,
      } as ReturnType<SmokeCase["run"]> & { _best: typeof best };
    },
  },
  {
    id: "low_hp",
    name: "Critical HP → urgent low_hp insight",
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
      return {
        expectSpeak: true,
        expectKind: "low_hp",
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
