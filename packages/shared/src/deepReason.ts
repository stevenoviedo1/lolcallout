/**
 * Deep reasoner — multi-option EV brain.
 * Scores competing plays with second-order effects so the coach
 * isn't a single-rule bot. Feeds AI + local shotcalls.
 */

import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";
import { getChampKit } from "./champKnowledge.js";
import type { CoachPersonality } from "./personality.js";
import { toNaturalTalk } from "./personality.js";

export interface ReasonOption {
  id: string;
  play: string;
  /** Expected value for next 30–60s (0–100) */
  ev: number;
  /** Risk of throw / death / lead loss (0–100) */
  risk: number;
  /** Why this is good */
  pros: string[];
  /** Why this fails */
  cons: string[];
  /** Second-order: what this enables next */
  unlocks: string;
  /** Net = ev - risk*0.55 */
  net: number;
}

export interface DeepReasoning {
  question: string;
  options: ReasonOption[];
  best: ReasonOption;
  runnerUp: ReasonOption | null;
  /** One-line why best beats runner-up */
  decision: string;
  /** Counterfactual: if board flips in 15s */
  ifFlips: string;
  /** Speakable answer (friend = tight, bro = natural) */
  speak: string;
  /** Dense AI block */
  forAi: string;
}

function netOf(ev: number, risk: number): number {
  return Math.round(ev - risk * 0.55);
}

function add(
  list: ReasonOption[],
  id: string,
  play: string,
  ev: number,
  risk: number,
  pros: string[],
  cons: string[],
  unlocks: string
) {
  list.push({
    id,
    play,
    ev: Math.max(0, Math.min(100, ev)),
    risk: Math.max(0, Math.min(100, risk)),
    pros,
    cons,
    unlocks,
    net: netOf(ev, risk),
  });
}

/**
 * Deep multi-option reasoning for the current board.
 */
