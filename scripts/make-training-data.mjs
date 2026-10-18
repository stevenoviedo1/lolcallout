#!/usr/bin/env node
/**
 * Synthetic training data for a fine-tuned LOLCallout coach (Qwen2.5-3B, Unsloth QLoRA).
 *
 * Varies fixtures/mock-live-context.json into many game states across many champions,
 * runs them through the shared brains (situation summary + policy-safe seed lines) and
 * writes chat-format JSONL:
 *   training/lolcoach_train.jsonl  (95%)
 *   training/lolcoach_eval.jsonl   (5%)
 * Every live callout target passes checkLivePolicy (docs/RIOT_POLICY.md).
 *
 * Usage: npm run training:data   (or: node scripts/make-training-data.mjs [--callouts 3000] [--seed 7])
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = await import(pathToFileURL(path.join(root, "packages/shared/dist/src/index.js")).href);
const P = await import(pathToFileURL(path.join(root, "packages/prompts/dist/index.js")).href);

export const MAX_TOKENS = 1024;
/** Rough Qwen token estimate (≈3.6 chars/token for this English+numbers mix). */
export const estTokens = (s) => Math.ceil(s.length / 3.6);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const ROLE_TAGS = {
  TOP: ["Fighter", "Tank"],
  JUNGLE: ["Fighter", "Assassin", "Tank"],
  MIDDLE: ["Mage", "Assassin"],
  BOTTOM: ["Marksman"],
  UTILITY: ["Support"],
};
const DRAGONS = ["Infernal", "Ocean", "Mountain", "Cloud", "Hextech", "Chemtech"];

function pools() {
  const champs = Object.fromEntries(ROLES.map((r) => [r, []]));
  for (const id of S.allChampionIds()) {
    const c = S.getChampion(id);
    for (const r of ROLES) if (ROLE_TAGS[r].includes(c.tags[0])) champs[r].push(c.name);
  }
  const leg = S.allItems().filter((i) => i.tier === "legendary" && i.cost >= 2200 && !i.tags.includes("Consumable"));
  const byName = new Map(leg.map((i) => [i.name, i]));
  const uniq = (xs) => [...new Map(xs.map((i) => [i.name, i])).values()].map((i) => i.name);
  const items = {
    AP: uniq([...byName.values()].filter((i) => (i.stats.ap ?? 0) > 0)),
    AD: uniq([...byName.values()].filter((i) => (i.stats.ad ?? 0) > 0 || (i.stats.crit ?? 0) > 0)),
    TANK: uniq([...byName.values()].filter((i) => !(i.stats.ap || i.stats.ad) && ((i.stats.armor ?? 0) + (i.stats.mr ?? 0) + (i.stats.hp ?? 0) / 10 > 40))),
  };
  const boots = S.allItems().filter((i) => i.tier === "boots" && i.cost > 300).map((i) => i.name);
  return { champs, items, boots: [...new Set(boots)] };
}

