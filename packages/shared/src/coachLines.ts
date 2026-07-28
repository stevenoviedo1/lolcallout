/**
 * Situational coach lines — every lane/game is different.
 * Rank multiple legal options from the live board; speak only the best one.
 * Never one fixed script ("always base", "always hold").
 *
 * Method: BBC consistency + fight intention, but CHOICE-driven.
 */

import type { MatchAnalytics } from "./analytics.js";
import type { ModeProfile } from "./modes.js";
import { getChampKit } from "./champKnowledge.js";
import { applyBrainToOptions, computeCoachBrain } from "./coachBrain.js";

const BANNED_FRAGMENTS = [
  "play safe",
  "one clear job",
  "one job only",
  "farm safe",
  "don't chase fog",
  "dont chase fog",
  "convert the kill",
  "convert —",
  "convert into",
  "numbers down",
  "numbers up",
  "look for a short",
  "own your wave",
  "trade with minion",
  "group for the next",
  "stay with the team",
  "play the board",
  "play the next wave",
  "next 20 seconds",
  "change job now",
  "don't force a bad",
  "dont force a bad",
  "no ego",
  "no fog chase",
  "shove then group",
  "wait for a real engage",
];

export function isObviousLine(line: string): boolean {
  const n = line.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n || n.length < 10) return true;
  if (BANNED_FRAGMENTS.some((b) => n.includes(b))) return true;
  const hasSpecific =
    /\d/.test(n) || /%/.test(n) || /\bgold\b|\bg\b/.test(n) || /:/.test(line);
  if (!hasSpecific && n.split(" ").length <= 6) return true;
  return false;
}

export function modeStubFromAnalytics(a: MatchAnalytics): ModeProfile {
  return {
    family: a.aram ? "ARAM" : a.arena ? "ARENA" : "SR_UNKNOWN",
    gameMode: a.mode,
    label: a.aram ? "ARAM" : a.arena ? "Arena" : "Summoner's Rift",
    rules: [],
    verbs: [],
    noRecall: a.noRecall,
    hasWaves: !a.arena,
    hasObjectives: !a.aram && !a.arena,
    hasJungle: !a.aram && !a.arena,
  };
}

export type PlayOption = {
  /** Short id for debugging */
  id: string;
  /** Speakable line */
  line: string;
  /** Higher = better for THIS board */
  score: number;
};

function threatName(a: MatchAnalytics): string | null {
  const f = a.fedEnemies[0];
  if (!f) return null;
  return f.split("(")[0].trim() || null;
}

function allyDown(a: MatchAnalytics): string {
  if (a.allyDeadNames.length) return a.allyDeadNames.slice(0, 2).join(" and ");
  return `${a.team.dead} allies`;
}

function enemyDown(a: MatchAnalytics): string {
  if (a.enemyDeadNames.length) return a.enemyDeadNames.slice(0, 2).join(" and ");
  return `${a.enemy.dead} enemies`;
}

function estimateRespawn(a: MatchAnalytics): number {
  return Math.min(40, 8 + a.you.level * 2);
}

function yourDeaths(a: MatchAnalytics): number {
  return Number((a.you.kda || "0/0/0").split("/")[1]) || 0;
}

/**
 * Pick best option; optionally re-rank with coach BRAIN (tempo/structure) — additive.
 */
function pickBest(options: PlayOption[], a?: MatchAnalytics): string {
  let viable = options.filter((o) => o.score > 0 && o.line.trim());
  if (!viable.length) return options[0]?.line || "Play the next high-% decision.";
  if (a) {
    try {
      viable = applyBrainToOptions(viable, computeCoachBrain(a));
    } catch {
      /* brain is additive — never break speak path */
    }
  }
  viable.sort((x, y) => y.score - x.score);
  return viable[0].line;
}

/** Role-specific option weight helpers */
function roleBias(role: MatchAnalytics["you"]["roleHint"]) {
  return {
    isSup: role === "SUPPORT",
    isJg: role === "JUNGLE",
    isCarry: role === "CARRY",
    isFlex: role === "FLEX",
  };
}