export function deepReasonBoard(
  a: MatchAnalytics,
  mode: ModeProfile,
  personality: CoachPersonality = "friend"
): DeepReasoning | null {
  if (!a || a.you.isDead) {
    return deepReasonDeath(a, mode, personality);
  }

  const c = a.you.champ;
  const hp = a.you.hpPct != null ? Math.round(a.you.hpPct) : 70;
  const g = a.you.gold;
  const man = a.manAdvantage;
  const dead = a.enemyDeadNames.slice(0, 2);
  const deadStr = dead.join(" and ") || null;
  const threat = a.battleThreat || a.fedEnemies[0]?.split("(")[0] || null;
  const focus = a.battleFocus || threat;
  const role = a.you.roleHint;
  const noRecall = mode.noRecall || a.noRecall;
  const kit = getChampKit(c);
  const resp = a.enemyRespawnEstSec;
  const opts: ReasonOption[] = [];

  // ── Always generate competing options ──

  const ace = a.enemy.alive === 0;
  const nearAce = a.enemy.alive <= 1 && man >= 2;

  // A: Force / commit fight (bad on full ace — nothing to commit)
  if (!ace) {
    let ev = 40 + man * 12;
    let risk = 45 - man * 8;
    if (hp < 35) {
      ev -= 25;
      risk += 30;
    }
    if (a.battlePhase === "winning" || a.fightLight === "green") ev += 20;
    if (a.battlePhase === "losing") {
      ev -= 20;
      risk += 25;
    }
    if (threat && a.enemiesUltUnlockedAlive.includes(threat) && hp < 50) risk += 15;
    if (nearAce) ev -= 10; // prefer convert when almost done
    add(
      opts,
      "commit_fight",
      focus
        ? `Commit fight — pressure ${focus}`
        : `Commit the fight in front of you`,
      ev,
      risk,
      [
        man > 0 ? `Man advantage ${man >= 0 ? "+" : ""}${man}` : "Even numbers if HP favors",
        focus ? `Clear focus: ${focus}` : "Ends the skirmish",
      ],
      [
        hp < 40 ? `Your HP ${hp}% is a liability` : "Can throw if they flip",
        threat ? `${threat} can clean up` : "Flash/summs cost",
      ],
      "If you win: plates/obj window opens"
    );
  }

  // B: Disengage / reset
  {
    let ev = 35 + (hp < 40 ? 30 : 0) + (g >= 1200 && !noRecall ? 15 : 0);
    let risk = 20;
    if (man >= 2 && hp > 50) {
      ev -= 25; // disengage throws free convert
      risk += 10;
    }
    if (a.battlePhase === "losing" || man <= -2) ev += 25;
    add(
      opts,
      "disengage",
      noRecall
        ? `Disengage — max range, live for next wave`
        : g >= 800
          ? `Disengage and base with ${g}g`
          : `Disengage — give space, save flash`,
      ev,
      risk,
      [
        hp < 40 ? `Saves you at ${hp}%` : "Preserves summs",
        g >= 1000 && !noRecall ? `Banks ${g}g safely` : "Stops a low-% death",
      ],
      [
        man >= 2 ? "Gives up a free convert window" : "Cedes map tempo briefly",
        "Ally may feel abandoned if you leave a winnable",
      ],
      "Stable HP/gold → better next fight"
    );
  }

  // C: Convert (plates/obj) — ace / numbers / green
  if (ace || man >= 1 || dead.length >= 1 || a.fightLight === "green") {
    let ev = 55 + man * 10 + dead.length * 8;
    let risk = 25;
    if (ace) {
      ev = 95;
      risk = 10;
    } else if (a.battlePhase === "teamfight" && a.battleHeat >= 70 && man < 2) {
      ev -= 15;
      risk += 15;
    }
    if (role === "JUNGLE") ev += 10;
    add(
      opts,
      "convert",
      ace
        ? g >= 1300 && !noRecall
          ? `ACE convert — tower/inhib then base ${g}g`
          : `ACE convert — baron/inhib/plates NOW`
        : deadStr
          ? role === "JUNGLE"
            ? `Convert — ${deadStr} down, YOU start obj`
            : `Convert — ${deadStr} down, plates/obj not chase`
          : `Convert lead — tower/obj over kills`,
      ev,
      risk,
      [
        ace ? "Full ace — free map" : deadStr ? `${deadStr} dead ${resp != null ? `~${resp}s` : ""}` : "Map is free",
        "Highest LP-per-second when numbers up",
      ],
      [
        "Chasing one more kill is the classic throw",
        !ace && threat && man < 2 ? `${threat} may still be up` : "Obj can be bait if late",
      ],
      "Towers/obj → real win condition pressure"
    );
  }

  // D: Farm / wave / logistics
  {
    let ev = 40 + (a.phase === "early" ? 15 : 0);
    let risk = 15;
    if (g >= 1400 && !noRecall) ev += 20;
    if (man <= -2) ev += 15;
    if (a.battleHeat >= 50) {
      ev -= 20;
      risk += 10;
    }
    add(
      opts,
      "logistics",
      noRecall
        ? `Poke and hold — shop on death if gold high`
        : g >= 1100
          ? `Crash wave then base ${g}g`
          : `Own the nearest wave, don't force`,
      ev,
      risk,
      ["High consistency", g >= 1100 ? "Item spike incoming" : "Builds lead safely"],
      ["Slow if enemy is free-hitting towers", "Can be too passive when convert is free"],
      "Item/level spike → better fights later"
    );
  }

  // E: Peel / protect (support or when ally fed)
  if (role === "SUPPORT" || (a.fedAllies[0] && a.battlePhase !== "idle")) {
    const ally = a.fedAllies[0]?.split("(")[0] || "carry";
    add(
      opts,
      "peel",
      threat
        ? `Peel for ${ally} — track ${threat}`
        : `Peel and zone for ${ally}`,
      50 + (role === "SUPPORT" ? 15 : 0) + (a.battlePhase === "teamfight" ? 15 : 0),
      30,
      [`Keeps ${ally} alive = win con`, threat ? `Respects ${threat}` : "Teamfight discipline"],
      ["You deal less damage", "If ally is already dead, wasted"],
      "Carry lives → you win the fight"
    );
  }

  opts.sort((x, y) => y.net - x.net);
  const best = opts[0];
  const runnerUp = opts[1] || null;

  const decision = runnerUp
    ? `Pick ${best.id} (net ${best.net}) over ${runnerUp.id} (net ${runnerUp.net}): ${best.pros[0]}. ${runnerUp.cons[0] || "Higher risk on the alternative"}.`
    : `Pick ${best.id} (net ${best.net}): ${best.pros[0]}.`;

  const ifFlips =
    man >= 1
      ? `If they get a pick back in 15s: stop converting, group, no side alone.`
      : hp < 40
        ? `If you get a free kill while low: still reset — don't greed the double.`
        : `If two allies die: hard red light, catch wave only.`;

  const speakRaw = buildSpeak(best, a, personality, {
    deadStr,
    focus,
    threat,
    hp,
    g,
    noRecall,
    kitOpener: kit?.combos[0]?.split("→")[0]?.trim(),
  });

  const speak =
    personality === "hype" ? toNaturalTalk(speakRaw, "hype") : speakRaw;

  const forAi = [
    "## Deep reasoning (multi-option EV — think then speak)",
    `QUESTION: What is the highest-EV play for ${c} (${role}) right now?`,
    `BOARD: ${a.team.alive}v${a.enemy.alive} man=${man} hp=${hp}% gold=${g} phase=${a.battlePhase} light=${a.fightLight}`,
    "",
    "OPTIONS (sorted by net = ev - 0.55*risk):",
    ...opts.slice(0, 4).map(
      (o, i) =>
        `${i + 1}. [${o.net}] ${o.id}: ${o.play}\n   EV=${o.ev} risk=${o.risk}\n   + ${o.pros.join("; ")}\n   - ${o.cons.join("; ")}\n   → unlocks: ${o.unlocks}`
    ),
    "",
    `BEST: ${best.id} — ${best.play}`,
    `DECISION: ${decision}`,
    `IF_BOARD_FLIPS: ${ifFlips}`,
    `SPEAK_SEED: ${speak}`,
    "INSTRUCTION: Agree with BEST unless analytics clearly contradict. Speak in the active personality. Do not list options to the player — only the answer.",
  ].join("\n");

  return {
    question: `Best play for ${c} now?`,
    options: opts,
    best,
    runnerUp,
    decision,
    ifFlips,
    speak,
    forAi,
  };
}