function makeGenerator(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const chance = (p) => r() < p;
  const shuffle = (xs) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pool = pools();
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/mock-live-context.json"), "utf8"));

  function buildItems(champ, t, lead) {
    const type = S.threatTypeFor(champ);
    const n = Math.max(0, Math.min(6, Math.floor((t - 330) / 440 + lead + r() * 0.8)));
    const items = [];
    if (t > 300) items.push(pick(pool.boots));
    const src = shuffle(pool.items[type]);
    for (let i = 0; i < n && i < src.length; i++) items.push(src[i]);
    if (chance(0.3)) items.push("Control Ward");
    return items;
  }

  function snapshot(opts = {}) {
    const t = opts.t ?? int(240, 2100);
    const lead = opts.lead ?? (r() - 0.5) * 1.6; // ally item lead in items
    const myRole = opts.role ?? pick(ROLES);
    const used = new Set();
    const champFor = (role) => {
      let c;
      do c = pick(pool.champs[role]);
      while (used.has(c));
      used.add(c);
      return c;
    };
    const lvl = (k) => Math.max(1, Math.min(18, Math.round(2 + t / 105 + k + (r() - 0.5) * 2)));
    const scoreboard = [];
    for (const team of ["ORDER", "CHAOS"]) {
      for (const role of ROLES) {
        const ally = team === "ORDER";
        const championName = ally && role === myRole && opts.champ ? (used.add(opts.champ), opts.champ) : champFor(role);
        const k = ally ? lead : -lead;
        scoreboard.push({
          riotIdGameName: `${team[0]}${role}`,
          championName,
          team,
          level: lvl(k),
          kills: Math.max(0, Math.round((t / 300) * (role === "UTILITY" ? 0.3 : 1) * (1 + k / 2) * r())),
          deaths: Math.max(0, Math.round((t / 360) * (1 - k / 2) * r())),
          assists: int(0, Math.round(t / 150)),
          creeps: role === "UTILITY" ? int(10, 40) : Math.round((t / 60) * (role === "JUNGLE" ? 5.5 : 7) * (0.55 + r() * 0.55)),
          items: buildItems(championName, t, k / 2),
          laneRole: role,
          summonerSpells: role === "JUNGLE" ? ["Smite", "Flash"] : ["Flash", pick(["Ignite", "Teleport", "Heal", "Exhaust", "Barrier"])],
          isDead: false,
        });
      }
    }
    const deadE = opts.deadEnemies ?? (chance(0.5) ? 0 : int(0, 3));
    const deadA = opts.deadAllies ?? (chance(0.6) ? 0 : int(0, 3));
    shuffle(scoreboard.filter((p) => p.team === "CHAOS")).slice(0, deadE).forEach((p) => (p.isDead = true));
    const me = scoreboard.find((p) => p.team === "ORDER" && p.laneRole === myRole);
    shuffle(scoreboard.filter((p) => p.team === "ORDER" && p !== me)).slice(0, deadA).forEach((p) => (p.isDead = true));
    const maxHp = 600 + me.level * 95;
    const objectiveEvents = [];
    let eventId = 1;
    const drakes = Math.min(6, Math.floor(Math.max(0, t - 300) / 330));
    for (let i = 0; i < drakes; i++) {
      const killer = chance(0.5 + lead / 4) ? "OJUNGLE" : "CJUNGLE";
      objectiveEvents.push({ type: "DRAGON", gameTime: 300 + i * 330, payload: { EventName: "DragonKill", EventID: eventId++, DragonType: pick(DRAGONS), KillerName: killer } });
    }
    if (t > 900 && chance(0.6)) objectiveEvents.push({ type: "HERALD", gameTime: 840, payload: { EventName: "HeraldKill", EventID: eventId++, KillerName: chance(0.5) ? "OJUNGLE" : "CJUNGLE" } });
    if (t > 1500 && chance(0.5)) objectiveEvents.push({ type: "BARON", gameTime: t - int(60, 400), payload: { EventName: "BaronKill", EventID: eventId++, KillerName: chance(0.5 + lead / 4) ? "OJUNGLE" : "CJUNGLE" } });
    const towers = Math.floor(t / 420);
    for (let i = 0; i < towers; i++) {
      const enemyLost = chance(0.5 + lead / 4);
      const lane = pick(["L", "C", "R"]);
      objectiveEvents.push({ type: "TURRET", gameTime: 600 + i * 120, payload: { EventName: "TurretKilled", EventID: eventId++, TurretKilled: `Turret_T${enemyLost ? 2 : 1}_${lane}_0${pick([3, 2])}_A`, KillerName: enemyLost ? "OMIDDLE" : "CMIDDLE" } });
    }
    const ctx = {
      ...fixture,
      source: "mock",
      inGame: true,
      gameTime: t,
      gameMode: "CLASSIC",
      you: {
        ...fixture.you,
        championName: me.championName,
        level: me.level,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        creeps: me.creeps,
        items: me.items,
        laneRole: myRole,
        summonerSpells: me.summonerSpells,
        currentGold: opts.gold ?? int(0, 2600),
        totalGold: undefined,
        maxHealth: maxHp,
        currentHealth: Math.round(maxHp * (opts.hp ?? (0.15 + r() * 0.85))),
        isDead: false,
      },
      scoreboard,
      recentEvents: [{ type: "GAME_START", gameTime: 0, message: "Game started" }],
      objectiveEvents,
      inferredRole: myRole,
      updatedAt: new Date(0).toISOString(),
    };
    // Previous snapshot ~1 min earlier: one enemy (sometimes you) one item / level behind → visible spike.
    let prev = null;
    if (opts.spike ?? chance(0.35)) {
      prev = structuredClone(ctx);
      prev.gameTime = t - 30;
      const who = chance(0.7) ? pick(prev.scoreboard.filter((p) => p.team === "CHAOS")) : prev.scoreboard.find((p) => p.championName === me.championName);
      const legIdx = who.items.findIndex((i) => S.isCompletedItem(S.getItem(i)));
      if (legIdx >= 0 && chance(0.6)) who.items.splice(legIdx, 1);
      else if ([6, 11, 16].includes(who.level)) who.level -= 1;
      else {
        const cur = ctx.scoreboard.find((p) => p.championName === who.championName);
        cur.level = pick([6, 11, 16].filter((x) => x <= 2 + t / 80)) ?? cur.level;
        who.level = cur.level - 1;
      }
    }
    return { ctx, prev, r, pick, int, chance };
  }

  return { snapshot, pick, int, chance, r, pool };
}

