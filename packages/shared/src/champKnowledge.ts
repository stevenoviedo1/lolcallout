/**
 * Champ lock-in knowledge: combos, identity, what to watch.
 * Extensible map — unknown champs still get role-generic forecast.
 */

export interface ChampKit {
  name: string;
  role: string;
  /** Ability combo lines for lock-in brief */
  combos: string[];
  identity: string;
  /** What enemies should fear / you should play for */
  playFor: string[];
  /** Common threats / what to watch */
  watchFor: string[];
  /** Early plan */
  early: string;
}

/** Keyed by normalized champion name (lowercase, no spaces/punct) */
export const CHAMP_KITS: Record<string, ChampKit> = {
  aurelionsol: {
    name: "Aurelion Sol",
    role: "Mid / flex mage",
    combos: [
      "Q stack → W move → Q detonate for poke",
      "E fly for roam/setup → R for disengage or pick",
      "R into Q for execute when stars are stacked",
    ],
    identity: "Long-range stacking mage — never stand melee range.",
    playFor: ["stack Q safely", "roam on crash", "ult for peel or catch"],
    watchFor: ["assassins gap-closing", "hard CC mid", "getting collapsed on side"],
    early: "Farm mid, stack Q on wave, look for river help after crash.",
  },
  ahri: {
    name: "Ahri",
    role: "Mid assassin-mage",
    combos: ["E charm → Q → W → R for finish", "R to dodge then re-engage"],
    identity: "Charm windows and side angles.",
    playFor: ["charm picks", "roam bot", "side wave after 1 item"],
    watchFor: ["anti-engage", "saving charm for escape"],
    early: "Push priority, look level 6 all-in or roam.",
  },
  zed: {
    name: "Zed",
    role: "Mid assassin",
    combos: ["W-E-Q poke", "R → W swap → E-Q full combo", "R for escape if behind"],
    identity: "Isolated target hunter — farm when behind.",
    playFor: ["side picks", "ult squishies", "tower dives with jg"],
    watchFor: ["zhonya", "hard CC", "1v3 greed"],
    early: "Farm to dirk spike; only force if jungler is near.",
  },
  orianna: {
    name: "Orianna",
    role: "Mid control mage",
    combos: ["Q-W poke", "Q-R shockwave with team", "E shield allies in fights"],
    identity: "Ball is the play — teamfight god.",
    playFor: ["shockwave with engage", "mid priority", "protect carries with E"],
    watchFor: ["flanking assassins", "ball position too far"],
    early: "Wave control, no ego all-ins without ball setup.",
  },
  jinx: {
    name: "Jinx",
    role: "ADC",
    combos: ["W snare → rockets", "R for long-range execute", "passive reset kiting"],
    identity: "Hypercarry — DPS after team engages.",
    playFor: ["resets", "max range", "siege with rockets"],
    watchFor: ["flanks", "facechecks", "dying first"],
    early: "CS under tower if pressured; no river alone.",
  },
  jhin: {
    name: "Jhin",
    role: "ADC",
    combos: ["4th shot windows", "W root → 4th", "R execute line"],
    identity: "Trap and fourth-shot windows.",
    playFor: ["root setups", "long-range R", "trap zones"],
    watchFor: ["reload windows", "facechecking brush"],
    early: "Punish with 4th; freeze when weak.",
  },
  thresh: {
    name: "Thresh",
    role: "Support",
    combos: ["Q hook → AA → E flay", "Q → lantern save", "R box then flay"],
    identity: "Playmaking support — hooks win lanes.",
    playFor: ["hook angles", "lantern peels", "roam mid"],
    watchFor: ["hook cooldowns", "inting for style"],
    early: "Level 2 look for hook; ward river on crash.",
  },
  nami: {
    name: "Nami",
    role: "Support",
    combos: ["Q bubble → empower AA", "R wave with team engage", "E on ADC for trades"],
    identity: "Engage enabler and poke support.",
    playFor: ["bubble picks", "R with jg gank", "roam on crash"],
    watchFor: ["missed bubble CDs", "overstaying"],
    early: "Poke with W, bubble when they go for CS.",
  },
  garen: {
    name: "Garen",
    role: "Top",
    combos: ["Q silence → E spin → R execute", "W for trade tanking"],
    identity: "Short trades and side pressure.",
    playFor: ["phase rush / stride trades", "split when fed", "R on low targets"],
    watchFor: ["ranged poke", "ganks without flash"],
    early: "Short spin trades; don't chase into brush.",
  },
  darius: {
    name: "Darius",
    role: "Top",
    combos: ["W reset AA → Q outer", "pull E → full stack R"],
    identity: "Stack and all-in juggernaut.",
    playFor: ["5-stack threat", "side pressure", "flash R"],
    watchFor: ["kiting", "ganks when ghost down"],
    early: "Only Q outer; freeze when behind.",
  },
  leesin: {
    name: "Lee Sin",
    role: "Jungle",
    combos: ["Q-Q2 → W or R kick", "insec R → flash/W"],
    identity: "Early tempo jungler.",
    playFor: ["early ganks", "objective setup", "kick carries"],
    watchFor: ["falling off late", "forced 1v9"],
    early: "Full clear or early gank based on leash; track enemy jg.",
  },
  lux: {
    name: "Lux",
    role: "Mid/Support mage",
    combos: ["E slow → Q snare → R", "Q → AA → E"],
    identity: "Artillery snare combo.",
    playFor: ["artillery poke", "R cleanup", "zone with E"],
    watchFor: ["standing mid-wave", "all-in without snare"],
    early: "Farm with E; Q only when punishable.",
  },
  yasuo: {
    name: "Yasuo",
    role: "Mid/Top",
    combos: ["EQ into airblade", "R on knockup only", "windwall key spells"],
    identity: "Only go in with knockups/team.",
    playFor: ["team knockups", "side angle", "windwall value"],
    watchFor: ["ego dashes", "no ult without setup"],
    early: "Farm, stack Q, don't flash for nothing.",
  },
  yone: {
    name: "Yone",
    role: "Mid/Top",
    combos: ["Q3 knockup → E snap", "R engage with team"],
    identity: "Skirmisher with E safety.",
    playFor: ["E trades", "side wave", "R flanks"],
    watchFor: ["E commit without exit", "hard CC"],
    early: "Q3 poke, E short trades, base on components.",
  },
  sett: {
    name: "Sett",
    role: "Top",
    combos: ["W true damage on white bar", "E pull → W", "R into team"],
    identity: "Short trades and flash W threat.",
    playFor: ["W timing", "side pressure", "R fling carries"],
    watchFor: ["kiting", "W on CD"],
    early: "Stack white bar then W; freeze if weak.",
  },
  caitlyn: {
    name: "Caitlyn",
    role: "ADC",
    combos: ["E → headshot", "W trap → Q", "R execute"],
    identity: "Lane bully and trap zones.",
    playFor: ["plate pressure", "trap setups", "max range"],
    watchFor: ["all-ins when E down", "facechecks"],
    early: "Push for plates; trap brush on recall paths.",
  },
  ezreal: {
    name: "Ezreal",
    role: "ADC",
    combos: ["Q poke", "W → Q", "E for kite", "R wave clear / poke"],
    identity: "Safe poke ADC.",
    playFor: ["Q farm poke", "safe sieges", "E only for escape usually"],
    watchFor: ["no damage if you never fight", "E greed"],
    early: "Q CS and poke; don't force 2v2 without summs.",
  },
  kaisa: {
    name: "Kai'Sa",
    role: "ADC",
    combos: ["passive plasma stacks → W isolate", "R engage after team", "E evolve kite"],
    identity: "Hybrid carry — evolve spikes.",
    playFor: ["evolve timing", "R after engage", "mid-game skirmish"],
    watchFor: ["R in alone", "weak early 2v2"],
    early: "Farm to evolve; no river alone.",
  },
  missfortune: {
    name: "Miss Fortune",
    role: "ADC",
    combos: ["E slow → Q bounce", "R channel with team CC"],
    identity: "Lane poke and R teamfights.",
    playFor: ["Q bounce", "R with engage", "shove bot"],
    watchFor: ["R interrupted", "all-in when E down"],
    early: "Q poke for shove; freeze when jungler missing.",
  },
  ashe: {
    name: "Ashe",
    role: "ADC",
    combos: ["W poke", "R initiate → team follows", "E scout"],
    identity: "Utility ADC — vision and engage.",
    playFor: ["R picks", "E info", "slow kiting"],
    watchFor: ["no escape", "R wasted"],
    early: "E on river; R only when team can follow.",
  },
  blitzcrank: {
    name: "Blitzcrank",
    role: "Support",
    combos: ["Q grab → W → E knockup → R"],
    identity: "Hook win condition.",
    playFor: ["hook angles", "flash Q", "roam mid"],
    watchFor: ["missed Q CD", "inting for hooks"],
    early: "Level 1-2 hook look; ward after crash.",
  },
  leona: {
    name: "Leona",
    role: "Support",
    combos: ["E zenith → Q stun → R solar"],
    identity: "Hard engage tank support.",
    playFor: ["E-Q all-in", "R with jg", "lock carries"],
    watchFor: ["engage without follow-up", "dying first"],
    early: "Level 2 E-Q; only engage when ADC can hit.",
  },
  lulu: {
    name: "Lulu",
    role: "Support",
    combos: ["E-W on ally", "Q poke", "R knockup save"],
    identity: "Enchanter peel.",
    playFor: ["peel ADC", "polymorph diver", "R save"],
    watchFor: ["roaming too long", "W on wrong target"],
    early: "Shield ADC in trades; roam only on crash.",
  },
  soraka: {
    name: "Soraka",
    role: "Support",
    combos: ["W heal", "E silence zone", "R global save"],
    identity: "Sustain enchanter.",
    playFor: ["lane sustain", "E zone", "R across map"],
    watchFor: ["getting dived", "no mana"],
    early: "Heal trades; don't stand forward without E.",
  },
  morgana: {
    name: "Morgana",
    role: "Support/Mid",
    combos: ["Q snare → W", "E black shield engage", "R root flash"],
    identity: "Snare and shield utility.",
    playFor: ["Q picks", "shield against CC", "R flash"],
    watchFor: ["missed Q", "R without backup"],
    early: "Q on CS greed; shield ADC from gank CC.",
  },
  pyke: {
    name: "Pyke",
    role: "Support",
    combos: ["Q hook → E stun", "R execute reset"],
    identity: "Roam assassin support.",
    playFor: ["roam mid", "R resets", "hook from fog"],
    watchFor: ["inting for gold", "no vision"],
    early: "Shove crash then roam; R only for execute.",
  },
  viego: {
    name: "Viego",
    role: "Jungle",
    combos: ["W stun → Q → R reset", "possess after kill"],
    identity: "Reset skirmisher jungler.",
    playFor: ["skirmish resets", "obj fights", "possess carries"],
    watchFor: ["falling behind farm", "bad possess"],
    early: "Full clear into gank; track enemy jg.",
  },
  graves: {
    name: "Graves",
    role: "Jungle",
    combos: ["Q-AA-W smoke", "R dash execute"],
    identity: "Farm and skirmish jungler.",
    playFor: ["invade", "smite fights", "side pressure"],
    watchFor: ["over-invade", "no team peel"],
    early: "Fast clear, look scuttle fight.",
  },
  kindred: {
    name: "Kindred",
    role: "Jungle",
    combos: ["Q kite", "W zone", "E execute", "R save"],
    identity: "Mark farming marksman jg.",
    playFor: ["marks", "kite objectives", "R on carries"],
    watchFor: ["falling behind marks", "R wasted"],
    early: "Take marks safely; don't force 1v2.",
  },
  aatrox: {
    name: "Aatrox",
    role: "Top",
    combos: ["Q1-Q2-Q3 sweetspots", "W pull → Q", "E into Q"],
    identity: "Sweetspot fighter.",
    playFor: ["Q sweetspots", "side wave", "R sustain fights"],
    watchFor: ["missed Qs", "ganks when E down"],
    early: "Short Q trades; freeze if behind.",
  },
  camille: {
    name: "Camille",
    role: "Top",
    combos: ["W poke", "E hookshot → Q2 true", "R lock carry"],
    identity: "Side lane and R lock.",
    playFor: ["E ganks", "side pressure", "R carries"],
    watchFor: ["E miss", "diving without ult"],
    early: "W poke to shove; E only with vision.",
  },
  gnar: {
    name: "Gnar",
    role: "Top",
    combos: ["mega transform combos", "E hop → Q", "mega R into wall"],
    identity: "Rage transform fighter.",
    playFor: ["mega engages", "kiting mini", "R wall"],
    watchFor: ["transform in bad spot", "overextend mini"],
    early: "Mini kite; mega when they commit.",
  },
  malphite: {
    name: "Malphite",
    role: "Top/Support tank",
    combos: ["E AS slow", "Q poke", "R engage → team"],
    identity: "R engage tank.",
    playFor: ["R flash carries", "tank frontline", "Q poke"],
    watchFor: ["R without follow-up", "shoved without TP"],
    early: "Farm tank; R only when team can follow.",
  },
  renekton: {
    name: "Renekton",
    role: "Top",
    combos: ["empowered W stun", "E-W-Q-E out", "R all-in"],
    identity: "Fury short-trade bully.",
    playFor: ["fury trades", "dive with jg", "side pressure"],
    watchFor: ["no fury", "ganks"],
    early: "Empowered W trades; freeze if weak.",
  },
  riven: {
    name: "Riven",
    role: "Top",
    combos: ["fast Q combo", "W stun → Q", "R-R execute"],
    identity: "Animation-cancel fighter.",
    playFor: ["short combos", "flash all-in", "side wave"],
    watchFor: ["mana-less all-in fail", "ganks"],
    early: "Practice short trades; don't force without CD.",
  },
  fiora: {
    name: "Fiora",
    role: "Top",
    combos: [" vitals proc", "W parry CC", "R vitals"],
    identity: "Side lane vitals.",
    playFor: ["split push", "parry key CC", "R duel"],
    watchFor: ["teamfight without split", "W miss"],
    early: "Proc vitals; W the big CC.",
  },
  jax: {
    name: "Jax",
    role: "Top/Jungle",
    combos: ["E dodge → stun", "Q leap → W", "R third AA"],
    identity: "Scale and dodge.",
    playFor: ["E key abilities", "late side", "dive after 2 items"],
    watchFor: ["weak early", "E down all-in"],
    early: "Farm to sheen/trinity; don't force 1v2.",
  },
  tryndamere: {
    name: "Tryndamere",
    role: "Top",
    combos: ["E gap → AA rage", "R sustain all-in", "W slow"],
    identity: "Split ult carry.",
    playFor: ["split", "ult dive", "crit spikes"],
    watchFor: ["teamfight without ult", "getting kited"],
    early: "Stack rage; only all-in with R.",
  },
  illaoi: {
    name: "Illaoi",
    role: "Top",
    combos: ["E spirit → slap", "R tentacles in fight"],
    identity: "Tentacle zone fighter.",
    playFor: ["E land", "R in wave of tentacles", "dive under tower"],
    watchFor: ["missed E", "kited outside R"],
    early: "E is the lane; freeze if E down.",
  },
  nasus: {
    name: "Nasus",
    role: "Top",
    combos: ["stack Q", "W wither kite", "R wave clear"],
    identity: "Stack scale.",
    playFor: ["stacks", "wither divers", "late side"],
    watchFor: ["early all-ins", "dives pre-sheen"],
    early: "Stack under tower if needed; TP for plays later.",
  },
  sion: {
    name: "Sion",
    role: "Top tank",
    combos: ["Q charge", "E slow → Q", "R engage"],
    identity: "Tank wave clear and R.",
    playFor: ["R flanks", "wave clear", "tank front"],
    watchFor: ["missed Q", "R into 5 alone"],
    early: "Farm Q; R only for definite impact.",
  },
  urgot: {
    name: "Urgot",
    role: "Top",
    combos: ["E flip → W", "R execute"],
    identity: "Shotgun knees fighter.",
    playFor: ["E flip", "R execute", "side"],
    watchFor: ["kiting", "E miss"],
    early: "Short W trades; R only for kill.",
  },
  mordekaiser: {
    name: "Mordekaiser",
    role: "Top",
    combos: ["E pull → Q", "R isolate carry"],
    identity: "Isolate and beat.",
    playFor: ["R carries", "side", "Q zone"],
    watchFor: ["R wrong target", "kited"],
    early: "Short Q; R only with setup.",
  },
  ksante: {
    name: "K'Sante",
    role: "Top",
    combos: ["Q3 stun", "all-out form engage", "W tank"],
    identity: "Tank into all-out.",
    playFor: ["Q3", "all-out picks", "peel"],
    watchFor: ["all-out with no exit", "mana"],
    early: "Q poke; all-out only for kill or save.",
  },
};

