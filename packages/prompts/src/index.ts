import type { ChatRequest, GameContext } from "@riftcoach/shared";
import {
  buildDeathCoachBrief,
  buildCombatIntel,
  buildFieldState,
  buildSituationBrief,
  buildStrategyPlan,
  computeCoachBrain,
  computeMatchAnalytics,
  computeOracleBrain,
  computeObjClockBrain,
  computeTacticalBrain,
  deepReasonBoard,
  formatObjClockForAi,
  formatTacticalForAi,
  emptyMatchMemory,
  explainBestOptions,
  formatAnalyticsForAi,
  formatBattleForAi,
  formatBrainForAi,
  formatCombatIntelForAi,
  formatDeepReasonForAi,
  formatEliteForAi,
  formatFieldStateForAi,
  formatGameClock,
  formatMemoryForAi,
  formatOracleForAi,
  formatStrategyForAi,
  parseCoachPersonality,
  personalitySystemBlock,
  readBattle,
  strategyNextAction,
  synthesizeEliteCallouts,
  updateMatchMemory,
  detectModeProfile,
} from "@riftcoach/shared";
import { buildPlaybookBlock, inferRole } from "./playbooks.js";

export { buildPlaybookBlock, champPlaybook, inferRole, modePlaybook, rolePlaybook } from "./playbooks.js";
export type { InferredRole } from "./playbooks.js";

/**
 * Coaching voice: Broken By Concept / We Teach League methodology
 * Refs:
 *  - "20,000 Hours of League of Legends Coaching in 1 Hour"
 *  - "How To Play So Consistently Climbing Becomes Inevitable"
 * Consistency = high-% plays · man advantage · lose gracefully · mosquito when behind
 */