// ------------------------------------------------------------ targets

function variantLines(summary, kind, g) {
  const s = summary;
  const y = s.you;
  const out = [];
  const n = s.numbers;
  const card = s.matchup;
  const dead = n?.deadEnemies ?? [];
  if (kind === "base" || kind === "item") {
    for (const note of card?.itemNotes ?? []) {
      out.push(`${y.gold} gold in your pocket. ${note}`);
      out.push(`You're sitting on ${y.gold}. ${note.replace(/ are options\.$| is an option\.$/, " could fit here.")}`);
    }
    if (y.gold >= 1100) {
      out.push(`${y.gold} gold unspent — a back for your next item or another wave first are both options.`);
      if (y.hpPct != null && y.hpPct < 50) out.push(`${y.hpPct}% HP with ${y.gold} gold — a reset is an option, or staying if the wave needs you.`);
    }
  }
  if ((kind === "kill" || kind === "numbers") && n) {
    if (n.advantage >= 1 && dead.length) {
      out.push(`${dead.join(" and ")} ${dead.length > 1 ? "are" : "is"} dead, so it's ${n.label} — towers, an objective or a reset all open up.`);
      if (s.objectives.soulPoint) out.push(`${n.label} with a team on soul point — whether dragon is up decides between it and towers.`);
    }
    if (n.advantage <= -1) out.push(`It's ${n.label} with ${n.deadAllies.join(" and ") || "allies"} down — tower range or a safe wave are options until they're back.`);
  }
  if (kind === "level_up" && [6, 11, 16].includes(y.level)) {
    const opp = card?.opponent ? g.ctx?.scoreboard.find((p) => S.normKey(p.championName) === S.normKey(card.opponent)) : null;
    out.push(`Level ${y.level} — your ult got a rank${opp ? ` and ${card.opponent} is level ${opp.level}` : ""}; trading or shoving are options.`);
  }
  if (kind === "tempo") {
    for (const sp of s.spikes.filter((x) => x.startsWith("NEW:"))) {
      const fact = sp.replace(/^NEW: /, "").replace(/ \((enemy|ally)\)/, "");
      out.push(/^you /.test(fact) ? `You ${fact.slice(4)} — that's your spike, so trading or forcing a play are options.` : `${fact} — that's a visible spike worth respecting in the next fight.`);
    }
    if (s.farm?.rating === "behind") out.push(`${s.farm.csPerMin} CS a minute vs the ${s.farm.csTarget} ${s.role.toLowerCase()} benchmark — side waves between fights are an easy gold option.`);
    if (s.gold && Math.abs(s.gold.diff) >= 2000) out.push(`Your team is ${s.gold.label} — ${s.gold.diff > 0 ? "fights with vision favor you" : "scaling and waves are options while you catch up"}.`);
    if (s.objectives.soulPoint) out.push(`A team is on soul point — dragon fights get a lot bigger from here.`);
  }
  if (kind === "low_hp" && y.hpPct != null) {
    out.push(y.gold >= 900 ? `${y.hpPct}% HP and ${y.gold} gold — a reset is an option, and staying risks a shutdown.` : `${y.hpPct}% HP — playing at range or a reset are both options.`);
  }
  const bro = g.chance(0.35);
  return out.map((l) => (bro && g.chance(0.5) ? `${g.pick(["Yo, ", "Bro, ", "Okay so ", "Real quick, "])}${l[0].toLowerCase()}${l.slice(1)}` : l));
}