/**
 * Generate ranked options for a moment, then pick the best for THIS game state.
 */
export function craftCoachLine(
  a: MatchAnalytics,
  kind: string,
  mode: ModeProfile,
  extra?: string
): string {
  const c = a.you.champ;
  const kit = getChampKit(c);
  const threat = threatName(a);
  const gold = a.you.gold;
  const hp = a.you.hpPct != null ? Math.round(a.you.hpPct) : null;
  const role = a.you.roleHint;
  const { isSup, isJg, isCarry } = roleBias(role);
  const manAdv = a.team.alive - a.enemy.alive;
  const resp = estimateRespawn(a);
  const opts: PlayOption[] = [];

  const add = (id: string, score: number, line: string) => {
    if (score <= 0 || !line) return;
    opts.push({ id, score, line });
  };

  // --- Universal hard filters (still compete as options, not always #1) ---
  if (kind === "death" || a.you.isDead) {
    return craftDeathLine(a, mode, extra);
  }

  // LOW HP options: base vs hold vs max-range — depends on gold, mode, role, numbers
  if (kind === "low_hp" || (hp != null && hp < 28 && !a.you.isDead)) {
    if (mode.noRecall) {
      add("aram_max_range", 90, `${c}: ${hp}% — max range only; wait for a reset fight.`);
      add("aram_stack", 70 + (manAdv < 0 ? 15 : 0), `${c}: ${hp}% — stack with two allies; don't poke alone.`);
    } else {
      // Option A: base with gold
      add(
        "base_gold",
        gold >= 700 ? 95 + Math.min(10, gold / 200) : 40,
        `${c}: ${hp}% + ${gold}g — best option is base now, not another fight.`
      );
      // Option B: give wave no gold
      add(
        "give_wave_base",
        gold < 700 ? 88 : 55,
        `${c}: ${hp}% — give this wave, base; fighting here is low-%.`
      );
      // Option C: play for peel if support and team fighting numbers
      if (isSup && manAdv >= 0 && a.enemy.dead === 0) {
        add(
          "sup_peel_edge",
          50,
          `${c}: ${hp}% support — peel one spell then leave; don't die for the trade.`
        );
      }
      // Option D: jg reset to camps if behind but not free kill gold
      if (isJg && gold < 900 && manAdv < 0) {
        add(
          "jg_reset_clear",
          72,
          `${c}: ${hp}% jg — clear nearest camps, skip low-% river; reset after.`
        );
      }
    }
    return pickBest(opts, a);
  }

  // GOLD SIT — base is often right, but not if free plates / man adv / obj
  if (
    (kind === "base" || kind === "gold_sit" || a.riskFlags.includes("gold_in_pocket")) &&
    !mode.noRecall &&
    gold >= 900
  ) {
    const itemHint = gold >= 1600 ? "full item / major" : "component";
    add(
      "crash_base",
      70 + (manAdv <= 0 ? 20 : 0) + (hp != null && hp < 50 ? 15 : 0),
      `${c}: ${gold}g for ${itemHint} — best is crash one wave then base.`
    );
    // Free plates more valuable than early base
    if (a.enemy.dead >= 2) {
      add(
        "plates_then_base",
        95,
        `${c}: ${gold}g but ${enemyDown(a)} down ~${resp}s — plates first, then base.`
      );
    }
    if (a.enemy.dead >= 1 && a.minute >= 8 && a.objectiveWindows[0]) {
      add(
        "obj_then_base",
        92,
        `${c}: ${gold}g — start obj with numbers, shop after; don't leave free timer.`
      );
    }
    if (isSup && a.minute < 14) {
      add(
        "sup_ward_base",
        75,
        `${c}: ${gold}g support — deep river ward on crash, then base for control wards.`
      );
    }
    if (isJg && manAdv > 0) {
      add(
        "jg_invade_or_base",
        68,
        `${c}: ${gold}g jg — one high-% invade or scuttle, then base; don't sit full.`
      );
    }
    if (opts.length) return pickBest(opts, a);
  }

  // NUMBERS swing — role changes the convert
  if (kind === "numbers" || a.team.dead >= 2 || a.enemy.dead >= 2) {
    if (a.team.dead >= 2) {
      add(
        "red_hold",
        85,
        `${c}: red light — ${allyDown(a)} dead ~${resp}s; hold tower, wait high-%.`
      );
      if (isJg) {
        add(
          "jg_clear_wait",
          92,
          `${c}: allies down — clear opposite camps; skip river contest until spawn.`
        );
      }
      if (isSup) {
        add(
          "sup_vision_hold",
          88,
          `${c}: allies down — drop near vision only; no deep ward grief.`
        );
      }
      if (isCarry && a.phase !== "early") {
        add(
          "carry_side_safe",
          80,
          `${c}: allies down — catch nearest safe wave; don't mid 1v2.`
        );
      }
      return pickBest(opts, a);
    }
    if (a.enemy.dead >= 2) {
      const dead = enemyDown(a);
      if (mode.noRecall) {
        add("aram_plates", 90, `${c}: green light — ${dead} down; shove plates, no fountain.`);
        return pickBest(opts, a);
      }
      // Competing converts
      add(
        "plates",
        80 + (a.phase === "early" ? 15 : 5),
        `${c}: ${dead} down ~${resp}s — closest plates now (best free gold).`
      );
      add(
        "obj",
        75 + (a.minute >= 8 ? 20 : 0) + (a.objectiveWindows[0] ? 10 : 0),
        `${c}: ${dead} down ~${resp}s — start the objective before they spawn.`
      );
      if (isJg) {
        add(
          "jg_obj_setup",
          95,
          `${c}: jg — ${dead} down; you set the obj, allies crash waves into it.`
        );
      }
      if (isSup) {
        add(
          "sup_vision_obj",
          88,
          `${c}: support — ${dead} down; ward pit/river then help take obj or plates.`
        );
      }
      if (isCarry && a.phase === "late") {
        add(
          "carry_group_obj",
          90,
          `${c}: ${dead} down — group for the obj; your DPS is the convert.`
        );
      }
      if (gold >= 1200 && !mode.noRecall && a.enemy.dead < 3) {
        add(
          "base_after_shove",
          70,
          `${c}: ${dead} down + ${gold}g — one shove, then base if obj isn't free.`
        );
      }
      return pickBest(opts, a);
    }
    if (manAdv > 0) {
      add(
        "man_fight",
        70 + manAdv * 8,
        `${c}: ${a.team.alive}v${a.enemy.alive} — green light short fight or shove.`
      );
      if (isJg) add("jg_look", 78, `${c}: man adv — look for high-% skirmish on the strong side.`);
      if (isSup) add("sup_enable", 76, `${c}: man adv — set vision and enable the engage, don't solo.`);
    } else if (manAdv < 0) {
      add(
        "man_hold",
        80,
        `${c}: ${a.team.alive}v${a.enemy.alive} — red light; inaction is the right call.`
      );
      if (isJg) add("jg_farm", 85, `${c}: deficit — farm camps, no low-% force; wait for spawn.`);
    } else {
      add(
        "even_board",
        60,
        `${c}: ${a.team.alive}v${a.enemy.alive} even — only if HP and wave favor you.`
      );
    }
    if (opts.length) return pickBest(opts, a);
  }

  // KILL convert — not always base, not always plate
  if (kind === "kill") {
    if (a.enemy.dead >= 2) {
      return craftCoachLine(a, "numbers", mode, extra);
    }
    if (!mode.noRecall && gold >= 1300 && (hp == null || hp < 60 || manAdv <= 0)) {
      add("kill_base", 90, `${c}: kill + ${gold}g — crash then base; best option if no free plates.`);
    }
    if (a.phase === "early") {
      add("kill_plates", 85, `${c}: early kill timer — plates or deep ward before they spawn.`);
      if (isJg) add("jg_invade", 88, `${c}: jg after kill — invade their camps or set scuttle, not mid fog.`);
      if (isSup) add("sup_move", 87, `${c}: support after pick — crash bot, move mid; track ADC.`);
    }
    if (isCarry && a.phase !== "early") {
      add("carry_reset", gold >= 1000 ? 86 : 70, `${c}: ADC kill — reset for spike if ${gold}g+, else shove mid.`);
    }
    add(
      "kill_move",
      65,
      `${c}: kill timer — shove two waves then move first; skip low-% side chase.`
    );
    if (threat && a.pressure === "losing") {
      add(
        "kill_respect",
        75,
        `${c}: got the kill but respect ${threat} — no ego follow-up into them.`
      );
    }
    return pickBest(opts, a);
  }

  // OBJECTIVE
  if (kind === "objective") {
    if (mode.noRecall) {
      return `${c}: tower pressure — group mid; plates if their engage is down.`;
    }
    if (a.enemy.dead >= 1 || manAdv > 0) {
      add("start_obj", 90, `${c}: numbers for obj — start it now; best use of the timer.`);
      add("cross_map", 70, `${c}: if obj is contested bad, take free cross-map plates instead.`);
    } else {
      add("setup_wait", 85, `${c}: obj up but even numbers — shove first, arrive together; no solo pit.`);
      add("trade", 75, `${c}: if they take obj uncontested, trade opposite tower — don't int the pit.`);
    }
    if (threat) {
      add("track_threat", 80, `${c}: obj — track ${threat} before you walk pit; vision first.`);
    }
    if (isJg) add("jg_smite", 88, `${c}: jg — you call start/no-start; only if smite + man advantage.`);
    if (isSup) add("sup_ward_pit", 86, `${c}: support — ward pit/river, then stack for the call.`);
    return pickBest(opts, a);
  }

  // PRESSURE / WINCON — different answers per role
  if (kind === "pressure_flip" || kind === "wincon_change") {
    if (a.pressure === "losing" || a.winCon === "stabilize") {
      add(
        "stabilize_farm",
        70,
        `${c}: −${Math.abs(a.killLead)} — stabilize: farm, only high-% holds; no hero plays.`
      );
      add(
        "mosquito",
        75 + (isCarry || role === "FLEX" ? 10 : 0),
        `${c}: behind — mosquito side pressure; make them sweat, don't roll over.`
      );
      if (isJg) {
        add(
          "jg_behind",
          90,
          `${c}: jg behind — farm camps, only high-% ganks; you don't need to force every river.`
        );
      }
      if (isSup) {
        add(
          "sup_behind",
          88,
          `${c}: support behind — peel and vision; enable carry, skip random engages.`
        );
      }
      if (threat) {
        add(
          "respect_fed",
          82,
          `${c}: respect ${threat} — only fight with CC/numbers; subtract first-in.`
        );
      }
      return pickBest(opts, a);
    }
    if (a.pressure === "winning" || a.winCon === "snowball" || a.winCon === "siege") {
      add(
        "towers",
        85,
        `${c}: +${a.killLead} — best option is towers/obj, not one more low-% kill.`
      );
      if (isJg) add("jg_vision_obj", 90, `${c}: jg ahead — set vision into obj; you create the map.`);
      if (isSup) add("sup_siege", 86, `${c}: support ahead — siege wards and peel; no side quest.`);
      if (isCarry) add("carry_dps", 88, `${c}: ahead — take DPS angles on towers; stay max range.`);
      return pickBest(opts, a);
    }
    // even / pick / scale / teamfight
    if (a.winCon === "pick") {
      add("pick", 80, `${c}: pick game — ward choke, wait for overstep; skip blind 5v5.`);
    }
    if (a.winCon === "scale") {
      add("scale", 78, `${c}: scale — ${gold}g to item, then high-% fights; not AFK.`);
    }
    if (a.winCon === "protect_carry") {
      add(
        "peel",
        85,
        threat
          ? `${c}: peel job — bodyblock ${threat}; best option is protect, not solo.`
          : `${c}: peel job — stack on carry; red light for solo walks.`
      );
    }
    if (a.winCon === "teamfight" || a.winCon === "close_game") {
      add(
        "group",
        80,
        `${c}: next fight @ ${a.clockLabel} — know your role; green light only with man adv.`
      );
    }
    add(
      "even_default",
      55,
      `${c}: even @ ${a.clockLabel} — crash then move first with allies.`
    );
    return pickBest(opts, a);
  }

  if (kind === "fed_enemy_new" || kind === "shutdown") {
    if (threat) {
      if (isSup) {
        return `${c}: ${threat} fed — your best option is peel and vision, not matching them 1v1.`;
      }
      if (isJg) {
        return `${c}: ${threat} fed — track them, gank opposite; don't duel their strong side alone.`;
      }
      if (isCarry) {
        return a.pressure === "winning"
          ? `${c}: ${threat} is the throw condition — max range, no side alone.`
          : `${c}: ${threat} fed — only fight with peel/numbers; secondary, not first.`;
      }
      return `${c}: ${threat} fed — only with CC or numbers; secondary engage.`;
    }
    return `${c}: protect the lead — no facecheck; one high-% play at a time.`;
  }

  if (kind === "level_up") {
    if (a.you.level === 6) {
      if (isJg) return `${c}: 6 up — first high-% gank or obj setup; not a random full clear skip.`;
      if (isSup) return `${c}: 6 up — look for engage/roam when wave is crashed; track ADC.`;
      if (kit)
        return `${c}: 6 up — ${kit.combos[0] || "your all-in"} when they waste a spell.`;
      return `${c}: level 6 — force only with ult and an exit.`;
    }
    if (a.you.level === 11 || a.you.level === 16) {
      return `${c}: ult rank — fight window if numbers ok; not a solo side walk.`;
    }
    return `${c}: level ${a.you.level} — short trade only if wave and HP favor you.`;
  }

  if (kind === "death_pattern") {
    const dom = extra || "repeat deaths";
    return `${c}: ${dom} is your low-% loop — subtract it this game; keep the rest.`;
  }

  if (kind === "match_start") {
    return craftMatchStart(a, mode);
  }

  // TEMPO / DEFAULT — full multi-option decision for live board
  return pickBest(buildTempoOptions(a, mode), a);
}