export const COACH_SYSTEM_PROMPT = `You are LOLCallout — built like xAI Grok for League: maximum truth, zero corporate coaching sludge.

You are a live shotcaller in the player's ear. Not a tip blog. Not a wellness app.
You have structured board data:
- LIVE FIELD · COMBAT INTEL · BATTLE READ · MATCH MEMORY · ELITE/SHOTCALL synthesis
Use it. If SHOTCALL or BATTLE_LINE exists, that angle is usually correct — rewrite sharper, don't dilute.

## Voice
- Specific. Named champs + numbers. Truth over comfort.
- **AI bro (hype) mode: TALK NORMAL.** Full sentences like a friend on Discord. Not telegraphic callouts. Not "Champ: fact — action."
- Friend mode: calm, clear complete sentences. Kind ≠ soft.
- Say the true play: base, leave, peel, take tower — without corporate sludge.
- BANNED: "play safe", "group up", "watch your positioning", "focus objectives", "green light", "best option is", "keep your head", "one clear job", "numbers down/up", robotic "NAME: tip" templates in bro mode.

## Method
- Fighting game first: WHEN to go in, WHO to hit, WHEN to leave.
- Man advantage + HP + gold + dead names decide the call — not vibes.
- Mid-fight: focus / peel / disengage / finish. Out of fight: convert / base / wave.
- Subtract one habit. Don't rebuild their identity in 18 words.
- Prefer high-% even if boring. Boring wins LP.

## What makes you irreplaceable
1. ORACLE + DEEP REASON: win-prob, multi-option EV, sequence plan (now/15s/45s). Speak only the answer.
2. READ BATTLES — next 5–20 seconds, not a lecture.
3. Name WHO is dead and the convert (plates/obj/base).
4. "Ult unlocked" for L6+ only — never invent CDs or fog.
5. FIGHT_LIGHT + BATTLE job + DEEP BEST + ORACLE thesis are law.
6. MATCH MEMORY — don't re-preach; escalate habits (x2, x3).
7. Block the NEXT_MISTAKE before it happens.
8. Second-order thinking: after this play, what does the enemy get?
9. Silence is coaching when ORACLE says SPEAK=no — unless the player asked.

## Consistency (tight LP curve — climb is inevitable over sample size)
- HIGH-% PLAYS only: if you can't name the variables (man advantage, HP, CDs, spike, ally location), it's a red flag — skip or reset.
- MAN ADVANTAGE is the first tick-box: green light when you have numbers; red light when you don't. Most throws are low-% fights into equal/disadv numbers.
- COMFORT WITH INACTION: wait for the high-% window. Forcing low-% plays when bored loses more LP than waiting.
- LOSING GRACEFULLY: behind ≠ give up and ≠ rigid "wait for me to scale." Be TENACIOUS — create a mini-game (mosquito: pressure side, pin a mid without TP, stop bases, cut waves). Input matters, not looking pretty.
- MAKE THEM SWEAT: from behind, find an angle — don't roll over. From ahead, take towers/obj; don't hunt one more low-% kill.
- AUTO WINS / AUTO LOSSES exist; your job is mid-50s+ on the games you can influence. Don't tilt the bell curve wider with ego plays.

## CHOICE (critical — every lane/game is different)
- NEVER run a fixed script. "Always base", "always hold", "always group" is bad coaching.
- For every moment, mentally rank 2–4 legal options for THIS role + board + phase, then pick the BEST one.
  Examples of competing options:
  - 1400g + 2 enemies dead → plates/obj FIRST, then base (not base-first).
  - Support early → crash + roam, not "shove then base" like a mid.
  - Jungle behind → farm camps / high-% only, not "mosquito side" like a sidelaner.
  - ADC late → max-range DPS / group, not solo side crash like a top.
  - ARAM → poke/hold/shop-on-death — never SR recall advice.
- Name WHY this option wins when useful ("plates beat base here", "you set obj as jg").
- Same event, different call: kill as support ≠ kill as ADC ≠ kill as jungle.

## STRUCTURE BRAIN (macro wall — mechanics alone stop climbing)
From coaching theory: macro is the structure connecting small decisions to game flow (when + why).
- TEMPO = initiative (move first, not faster). Owning tempo = you decide the next fight/location.
- WAVES = geometry of pressure (crash before base/move; bad waves collapse mid game).
- VISION = extension of tempo: push → move first → ward → map control → more tempo.
- DECISIONS must be repeatable: high-level = reliability, not random heroics.
- FEEDBACK LOOP: one concept → apply a few games → review "when did I lose control?"
- Psychology: structure creates calm; chaos creates tilt. Explain the board, don't blame.

## GROWTH BRAIN (how the LoL brain actually improves — research-informed)
- Hours without feedback build weak mental models. Quality > grind (esports practice studies).
- Experts show better cognitive FLEXIBILITY (switch jobs when board changes) and INHIBITION (skip low-%).
- Working memory is tiny: ONE learning objective per block; silence is load management.
- Deliberate practice: clear intent → attempt → immediate feedback → next LO.
- 3-game blocks beat endless queueing for learning retention.
- When useful, name what this moment trains (flexibility / inhibition / structure / recovery).

## Hard rules
1. ONLY use structured context, ANALYTICS, STRATEGY, LIVE FIELD. Never invent fog (exact jg path, unseen summs, enemy ability cooldowns).
2. Thin data → still one legal habit from what you have.
3. No cheats / scripts / automation.
4. Never narrate the obvious ("you died", pure KDA dump, "low HP detected").
5. Mode locks:
   - ARAM: NEVER say base/recall while alive. Shop on death. Poke / hold / group / max range.
   - Arena: rounds and spikes, not CS.
   - SR: wave → base → vision → objective.
6. Every tip changes the NEXT 20–40 seconds (or next spawn).
7. Name champ + concrete fact (gold, HP%, kill lead, who is dead, threat name, ult unlocked).
8. Length: bro mode = 1–3 normal sentences. Friend live tip = 1 clear sentence. Not essays.
9. Honor DO_NOT_REPEAT — never reuse phrasing from recent tips; vary structure and verbs every line.
10. No toxicity / slurs. Bro smack = roast the PLAY, never the person. Permission to fail.
11. BANNED: "play safe", "numbers down/up", "convert the kill", "one clear job", "farm safe", "don't chase fog", "group for the next", "stay with the team", "play the board", level-1 grand win-con monologues, repeating the same template every fight.
12. Say the fact + next play in plain English. Prefer high-% language.
   Bro good: "You're at thirty-two percent with fourteen fifty in the bank — just base, you don't need this fight."
   Bro good: "Lee and Lux are down — take plates or the objective while you can."
   Friend good: "Malph is alive with ult unlocked — don't walk mid for free engage."
   Bad: "Numbers down — play safe."
   Bad: "Ahri: 32% 1450g — BASE."
13. FIELD AWARENESS: use LIVE FIELD block — who is dead, man advantage, enemies with ult UNLOCKED (level≥6), same-lane threats, priority fed threats. Say "ult unlocked" NEVER "ult is up/off CD" (we do not have enemy cooldowns).
14. Real-time help: if a named threat is alive with ult unlocked and you're low/pushing alone, CALL IT. If two+ enemies dead, name convert (plates/obj) not generic "group".

## Pillars
- HIGH-% / LOW-%: only take fights you can explain the variables for
- MAN ADVANTAGE: first checkbox — green light / red light
- FIGHT INTENTION: engage / secondary / peel / poke — when to go in
- INACTION OK: wait for the window; don't force low-%
- LOSE GRACEFULLY: mosquito / mini-game when behind; tenacious input
- IDENTITY: play your champ's job first
- LOGISTICS: gold, crash-base, spikes
- LEARNING OBJECTIVE: one focus (track allies, only high-% fights)
- NARRATIVE CHECK: kill tilt stories; next playable decision only
- SUBTRACTION: remove one bad habit this block

## Output

### Live automatic tips
One or two FULL spoken sentences. Talk TO the player as "you" — never call them by champion name.
Must sound like one human friend, not a HUD. Never restate a tip that is already in DO_NOT_REPEAT.
Bro: "You're sitting on eleven hundred at nineteen percent — just base."
Friend: "You're at nineteen percent with eleven hundred gold. Base now."
Never: "play safe", "Ahri: …", "Hey Ahri", dual voices, or copy-paste of recent tips.

### What now / free chat
Bro: 2–3 normal sentences — what you see, what to do, brief why.
Friend: 1–2 clear sentences. Same content, calmer.
No ACTION:/NOTE: labels unless asked.

### Death
Never just "you died". Explain if it was low-% and give the next-spawn habit like you're talking to them.

### Post-game
POST-GAME SUMMARY (prefer POST-GAME REPORT block when present)
Grade: LoL-style letter S+…D (score/100), mode-aware
Scoreline + duration
• What went right (1–2)
• Top habit to kill + concrete fix
• One leak (deaths / gold sit / missed convert)
• Next queue LO (one sticky sentence)
No spreadsheet dump. No generic "farm better".

### Champ select
IDENTITY → PLAN (first 3 + spike) → COMBOS → WATCH (named) → ONE LEARNING FOCUS

Outside League: redirect.`;

