/**
 * Oracle brain — premium state-of-the-art coach intelligence layer.
 * Combines win-prob, sequence planning, confidence, and silence discipline.
 * Pure functions over MatchAnalytics + optional DeepReasoning.
 */

import type { MatchAnalytics } from "./analytics.js";
import type { DeepReasoning } from "./deepReason.js";
import { getChampKit } from "./champKnowledge.js";
import type { CoachPersonality } from "./personality.js";
import { toNaturalTalk } from "./personality.js";

export interface SequenceStep {
  t: string; // "now" | "15s" | "45s" | "spawn"
  action: string;
  why: string;
}

export interface OracleBrain {
  /** 0–100 rough win probability for your team (legal board only) */
  winProb: number;
  winProbLabel: "heavy_fav" | "favored" | "coin" | "behind" | "heavy_behind";
  /** Confidence in the recommended play 0–100 */
  confidence: number;
  /** Whether coach should speak now vs stay quiet */
  shouldSpeak: boolean;
  silenceReason: string | null;
  /** Ordered micro-plan */
  sequence: SequenceStep[];
  /** One premium thesis for the next minute */
  thesis: string;
  /** Mistake most likely in next 60s */
  nextMistake: string;
  /** Speakable premium line */
  speak: string;
  forAi: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Estimate team win probability from legal Live Client signals only */
export function estimateWinProb(a: MatchAnalytics): number {
  let p = 50;
  p += Math.max(-22, Math.min(22, a.killLead * 4.5));
  p += Math.max(-12, Math.min(12, a.levelLead * 6));
  p += a.manAdvantage * 5;
  if (a.pressure === "winning") p += 8;
  if (a.pressure === "losing") p -= 8;
  if (a.fedEnemies.length) p -= 4 * a.fedEnemies.length;
  if (a.fedAllies.length) p += 3 * a.fedAllies.length;
  if (a.you.hpPct != null && a.you.hpPct < 30 && !a.you.isDead) p -= 4;
  if (a.enemy.alive === 0) p += 18;
  if (a.team.alive <= 2 && a.enemy.alive >= 4) p -= 12;
  // Gold in pocket is temporary lead if you base
  if (a.you.gold >= 1600 && !a.noRecall) p += 2;
  // Late game variance
  if (a.phase === "late") p = 50 + (p - 50) * 0.85;
  return clamp(p);
}

function winLabel(p: number): OracleBrain["winProbLabel"] {
  if (p >= 72) return "heavy_fav";
  if (p >= 58) return "favored";
  if (p >= 42) return "coin";
  if (p >= 28) return "behind";
  return "heavy_behind";
}

function buildSequence(a: MatchAnalytics, deep: DeepReasoning | null): SequenceStep[] {
  const steps: SequenceStep[] = [];
  const hp = a.you.hpPct != null ? Math.round(a.you.hpPct) : 70;
  const g = a.you.gold;
  const dead = a.enemyDeadNames.slice(0, 2);
  const bestId = deep?.best.id;

  if (a.you.isDead) {
    const g = a.you.gold;
    const bestId = deep?.best.id;
    steps.push({
      t: "spawn",
      action:
        bestId === "spawn_buy" || (g >= 900 && !a.noRecall)
          ? `Buy ${g}g if needed, then safe wave`
          : a.yourLastKiller
            ? `Respect ${a.yourLastKiller} — different entry path`
            : "Take nearest safe wave — no force",
      why: "Stop the double",
    });
    steps.push({
      t: "15s",
      action:
        a.pressure === "winning" && a.minute >= 20
          ? "Group mid with team — convert the lead"
          : "Only rejoin with 2+ allies or clear vision first",
      why: "Numbers before ego",
    });
    steps.push({
      t: "45s",
      action: a.objectiveWindows[0]
        ? `Prep next: ${a.objectiveWindows[0].split("—")[0].trim()}`
        : "Own a side wave, then look for one high-% fight",
      why: "Second-order plan after re-entry",
    });
    return steps;
  }

  if (hp < 28 || bestId === "disengage") {
    steps.push({
      t: "now",
      action: a.noRecall
        ? "Max range only — live"
        : g >= 700
          ? `Leave and base ${g}g`
          : "Leave the fight / wave",
      why: "Dead coach = zero value",
    });
    steps.push({
      t: "15s",
      action: a.noRecall ? "Shop on death if gold high" : "Come back full, re-take wave",
      why: "Reset tempo",
    });
    return steps;
  }

  if (bestId === "convert" || a.enemy.alive === 0 || (a.manAdvantage >= 2 && dead.length)) {
    steps.push({
      t: "now",
      action:
        a.you.roleHint === "JUNGLE"
          ? "Start objective / set pit"
          : dead.length
            ? `Take plates or tower while ${dead.join("+")} down`
            : "Take free tower or obj",
      why: "Timed window",
    });
    steps.push({
      t: "15s",
      action: g >= 1200 && !a.noRecall ? `Base ${g}g after one objective` : "Don't chase fog",
      why: "Convert then stabilize",
    });
    steps.push({
      t: "45s",
      action: "Reset vision and prepare next obj",
      why: "Lead snowball",
    });
    return steps;
  }

  if (bestId === "commit_fight" || a.battlePhase === "teamfight" || a.battlePhase === "skirmish") {
    const focus = a.battleFocus || a.battleThreat || "highest value";
    steps.push({
      t: "now",
      action: a.battleJob === "peel" ? "Peel / bodyblock carry" : `Focus ${focus}`,
      why: "Fight is the map",
    });
    steps.push({
      t: "15s",
      action: a.manAdvantage > 0 ? "If you win → convert tower" : "If losing → disengage early",
      why: "Second-order plan",
    });
    return steps;
  }

  // Default logistics
  steps.push({
    t: "now",
    action: g >= 1100 && !a.noRecall ? `Crash then base ${g}g` : "Own nearest wave",
    why: bestId === "logistics" ? "Spike / consistency" : "Default high-%",
  });
  steps.push({
    t: "45s",
    action: a.objectiveWindows[0]
      ? `Look toward: ${a.objectiveWindows[0].split("—")[0].trim()}`
      : "Move first after crash",
    why: "Tempo",
  });
  return steps;
}

function nextMistake(a: MatchAnalytics, winProb: number): string {
  if (a.you.isDead) return "Re-entering same angle and dying again";
  if (a.you.hpPct != null && a.you.hpPct < 30 && a.you.gold >= 1000 && !a.noRecall) {
    return "Staying for one more fight while carrying a shutdown";
  }
  if (a.enemy.dead >= 2 && a.pressure === "winning") {
    return "Chasing into fog instead of taking tower/obj";
  }
  if (a.manAdvantage <= -2) {
    return "Forcing a low-% fight to 'make something happen'";
  }
  if (a.fedEnemies[0] && a.battlePhase !== "idle") {
    return `Walking into ${a.fedEnemies[0].split("(")[0]} first`;
  }
  const youDeaths = Number((a.you.kda || "0/0/0").split("/")[1]) || 0;
  if (winProb >= 65 && youDeaths >= 2) {
    return "Throwing lead with ego plays";
  }
  if (a.you.gold >= 1600 && !a.noRecall) {
    return "Sitting on a full buy while walking the map";
  }
  return "Taking a fight without naming man advantage / HP / threat";
}

function thesis(a: MatchAnalytics, winProb: number, deep: DeepReasoning | null): string {
  const label = winLabel(winProb);
  const best = deep?.best.play || "play the highest-% board action";
  const gameState =
    label === "heavy_fav" || label === "favored"
      ? "You're favored — convert, don't invent chaos."
      : label === "heavy_behind" || label === "behind"
        ? "You're behind — stop the bleed, create a mini-game."
        : "Coin-flip game — only take fights you can explain.";
  return `${gameState} Right now: ${best}.`;
}

/**
 * Build the oracle (premium) brain snapshot.
 */
export function computeOracleBrain(
  a: MatchAnalytics,
  deep: DeepReasoning | null,
  personality: CoachPersonality = "friend"
): OracleBrain {
  const winProb = estimateWinProb(a);
  const label = winLabel(winProb);
  const sequence = buildSequence(a, deep);
  const mistake = nextMistake(a, winProb);
  const th = thesis(a, winProb, deep);

  // Confidence: how separated options are + how clear the board is
  let confidence = 55;
  if (deep) {
    const edge = deep.runnerUp ? deep.best.net - deep.runnerUp.net : deep.best.net;
    confidence += Math.min(25, Math.max(0, edge));
    confidence += deep.best.net > 60 ? 8 : 0;
  }
  if (a.battleHeat >= 50) confidence += 5;
  if (a.enemy.alive === 0) confidence += 12;
  if (a.you.hpPct != null && a.you.hpPct < 25) confidence += 10;
  confidence = clamp(confidence);

  // Silence discipline: don't speak low-confidence logistics on quiet boards
  let shouldSpeak = true;
  let silenceReason: string | null = null;
  const quiet =
    a.battlePhase === "idle" &&
    a.fightLight === "yellow" &&
    Math.abs(a.manAdvantage) < 2 &&
    a.enemy.dead === 0 &&
    a.team.dead < 2 &&
    (a.you.hpPct == null || a.you.hpPct >= 40) &&
    a.you.gold < 1200;
  if (quiet && confidence < 70 && deep?.best.id === "logistics") {
    shouldSpeak = false;
    silenceReason = "quiet board · low-edge logistics — silence is coaching";
  }
  if (a.you.isDead) shouldSpeak = true;

  const kit = getChampKit(a.you.champ);
  const step0 = sequence[0]?.action || deep?.speak || "Play the next high-% decision";
  let speak = deep?.speak || `${a.you.champ}: ${step0}`;
  // Death: attach short second beat when speak is tight (spawn plan = multi-step)
  if (a.you.isDead && sequence[1] && speak.split(/\s+/).length <= 16) {
    const s2 = sequence[1].action;
    const snippet = s2.length > 36 ? s2.slice(0, 34).replace(/\s+\S*$/, "") : s2;
    if (snippet && !speak.toLowerCase().includes(snippet.toLowerCase().slice(0, 10))) {
      speak = `${speak.replace(/[.!?]$/, "")} — then ${snippet.charAt(0).toLowerCase()}${snippet.slice(1)}.`;
    }
  }
  // Premium polish: attach second step lightly when confident and short
  if (
    !a.you.isDead &&
    shouldSpeak &&
    sequence[1] &&
    confidence >= 72 &&
    speak.split(/\s+/).length <= 14 &&
    a.battlePhase !== "idle"
  ) {
    const s2 = sequence[1].action;
    if (s2 && !speak.toLowerCase().includes(s2.toLowerCase().slice(0, 12))) {
      // keep separate — speak stays primary; sequence is for AI
    }
  }
  // Cap voice length after multi-step attach
  if (speak.split(/\s+/).length > 22) {
    speak = speak.split(/\s+/).slice(0, 20).join(" ").replace(/[,;:]$/, "") + ".";
  }
  if (personality === "hype") {
    speak = toNaturalTalk(speak, "hype");
  }

  const forAi = [
    "## Oracle brain (premium)",
    `WIN_PROB: ${winProb}% (${label}) — legal-board estimate only`,
    `CONFIDENCE: ${confidence}% · SPEAK: ${shouldSpeak ? "yes" : `no (${silenceReason})`}`,
    `THESIS: ${th}`,
    `NEXT_MISTAKE_TO_BLOCK: ${mistake}`,
    "SEQUENCE:",
    ...sequence.map((s) => `- [${s.t}] ${s.action} (${s.why})`),
    kit ? `CHAMP_IDENTITY: ${kit.identity}` : "",
    `SPEAK_SEED: ${speak}`,
    "INSTRUCTION: Use thesis + sequence for multi-step intelligence. Speak only the player-facing answer. If SPEAK=no, prefer silence or a one-line LO only if asked.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    winProb,
    winProbLabel: label,
    confidence,
    shouldSpeak,
    silenceReason,
    sequence,
    thesis: th,
    nextMistake: mistake,
    speak,
    forAi,
  };
}

export function formatOracleForAi(o: OracleBrain | null): string {
  if (!o) return "";
  return o.forAi;
}