function craftDeathLine(a: MatchAnalytics, mode: ModeProfile, extra?: string): string {
  const c = a.you.champ;
  const kit = getChampKit(c);
  const threat = threatName(a);
  const gold = a.you.gold;
  const role = a.you.roleHint;
  const opts: PlayOption[] = [];
  const add = (id: string, score: number, line: string) => {
    if (score > 0) opts.push({ id, score, line });
  };

  if (a.riskFlags.includes("gold_in_pocket") || gold >= 1200) {
    add(
      "gold_death",
      95,
      mode.noRecall
        ? `${c}: ${gold}g into a low-% death — shop on spawn first.`
        : `${c}: ${gold}g into death — best fix is base before the next fight.`
    );
  }
  if (a.team.dead >= 1 || a.team.alive < a.enemy.alive) {
    add(
      "no_man",
      90,
      `${c}: low-% into no man advantage — next spawn wave first, wait for ${allyDown(a)}.`
    );
  }
  if (threat && yourDeaths(a) >= 2) {
    add(
      "threat",
      88,
      role === "SUPPORT"
        ? `${c}: ${threat} deletes you — peel from behind, never first in.`
        : `${c}: ${threat} deletes you first-in — secondary engage only next fight.`
    );
  }
  if (a.phase === "early" && yourDeaths(a) >= 2) {
    add(
      "early",
      86,
      role === "JUNGLE"
        ? `${c}: early deaths — full clear first; only high-% ganks after.`
        : `${c}: early deaths bleed XP — farm tower until even levels.`
    );
  }
  if (extra) {
    add("pattern", 92, `${c}: pattern ${extra} was low-% — subtract that one habit next spawn.`);
  }
  if (kit?.watchFor[0]) {
    add("kit", 70, `${c}: next fight respect ${kit.watchFor[0]} — change the entry.`);
  }
  add(
    "default_spawn",
    50,
    mode.noRecall
      ? `${c}: next spawn — shop if gold, two allies, then poke.`
      : `${c}: next spawn — buy if needed, nearest wave; rejoin only with info.`
  );
  return pickBest(opts, a);
}