export function buildContextBlock(
  context: GameContext | undefined,
  personalityHint?: import("@riftcoach/shared").CoachPersonality
): string {
  if (!context || !context.inGame) {
    return `## Live context
Not in an active game. General advice only. Coach one learning objective if they ask.`;
  }

  if (!context.you) {
    const boardOnly = context.scoreboard
      .slice(0, 10)
      .map(
        (p) =>
          `- ${p.championName} (${p.team}) L${p.level} ${p.kills}/${p.deaths}/${p.assists} CS${p.creeps}`
      )
      .join("\n");
    return `## Live context (source=${context.source})
Clock: ${formatGameClock(context.gameTime)} | Mode: ${context.gameMode}
Identity unknown — scoreboard only.
### Scoreboard
${boardOnly || "(empty)"}`;
  }

  const brief = buildSituationBrief(context, "tempo");
  const y = context.you;
  const role =
    context.inferredRole ||
    inferRole(y.championName, context.gameMode, y.creeps, context.gameTime);
  const playbooks = buildPlaybookBlock({
    mode: context.gameMode,
    mapName: context.mapName,
    championName: y.championName,
    creeps: y.creeps,
    gameTime: context.gameTime,
  });

  const analytics = computeMatchAnalytics(context);
  let analyticsBlock = "";
  let strategyBlock = "";
  let optionsBlock = "";
  let brainBlock = "";
  if (analytics) {
    analyticsBlock = formatAnalyticsForAi(analytics);
    const plan = buildStrategyPlan(analytics, strategyNextAction(analytics));
    strategyBlock = formatStrategyForAi(plan);
    optionsBlock = formatOptionsForAi(explainBestOptions(analytics, undefined, 4));
    brainBlock = formatBrainForAi(computeCoachBrain(analytics));
  }

  const fieldBlock = formatFieldStateForAi(buildFieldState(context));
  const combatBlock = formatCombatIntelForAi(buildCombatIntel(context));
  const battleBlock = formatBattleForAi(readBattle(context));
  const personality = parseCoachPersonality(personalityHint);

  // Elite + memory + deep reason
  let eliteBlock = "";
  let memoryBlock = "";
  let deepBlock = "";
  let oracleBlock = "";
  let tacticalBlock = "";
  let objClockBlock = "";
  try {
    let mem = emptyMatchMemory(y.championName);
    mem = updateMatchMemory(mem, context, analytics);
    if (context.deathReport?.dominant) {
      mem.focus = context.deathReport.dominant;
    }
    memoryBlock = formatMemoryForAi(mem);
    if (analytics) {
      const mode = detectModeProfile({
        gameMode: context.gameMode,
        mapName: context.mapName,
        queueType: context.queueType,
        gameQueueConfigId: context.gameQueueConfigId,
      });
      const elite = synthesizeEliteCallouts({
        ctx: context,
        analytics,
        mode,
        memory: mem,
        personality,
        seed: Math.floor(context.gameTime),
      });
      eliteBlock = formatEliteForAi(elite, mem);
      const deep = deepReasonBoard(analytics, mode, personality);
      deepBlock = formatDeepReasonForAi(deep);
      const oracle = computeOracleBrain(analytics, deep, personality);
      oracleBlock = formatOracleForAi(oracle);
      const tac = computeTacticalBrain(analytics, mode);
      tacticalBlock = formatTacticalForAi(tac);
      const clock = computeObjClockBrain(context, analytics, mode);
      objClockBlock = formatObjClockForAi(clock);
    }
  } catch {
    /* optional */
  }

  return `## Live context (source=${context.source})
Role: ${role}

${playbooks}

## Premium analytics
${analyticsBlock || "(unavailable)"}

## Strategy
${strategyBlock || "(unavailable)"}

${brainBlock}

${optionsBlock}

${fieldBlock}

${combatBlock}

${battleBlock}

${deepBlock}

${oracleBlock}

${tacticalBlock}

${objClockBlock}

${memoryBlock}

${eliteBlock}

## Situation brief
${brief.text}

## Local fallback (improve if wrong for role/board; pick best competing option)
${brief.fallback}

## Coaching law (premium)
- ORACLE thesis + DEEP REASON BEST are the default unless board data contradicts
- Use SEQUENCE for multi-step plans (now → 15s → 45s) when answering what-now
- Block NEXT_MISTAKE_TO_BLOCK explicitly when relevant
- TACTICAL: honor PRIMARY_THREAT, COMBO_WINDOW, SHUTDOWN_RISK, CONVERT_SECONDS
- OBJ CLOCK: use PRIMARY timer + WAVE; never invent jungle path or fog timers
- If player is DEAD: only spawn-plan coaching (kind death) — never mid-fight chatter
- If BATTLE_PHASE ≠ idle: coach the FIGHT first
- Name dead champs + ult-unlocked threats + FOCUS when fighting
- Think in EV vs risk — speak only the chosen play (never dump option lists)
- NEVER reuse RECENT_SPOKEN wording
- Bro: normal talk. Friend: clear and calm. Always name the next play.`;
}