const KINDS = [
  ["base", 0.2],
  ["kill", 0.2],
  ["numbers", 0.15],
  ["tempo", 0.25],
  ["level_up", 0.08],
  ["low_hp", 0.12],
];

function pickKind(g) {
  let x = g.r();
  for (const [k, w] of KINDS) if ((x -= w) <= 0) return k;
  return "tempo";
}

function optsForKind(kind, g) {
  switch (kind) {
    case "base": return { gold: g.int(1100, 3200) };
    case "kill": return { deadEnemies: g.int(1, 4), deadAllies: g.int(0, 1) };
    case "numbers": return g.chance(0.5) ? { deadEnemies: g.int(2, 4), deadAllies: 0 } : { deadAllies: g.int(2, 3), deadEnemies: 0 };
    case "tempo": return { spike: g.chance(0.6) };
    case "low_hp": return { hp: 0.08 + g.r() * 0.22 };
    default: return {};
  }
}

export function makeCallouts(count, seed = 7) {
  const g = makeGenerator(seed);
  const rows = [];
  const seen = new Set();
  let rejected = 0;
  let tries = 0;
  while (rows.length < count && tries++ < count * 20) {
    const kind = pickKind(g);
    const { ctx, prev } = g.snapshot(optsForKind(kind, g));
    if (kind === "level_up") ctx.you.level = g.pick([6, 11, 16]);
    const summary = S.buildSituationSummary(ctx, prev);
    g.ctx = ctx;
    const candidates = [S.summarySeedLine(summary, kind), S.localFallbackLine(ctx, kind), ...variantLines(summary, kind, g)].filter(Boolean);
    const safe = candidates.filter((l) => {
      const ok = S.checkLivePolicy(l).ok;
      if (!ok) rejected++;
      return ok;
    });
    if (!safe.length) continue;
    const line = g.pick(safe);
    const key = `${kind}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const personality = /^(Yo|Bro|Okay so|Real quick),/.test(line) ? "hype" : "friend";
    const req = { message: `KIND: ${kind}. Situation brief.`, intent: "callout", context: ctx, personality };
    rows.push({
      kind: "callout",
      messages: [
        { role: "system", content: P.LOLCOACH_SYSTEM_PROMPT_TINY },
        { role: "user", content: P.buildCompactUserPayload(req, { summary }) },
        { role: "assistant", content: `CALLOUT: ${line}` },
      ],
    });
  }
  return { rows, rejected };
}

function randomHabits(g, champ) {
  let p = S.emptyHabitProfile();
  const n = g.int(0, 8);
  for (let i = 0; i < n; i++) {
    p = S.recordGame(p, {
      endedAt: new Date(0).toISOString(), champion: champ, role: g.pick(ROLES), durationSec: g.int(1200, 2300),
      deaths: g.int(1, 10), deathsWhileAhead: g.int(0, 3), deathsBeforeObjective: g.int(0, 2), deathsAfterObjective: g.int(0, 1),
      csPerMin: Math.round((4 + g.r() * 5) * 10) / 10, csTarget: 7.5, controlWardsBought: g.int(0, 5),
      highGoldDeaths: g.int(0, 3), avgGoldAtDeath: g.int(300, 2000),
    });
  }
  return p;
}

export function makeSummaries(count, seed = 11) {
  const g = makeGenerator(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const { ctx } = g.snapshot({ t: g.int(1300, 2300), spike: false, deadEnemies: 0, deadAllies: 0 });
    const y = ctx.you;
    const early = g.int(0, Math.min(3, y.deaths));
    ctx.deathReport = { total: y.deaths, early, mid: Math.max(0, y.deaths - early - 1), late: Math.min(1, y.deaths), dominant: y.deaths > 3 ? g.pick(["early_overextend", "late_facecheck", "solo_sidelane", null]) : null };
    const habits = randomHabits(g, y.championName);
    const grade = S.gradeMatch({
      kills: y.kills, deaths: y.deaths, assists: y.assists, creeps: y.creeps, gameTimeSec: ctx.gameTime,
      earlyDeaths: early, gameMode: "CLASSIC", mapName: "Map11", scoreboard: ctx.scoreboard,
    });
    const s = S.buildSituationSummary(ctx);
    const bullets = [];
    if (s.farm) bullets.push(`Farm: ${s.farm.csPerMin} CS/min against a ${s.farm.csTarget} ${s.role.toLowerCase()} benchmark — ${s.farm.rating === "behind" ? "side waves between objectives were the biggest free gold left on the map" : s.farm.rating === "ahead" ? "great farming, keep that pace" : "right on pace"}.`);
    if (s.gold) bullets.push(`Team items finished ${s.gold.label}${s.gold.diff < -1500 ? " — fights before your item spikes cost the most" : ""}.`);
    if (early >= 2) bullets.push(`${early} deaths before 14 minutes — the laning phase is where this game slipped; trade only with a clear advantage.`);
    else bullets.push(`Only ${early} early death${early === 1 ? "" : "s"} — laning was stable.`);
    if (s.matchup?.itemNotes[0]) bullets.push(`Itemization: ${s.matchup.itemNotes[0]}`);
    const habit = habits.top[0];
    const target = [
      "POST-GAME SUMMARY",
      `Grade: ${grade.letter} (${grade.score}/100)`,
      `Scoreline: ${y.championName} ${y.kills}/${y.deaths}/${y.assists} · ${y.creeps} CS`,
      ...bullets.slice(0, 4).map((b) => `• ${b}`),
      habit ? `Habit: ${habit.line} — ${habit.fix}.` : `Habit: ${grade.habits[0] || "Base with gold before objectives."}`,
      `Next game focus: ${habit ? habit.fix[0].toUpperCase() + habit.fix.slice(1) : s.farm?.rating === "behind" ? "Hit your CS benchmark by 15 minutes." : "Be alive and reset before each dragon spawns."}.`,
    ].join("\n");
    const req = { message: "Generate post-game summary for this match.", intent: "summary", context: ctx, habits };
    rows.push({
      kind: "summary",
      messages: [
        { role: "system", content: P.LOLCOACH_SYSTEM_PROMPT_TINY },
        { role: "user", content: P.buildCompactUserPayload(req, { summary: s }) },
        { role: "assistant", content: target },
      ],
    });
  }
  return rows;
}

export function makeChampSelect(count, seed = 13) {
  const g = makeGenerator(seed);
  const rows = [];
  const POS = { TOP: "top", JUNGLE: "jungle", MIDDLE: "middle", BOTTOM: "bottom", UTILITY: "utility" };
  for (let i = 0; i < count; i++) {
    const role = g.pick(ROLES);
    const me = g.pick(g.pool.champs[role]);
    const enemies = ROLES.map((r) => g.pick(g.pool.champs[r].filter((c) => c !== me)));
    const cs = { active: true, myChampion: me, assignedPosition: POS[role], enemies, allies: [], updatedAt: new Date(0).toISOString() };
    const card = S.champSelectMatchup(cs);
    const habits = randomHabits(g, me);
    const mine = S.getChampion(me);
    const scale = mine.info.difficulty >= 7 ? "lean on what you've practiced" : "play your fundamentals";
    const plan =
      role === "JUNGLE"
        ? `PLAN: Full clear into the lane with the best setup; ${mine.tags.includes("Assassin") ? "look for early skirmishes once you have your first item component" : "track your own camps and trade objectives cross-map"}.`
        : role === "UTILITY"
          ? `PLAN: Ward the river bush by 2:30 and ${mine.tags.includes("Mage") ? "poke when the enemy carry walks up for CS" : "set up level-2 with your ADC"}.`
          : `PLAN: ${card?.rangeNote?.startsWith("you outrange") ? "Use your range to trade when they step up for CS" : card?.rangeNote?.startsWith("they outrange") ? "Farm under pressure early and trade when their key spell is used" : "Even range — win the level-2 race and trade off it"}; ${scale}; your first big spike is your first completed item.`;
    const lines = [
      plan,
      card?.opponent ? `MATCHUP: ${card.you} vs ${card.opponent} (${card.rangeNote}). Their kit: ${card.opponentKit}.` : `MATCHUP: Watch the enemy jungler's early skirmish power.`,
      card ? `THREATS: ${card.threats.AD} AD, ${card.threats.AP} AP, ${card.threats.TANK} tank · ${card.healers.length} healers, ${card.shielders.length} shielder${card.shielders.length === 1 ? "" : "s"}.` : null,
      ...(card?.itemNotes ?? []).map((n) => `ITEMS: ${n}`),
      habits.top[0] ? `HABIT: ${S.habitPlanLine(habits)}` : `HABIT: One focus this game — be alive and reset before each dragon.`,
    ].filter(Boolean);
    const req = { message: `Champ select: ${me} ${role}`, intent: "champ_select", champSelect: cs, habits };
    rows.push({
      kind: "champ_select",
      messages: [
        { role: "system", content: P.LOLCOACH_SYSTEM_PROMPT_TINY },
        { role: "user", content: P.buildCompactUserPayload(req) },
        { role: "assistant", content: lines.join("\n") },
      ],
    });
  }
  return rows;
}