function deepReasonDeath(
  a: MatchAnalytics | null,
  mode: ModeProfile,
  personality: CoachPersonality
): DeepReasoning | null {
  if (!a) return null;
  const c = a.you.champ;
  const killer = a.yourLastKiller;
  const g = a.you.gold;
  const winning = a.pressure === "winning" || a.killLead >= 3;
  const losing = a.pressure === "losing" || a.killLead <= -3;
  const opts: ReasonOption[] = [];

  // A: Safe re-entry (default high-%)
  add(
    opts,
    "spawn_safe",
    killer
      ? `Next spawn respect ${killer} — different entry`
      : `Next spawn wave first, wait for two allies`,
    72,
    14,
    ["Stops repeat death", killer ? `Accounts for ${killer}` : "Numbers first"],
    ["Slower tempo if game is ending"],
    "Stable re-entry + habit break"
  );

  // B: Buy then rejoin (when gold sits)
  if (g >= 900 && !mode.noRecall && !a.noRecall) {
    add(
      opts,
      "spawn_buy",
      `Spawn buy ${g}g then take safe wave — no force`,
      78,
      12,
      ["Item spike on spawn", "Uses pocket gold"],
      ["If team is ending, buy may cost a second"],
      "Spike then rejoin with numbers"
    );
  }

  // C: Group end (only when winning hard / near end)
  if (winning && a.minute >= 20) {
    add(
      opts,
      "spawn_group_end",
      `Spawn group mid — convert the lead, no solo side`,
      68,
      22,
      ["Closes game together", "Avoids isolated shutdown"],
      ["Ignores side wave if not careful"],
      "End sequence"
    );
  }

  // D: Defensive farm (when behind)
  if (losing) {
    add(
      opts,
      "spawn_stabilize",
      `Spawn farm safe side — mosquito only, no equalizer`,
      74,
      16,
      ["Stops the bleed", "Gold catches without int"],
      ["Gives map if enemies free-hit"],
      "Stabilize then look for one pick"
    );
  }

  // E: Tilt force (intentionally bad — so EV shows why not)
  add(
    opts,
    "spawn_force",
    `Re-engage immediately to force`,
    22,
    78,
    ["Maybe catches someone low"],
    ["Classic tilt double", "Usually no summs"],
    "Usually a throw"
  );

  opts.sort((x, y) => y.net - x.net);
  const best = opts[0];
  const runnerUp = opts[1] || null;

  let speakRaw: string;
  if (best.id === "spawn_buy") {
    speakRaw = `${c}: spawn buy ${g}g — different path${killer ? `, respect ${killer}` : ""}, wave first.`;
  } else if (best.id === "spawn_group_end") {
    speakRaw = `${c}: spawn group mid and end — no solo side heroics.`;
  } else if (best.id === "spawn_stabilize") {
    speakRaw = `${c}: spawn farm safe — no equalizer all-in${killer ? `; respect ${killer}` : ""}.`;
  } else if (killer) {
    speakRaw = `${c}: next spawn respect ${killer} — different entry, wait for two.`;
  } else {
    speakRaw = `${c}: next spawn take the wave and wait for two allies.`;
  }
  const speak = personality === "hype" ? toNaturalTalk(speakRaw, "hype") : speakRaw;

  return {
    question: "Best next-spawn plan after death?",
    options: opts,
    best,
    runnerUp,
    decision: `Prefer ${best.id} over force. ${killer ? `Killer was ${killer}.` : ""} Edge vs #2: ${runnerUp ? best.net - runnerUp.net : best.net}.`,
    ifFlips: winning
      ? "If team is ending nexus, group spawn and run it down together."
      : "If team collapses, join with numbers only — no 1vX.",
    speak,
    forAi: [
      "## Deep reasoning (death)",
      `BEST: ${best.play} (net=${best.net})`,
      runnerUp ? `RUNNER_UP: ${runnerUp.play} (net=${runnerUp.net})` : "",
      `KILLER: ${killer || "unknown"}`,
      `GOLD: ${g}`,
      `SPEAK_SEED: ${speak}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function buildSpeak(
  best: ReasonOption,
  a: MatchAnalytics,
  _personality: CoachPersonality,
  ctx: {
    deadStr: string | null;
    focus: string | null;
    threat: string | null;
    hp: number;
    g: number;
    noRecall: boolean;
    kitOpener?: string;
  }
): string {
  const c = a.you.champ;
  switch (best.id) {
    case "disengage":
      if (ctx.noRecall) {
        return `${c}: ${ctx.hp}% — max range only${ctx.g >= 1000 ? `, shop on death with ${ctx.g}g` : ""}. Don't int.`;
      }
      return ctx.g >= 800
        ? `${c}: ${ctx.hp}% and ${ctx.g}g — leave and base. That gold is a shutdown if you stay.`
        : `${c}: ${ctx.hp}% — leave now. This fight isn't yours.`;
    case "convert":
      if (a.enemy.alive === 0) {
        return !ctx.noRecall && ctx.g >= 1300
          ? `${c}: ACE — take a tower or inhib, then base ${ctx.g}g. No fog chase.`
          : `${c}: ACE — baron, inhib, or plates now. Don't chase for style.`;
      }
      if (a.you.roleHint === "JUNGLE" && ctx.deadStr) {
        return `${c}: ${ctx.deadStr} down — you start the objective, allies crash waves.`;
      }
      return ctx.deadStr
        ? `${c}: ${ctx.deadStr} down — plates or obj now, not a fog chase.`
        : `${c}: map is free — take tower or obj, not another 50/50.`;
    case "commit_fight":
      if (ctx.kitOpener && ctx.focus) {
        return `${c}: look ${ctx.kitOpener} on ${ctx.focus} — leave if they turn.`;
      }
      return ctx.focus
        ? `${c}: commit on ${ctx.focus} — secondary engage, not first-in.`
        : `${c}: numbers are fine — take the fight with your team, don't solo.`;
    case "peel":
      return ctx.threat
        ? `${c}: peel your carry — ${ctx.threat} is the delete threat.`
        : `${c}: peel and zone. You're the wall.`;
    case "logistics":
    default:
      if (!ctx.noRecall && ctx.g >= 1100) {
        return `${c}: ${ctx.g}g — crash one wave then base for the spike.`;
      }
      return `${c}: own the next wave. Don't force a low-% look.`;
  }
}

export function formatDeepReasonForAi(d: DeepReasoning | null): string {
  if (!d) return "";
  return d.forAi;
}