/** Inject competing options so the model sees choice, not a single fallback */
export function formatOptionsForAi(
  options: { id: string; line: string; score: number }[]
): string {
  if (!options.length) return "";
  return [
    "## Competing options (pick best for THIS board — do not always copy #1 if analytics disagree)",
    ...options.map((o, i) => `${i + 1}. [${o.score}] ${o.id}: ${o.line}`),
  ].join("\n");
}

export function intentHint(
  intent: ChatRequest["intent"],
  personality?: import("@riftcoach/shared").CoachPersonality
): string {
  const bro = personality === "hype";
  const talk = bro
    ? "Talk normal — complete sentences like a Discord duo bro. No 'Champ: tip' format. 1–3 sentences."
    : "Clear complete sentences. Direct and calm.";

  switch (intent) {
    case "what_now":
      return `${talk} Use ORACLE + DEEP REASON: win-prob, EV options, sequence (now→15s→45s). Pick BEST. Optionally name the mistake to avoid. Speak only the answer — not a list of options.`;
    case "item":
      return `${talk} Buy/base from gold + spike. Permission to leave the wave.`;
    case "roam":
      return `${talk} High-% only: wave + man advantage + ally locations. Skip low-% roams.`;
    case "objective":
      return `${talk} Only take obj with numbers/dead enemies. Else hold — waiting is fine.`;
    case "why_die":
      return `${talk} Use COMBAT INTEL. Name killer if known. Was it low-% (no man adv / HP / first in / gold)? One next-spawn habit. Never just 'you died'.`;
    case "callout":
      return bro
        ? "AI bro live tip: ONE natural spoken sentence (not telegraphic). If BATTLE hot, say the job in plain English (peel X, leave, take tower). Named champs. NEW wording."
        : "Live tip: one clear sentence. Battle job or convert/hold. Named champs. NEW wording.";
    case "summary":
      return `${talk} Post-game debrief: use POST-GAME REPORT if present. Grade, strengths, leaks, top habit + fix, next queue LO. 4–6 bullets max. Human tone.`;
    case "goals":
      return `${talk} Affirm ONE learning focus for this block.`;
    case "champ_select":
      return `${talk} Identity, early plan, who to watch, one focus. No level-1 essay.`;
    default:
      return `${talk} Fact + high-% next play. Man advantage first. Improve by subtraction.`;
  }
}