function craftMatchStart(a: MatchAnalytics, mode: ModeProfile): string {
  const c = a.you.champ;
  const kit = getChampKit(c);
  const t = threatName(a);
  const role = a.you.roleHint;

  if (mode.noRecall) {
    return t
      ? `${c}: ARAM — poke first, respect ${t}; only fight with allies.`
      : `${c}: ARAM — poke first, shop on death; no side walks alone.`;
  }
  if (role === "SUPPORT") {
    return t
      ? `${c}: support — crash bot, track ${t}; roam only after crash.`
      : `${c}: support — crash bot then move; your best option is map, not idle bot.`;
  }
  if (role === "JUNGLE") {
    return `${c}: jungle — clear to first scuttle; gank only high-% shoved lanes.`;
  }
  if (role === "CARRY" && kit) {
    return t
      ? `${c}: ${kit.name} — ${kit.early} Respect ${t}; wave before river.`
      : `${c}: ${kit.name} — ${kit.early} LO: only high-% trades.`;
  }
  if (kit) {
    return t
      ? `${c}: ${kit.name} identity — ${kit.playFor[0] || "your job"}. Respect ${t}; wave first.`
      : `${c}: ${kit.name} identity — ${kit.playFor[0] || "wave first"}. LO: high-% only.`;
  }
  return t
    ? `${c}: first levels — wave first, respect ${t}; option depends on their jg path.`
    : `${c}: first levels — wave first; pick fights only with level or numbers.`;
}