export function normalizeChampKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function getChampKit(nameOrId: string | undefined): ChampKit | null {
  if (!nameOrId) return null;
  const key = normalizeChampKey(nameOrId);
  if (CHAMP_KITS[key]) return CHAMP_KITS[key];
  // numeric id — unknown without full map
  if (/^\d+$/.test(nameOrId)) return null;
  return null;
}

/** Champ select / lock-in brief for AI + local display */
export function buildLockInBrief(opts: {
  myChampion?: string;
  myChampionId?: number | string;
  position?: string;
  enemies?: string[];
  allies?: string[];
  modeLabel?: string;
}): {
  title: string;
  combos: string[];
  forecast: string[];
  watchFor: string[];
  early: string;
  speak: string;
  aiPrompt: string;
} {
  const name =
    opts.myChampion ||
    (opts.myChampionId ? `Champion ${opts.myChampionId}` : "Your champion");
  const kit = getChampKit(opts.myChampion || "") || getChampKit(String(opts.myChampionId || ""));
  const pos = opts.position || kit?.role || "your role";
  const enemies = (opts.enemies || []).filter(Boolean);
  const enemyKits = enemies.map((e) => getChampKit(e)).filter(Boolean) as ChampKit[];

  const combos = kit?.combos?.length
    ? kit.combos
    : [
        "Learn your basic trade combo in practice tool before first fight",
        "Save escape spell for disengage unless kill is free",
      ];

  const watchFor: string[] = [...(kit?.watchFor || [])];
  for (const ek of enemyKits.slice(0, 3)) {
    watchFor.push(`${ek.name}: ${ek.identity}`);
  }
  if (!watchFor.length) watchFor.push("Hard CC and gap-closers that delete you");

  // Pre-match style (Baron Buff / Sensei): plan + threats + projected win feel
  const winFeel =
    kit?.playFor?.some((p) => /stack|scale|farm|siege|hyper/i.test(p))
      ? "Likely scale — hit item spikes before forcing 50/50s."
      : kit?.playFor?.some((p) => /pick|roam|all-in|ult/i.test(p))
        ? "Likely tempo/snowball — convert priority into plates or roams."
        : "Read the draft live — force only with level/item or numbers.";

  const forecast: string[] = [
    opts.modeLabel
      ? `Mode: ${opts.modeLabel} — callouts adapt (ARAM = no recall, SR = wave→base→obj).`
      : "Mode: detect in-game; SR vs ARAM vs Arena change every call.",
    kit?.identity || `${name}: play kit identity — don't force fights without setup.`,
    `Win feel: ${winFeel}`,
    ...(kit?.playFor || ["Hit power spikes before forcing"]).map((p) => `Play for: ${p}`),
    enemies.length
      ? `Enemy threats locked: ${enemies.slice(0, 5).join(", ")}`
      : "Enemy threats: update as they lock — watch assassins and hard CC.",
    "Live threat forecast updates from kills/items on the scoreboard (never fog invent).",
  ];

  const early =
    kit?.early ||
    `As ${name} (${pos}): first 3 levels own the wave, only fight with level or numbers.`;

  const topThreat =
    enemyKits[0]?.name ||
    (enemies[0] ? enemies[0] : null);
  const speak = kit
    ? topThreat
      ? `${kit.name}: ${combos[0]}. Early — ${early.slice(0, 48)}. Respect ${topThreat}.`
      : `${kit.name}: ${combos[0]}. Early — ${early.slice(0, 70)}`
    : `${name} locked. First spike plan on; I'll coach from live scoreboard.`;

  const aiPrompt = [
    "CHAMP LOCK-IN / PRE-MATCH BRIEF — user just locked.",
    `My champ: ${name} | Position: ${pos}`,
    `Allies: ${(opts.allies || []).join(", ") || "unknown"}`,
    `Enemies: ${enemies.join(", ") || "unknown/still picking"}`,
    kit ? `Kit identity: ${kit.identity}` : "",
    kit ? `Known combos:\n${combos.map((c) => `- ${c}`).join("\n")}` : "",
    "Structure like a human coach pre-game (premium, short):",
    "1) PLAN: first 3 levels + first recall spike (2 lines)",
    "2) COMBOS: 1-2 practical ability combos",
    "3) MATCHUP / WATCH: named enemy threats if known — cooldowns to respect",
    "4) WIN FEEL: snowball vs scale vs stabilize — how the game should feel",
    "5) LEARNING FOCUS: one habit for this session (e.g. base on gold, no river alone)",
    "Ban platitudes (play safe, convert). Mode-agnostic until in-game; ARAM/Arena differ.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: `${kit?.name || name} — lock-in plan`,
    combos,
    forecast,
    watchFor,
    early,
    speak: speak.slice(0, 180),
    aiPrompt,
  };
}