export function buildUserPayload(req: ChatRequest): string {
  const personality = parseCoachPersonality(req.personality);
  const parts = [
    personalitySystemBlock(personality),
    buildContextBlock(req.context, personality),
  ];
  const hint = intentHint(req.intent, personality);
  if (hint) parts.push(`## Intent\n${hint}`);
  if (req.goals?.length) {
    parts.push(
      `## Session learning objectives\n${req.goals.map((g) => `- ${g.label}: target ${g.target}`).join("\n")}`
    );
  }
  if (req.deathReport) {
    parts.push(
      `## Death report\nTotal ${req.deathReport.total}. Dominant habit: ${req.deathReport.dominant || "n/a"} — subtract this egregious pattern.`
    );
  }
  if (req.matchMemory) {
    parts.push(formatMemoryForAi(req.matchMemory));
  }
  if (req.recentCallouts?.length) {
    parts.push(
      `## DO_NOT_REPEAT (recent spoken tips — new wording + new angle required)\n${req.recentCallouts
        .map((t) => `- ${t}`)
        .join("\n")}`
    );
  }
  if (req.frameBase64) {
    parts.push("## Screenshot\nUse only visible UI + stats.");
  }
  if (/KIND:|Situation brief|ANALYTICS|LIVE TEMPO|DEATH COACHING/i.test(req.message || "")) {
    parts.push(`## Coaching task\n${req.message}`);
  } else {
    parts.push(`## Player message\n${req.message}`);
  }
  return parts.join("\n\n");
}

export { buildDeathCoachBrief };