/** Ranked options for generic live tempo — the core "best option" engine */
export function buildTempoOptions(a: MatchAnalytics, mode: ModeProfile): PlayOption[] {
  const c = a.you.champ;
  const threat = threatName(a);
  const gold = a.you.gold;
  const hp = a.you.hpPct != null ? Math.round(a.you.hpPct) : null;
  const role = a.you.roleHint;
  const { isSup, isJg, isCarry } = roleBias(role);
  const manAdv = a.team.alive - a.enemy.alive;
  const opts: PlayOption[] = [];
  const add = (id: string, score: number, line: string) => {
    if (score > 0) opts.push({ id, score, line });
  };

  if (a.you.isDead) {
    add("dead", 100, craftDeathLine(a, mode));
    return opts;
  }

  // Critical branches compete
  if (hp != null && hp < 28) {
    return [
      {
        id: "hp",
        score: 100,
        line: craftCoachLine(a, "low_hp", mode),
      },
    ];
  }
  if (a.team.dead >= 2 || a.enemy.dead >= 2) {
    return [
      {
        id: "num",
        score: 100,
        line: craftCoachLine(a, "numbers", mode),
      },
    ];
  }

  // Gold sit vs free board
  if (!mode.noRecall && gold >= 1300) {
    add(
      "base",
      70 + (manAdv <= 0 ? 15 : 0) + (hp != null && hp < 55 ? 10 : 0),
      `${c}: ${gold}g — crash then base is best unless free plates are open.`
    );
  }

  // Role-specific best defaults
  if (isJg) {
    if (a.killLead <= -2) {
      add("jg_farm", 80, `${c}: jg behind — farm camps; only high-% ganks, no forced river.`);
    } else if (a.killLead >= 2) {
      add("jg_vision", 82, `${c}: jg ahead — set vision into next obj; create the map.`);
    } else {
      add("jg_tempo", 70, `${c}: jg — clear into a high-% look; skip low-% mid fog.`);
    }
    if (a.objectiveWindows[0] && a.minute >= 8 && manAdv >= 0 && a.killLead >= -1) {
      const win = a.objectiveWindows[0].split("—")[0].trim();
      add("jg_obj", 88, `${c}: ${win} — you set setup; only start with smite + numbers.`);
    }
  } else if (isSup) {
    if (a.minute < 14) {
      add(
        "sup_early",
        78,
        threat
          ? `${c}: support — crash bot, river ward, track ${threat}; roam on crash only.`
          : `${c}: support — crash bot then move mid/river; idle bot is a wasted map.`
      );
    } else {
      add(
        "sup_mid",
        76,
        threat
          ? `${c}: support mid — peel and vision vs ${threat}; enable carries.`
          : `${c}: support mid — ward ahead of group; peel, don't solo find.`
      );
    }
  } else if (isCarry) {
    if (a.phase === "late") {
      add("adc_late", 80, `${c}: ADC late — max range DPS on the next fight; no face-check.`);
    } else if (a.levelLead <= -1.2) {
      add("adc_behind", 82, `${c}: down levels — CS under tower; skip all-ins until even.`);
    } else if (a.killLead >= 2) {
      add("adc_ahead", 80, `${c}: ahead — take tower waves with team; stay max range.`);
    } else {
      add(
        "adc_default",
        68,
        `${c} L${a.you.level}: crash then share mid/side; only high-% with support.`
      );
    }
  } else {
    // FLEX / top-mid style
    if (a.phase === "early" && a.levelLead <= -1.2) {
      add("flex_behind", 84, `${c}: down ~${Math.abs(a.levelLead).toFixed(1)} lvls — CS tower, skip all-ins.`);
    }
    if (a.killLead >= 3) {
      add("flex_snowball", 82, `${c}: +${a.killLead} @ ${a.clockLabel} — tower wave, not random skirmish.`);
    }
    if (a.killLead <= -3) {
      add(
        "flex_lose",
        80,
        threat
          ? `${c}: −${Math.abs(a.killLead)} — farm item; mosquito pressure, respect ${threat}.`
          : `${c}: −${Math.abs(a.killLead)} — farm item; make them sweat, no 50/50 river.`
      );
    }
    if (a.objectiveWindows[0] && a.minute >= 8) {
      const win = a.objectiveWindows[0].split("—")[0].trim();
      add("flex_obj", 78, `${c}: ${win} — shove then arrive first with allies.`);
    }
    add(
      "flex_default",
      55,
      `${c} @ ${a.clockLabel} L${a.you.level}: shove then move first — force them to react.`
    );
  }

  if (mode.noRecall) {
    add(
      "aram",
      75,
      gold >= 1000
        ? `${c}: ${gold}g banked — poke, shop on death, never walk side alone.`
        : `${c} @ ${a.clockLabel}: poke first; commit only with two allies.`
    );
  }

  if (threat && a.pressure !== "winning") {
    add(
      "threat",
      60,
      `${c}: ${threat} is the threat — only fight with numbers or CC.`
    );
  }

  // Always have a floor option
  if (!opts.length) {
    add(
      "floor",
      40,
      `${c} @ ${a.clockLabel}: next high-% play from the board — wave, base, or group.`
    );
  }

  return opts;
}

function strategyFallback(a: MatchAnalytics, mode: ModeProfile): string {
  return pickBest(buildTempoOptions(a, mode), a);
}

export function polishLine(line: string, a: MatchAnalytics, mode: ModeProfile): string {
  if (!isObviousLine(line)) return line;
  return strategyFallback(a, mode);
}

export function nextCoachAction(a: MatchAnalytics, kind = "tempo"): string {
  const mode = modeStubFromAnalytics(a);
  return polishLine(craftCoachLine(a, kind, mode), a, mode);
}

/** Debug / AI: show top competing options for this board (brain-boosted) */
export function explainBestOptions(
  a: MatchAnalytics,
  mode?: ModeProfile,
  limit = 3
): PlayOption[] {
  const m = mode || modeStubFromAnalytics(a);
  let opts = buildTempoOptions(a, m).filter((o) => o.score > 0);
  try {
    opts = applyBrainToOptions(opts, computeCoachBrain(a));
  } catch {
    /* ignore */
  }
  return opts.sort((x, y) => y.score - x.score).slice(0, limit);
}