/** Enemy threat forecast from this-game past (kills/items) + projected behavior */
export function buildEnemyThreatForecast(opts: {
  fedEnemies: string[];
  enemyDead: number;
  allyDead: number;
  pressure: string;
  phase: string;
  noRecall: boolean;
}): string[] {
  const lines: string[] = [];
  if (opts.fedEnemies[0]) {
    lines.push(
      `PAST: ${opts.fedEnemies[0]} is fed — they will look for picks and side angles.`
    );
    lines.push(
      `FUTURE (projected): expect ${opts.fedEnemies[0]} to force when they see you alone — group or ward.`
    );
  }
  if (opts.enemyDead >= 2) {
    lines.push("PAST: enemies just died — free window now.");
    lines.push("FUTURE: window closes on their respawn — convert plates/obj immediately.");
  }
  if (opts.allyDead >= 2) {
    lines.push("PAST: allies down — map is dark for you.");
    lines.push("FUTURE: enemies will invade/vision — hold until respawns.");
  }
  if (opts.pressure === "losing") {
    lines.push("FUTURE: they will siege and hunt — no ego 1v1s.");
  }
  if (opts.pressure === "winning") {
    lines.push("FUTURE: they may stall and look for one pick to throw your lead — don't chase fog.");
  }
  if (opts.noRecall) {
    lines.push("ARAM/Arena: no recall logistics — project fights around team CDs and spawn timers.");
  }
  if (!lines.length) {
    lines.push("No extreme threat yet — keep tracking first fed champ and number swings.");
  }
  return lines;
}