function arg(name, d) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
}

async function main() {
  const nCallouts = arg("--callouts", 3000);
  const seed = arg("--seed", 7);
  const { rows: callouts, rejected } = makeCallouts(nCallouts, seed);
  const summaries = makeSummaries(arg("--summaries", 300), seed + 4);
  const champ = makeChampSelect(arg("--champ-select", 300), seed + 6);
  const all = [...callouts, ...summaries, ...champ];
  // Final gate: every live target must pass the policy filter.
  for (const row of callouts) {
    const v = S.checkLivePolicy(row.messages[2].content);
    if (!v.ok) throw new Error(`policy violation slipped through: ${row.messages[2].content} (${v.reasons})`);
  }
  let maxTok = 0;
  for (const row of all) {
    const tok = estTokens(row.messages.map((m) => m.content).join("\n")) + 12;
    maxTok = Math.max(maxTok, tok);
    if (tok > MAX_TOKENS) throw new Error(`row over ${MAX_TOKENS} tokens (${tok})`);
  }
  const g = rng(seed + 99);
  const shuffled = all.map((x) => [g(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const nEval = Math.round(shuffled.length * 0.05);
  const evalRows = shuffled.slice(0, nEval);
  const trainRows = shuffled.slice(nEval);
  const dir = path.join(root, "training");
  fs.mkdirSync(dir, { recursive: true });
  const dump = (rows) => rows.map((r) => JSON.stringify({ messages: r.messages })).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "lolcoach_train.jsonl"), dump(trainRows));
  fs.writeFileSync(path.join(dir, "lolcoach_eval.jsonl"), dump(evalRows));
  const champs = new Set(all.flatMap((r) => [...r.messages[1].content.matchAll(/YOU (\S+(?: \S+)?) [L(]/g)].map((m) => m[1])));
  const stats = {
    ddragon: S.DDRAGON_VERSION,
    callouts: callouts.length,
    summaries: summaries.length,
    champSelect: champ.length,
    train: trainRows.length,
    eval: evalRows.length,
    policyRejectedCandidates: rejected,
    maxEstTokens: maxTok,
    distinctChampionsAsYou: champs.size,
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats, null, 2) + "\n");
  console.log(stats);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
