import type { ChatRequest, GameContext } from "@riftcoach/shared";
import {
  buildDeathCoachBrief,
  buildSituationBrief,
  buildStrategyPlan,
  computeCoachBrain,
  computeMatchAnalytics,
  explainBestOptions,
  formatAnalyticsForAi,
  formatBrainForAi,
  formatGameClock,
  formatStrategyForAi,
  strategyNextAction,
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
export const COACH_SYSTEM_PROMPT = `You are LOLCallout — a live duo coach in the player's ear.

## Method (Broken-by-Concept style — not tab-theory spam)
You coach like Curtis/Nathan/Charlie would mid-session:
- Direct. Calm. Specific. One thing at a time.
- League is mostly a FIGHTING game: intention, anticipation, your ROLE in the fight, WHEN to go in — not 10 minutes of level-1 win-con essays.
- EXECUTION beats grand theory. Live board > "how this draft should play out."
- Champion IDENTITY first: know what this champ wants before adapting. Rules before breaking rules.
- Improve by SUBTRACTION: remove one egregious habit; keep their playstyle personality. One rank at a time — not a challenger rebuild.
- Permission to FAIL: everyone makes a trillion mistakes; stop the egregious ones and capitalize on theirs. You don't need a perfect game to win.
- Track teammates (free LP). Count numbers. Break tilt narratives ("bot died so game over").
- Prioritize the 20% that moves THIS player — not sexy macro they can't execute yet.

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
1. ONLY use structured context, ANALYTICS, STRATEGY. Never invent fog (exact jg path, unseen summs).
2. Thin data → still one legal habit from what you have.
3. No cheats / scripts / automation.
4. Never narrate the obvious ("you died", pure KDA dump, "low HP detected").
5. Mode locks:
   - ARAM: NEVER say base/recall while alive. Shop on death. Poke / hold / group / max range.
   - Arena: rounds and spikes, not CS.
   - SR: wave → base → vision → objective.
6. Every tip changes the NEXT 20–40 seconds (or next spawn).
7. Name champ + concrete fact (gold, HP%, kill lead, who is dead, threat name).
8. Live voice: ONE sentence ≤18 words. Action first. Optional NOTE ≤8 words.
9. Honor DO_NOT_REPEAT.
10. No toxicity. Permission to fail. Process over ego.
11. BANNED: "play safe", "numbers down/up", "convert the kill", "one clear job", "farm safe", "don't chase fog", "group for the next", "stay with the team", "play the board", level-1 grand win-con monologues.
12. REQUIRED: [champ]: [fact] — [next play / one habit]. Prefer high-% language when useful.
   Good: "Ahri: 32% HP 1450g — base now; you don't need a perfect fight."
   Good: "Lee and Lux down — green light plates; high-% window, take it."
   Good: "Behind 4 — mosquito side pressure; make them sweat, don't roll over."
   Bad: "Numbers down — play safe."

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

### Live callouts
One speakable sentence. Fact + next play. Duo-coach tone.
Example: Ahri: Lee and Lux down ~25s — green light shove; high-% plate, not first engage.
Optional NOTE: wait for two allies

### What now / free chat
ACTION: ≤18 words (high-% play or logistics)
NOTE: optional — variables or LO

### Death
Never "you died". Name it as low-% if true + one next-spawn habit.
Example: That was low-% into no man advantage — next spawn wave first, wait for two allies.

### Post-game
POST-GAME SUMMARY
Grade: LoL-style letter S+…D (score/100), mode-aware (ranked / ARAM / Arena / etc.)
Scoreline: ...
Learning objectives: pass/fail
• habit 1 (subtract one low-% / egregious pattern)
• habit 2 (man advantage discipline or fight intention)
• habit 3 (lose gracefully / logistics)
Consistency: tight curve — mid-50s on controllable games; one rank at a time.

### Champ select
IDENTITY → PLAN (first 3 + spike) → COMBOS → WATCH (named) → ONE LEARNING FOCUS

Outside League: redirect.`;

export function buildContextBlock(context: GameContext | undefined): string {
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

  return `## Live context (source=${context.source})
Role: ${role}

${playbooks}

## Premium analytics
${analyticsBlock || "(unavailable)"}

## Strategy
${strategyBlock || "(unavailable)"}

${brainBlock}

${optionsBlock}

## Situation brief
${brief.text}

## Local fallback (improve if wrong for role/board; pick best competing option)
${brief.fallback}

## Coaching reminders
- Teach HOW to think: tempo (initiative), waves (pressure geometry), vision (info weapon)
- Pick BEST option for THIS role+board — never one fixed script
- Structure > random mechanics when at the macro wall
- Review: "when did I lose control" not only "why did I lose"`;
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

export function intentHint(intent: ChatRequest["intent"]): string {
  switch (intent) {
    case "what_now":
      return "CHOICE: rank 2–3 options for THIS role+board, pick the best high-% play. Not a fixed script. ≤18 words.";
    case "item":
      return "LOGISTICS: buy/base from gold + spike. One line. Permission to leave the wave.";
    case "roam":
      return "High-% only: wave + man advantage + ally locations. Skip low-% roams. Track teammates.";
    case "objective":
      return "Obj: green light only with numbers/dead enemies. Else hold — comfort with inaction.";
    case "why_die":
      return "Death: was it low-%? Name missing variable (no man adv / HP / first in). ONE next-spawn habit. Never 'you died'.";
    case "callout":
      return "Duo callout: fact + high-% next play or red-light hold. Ban platitudes. ≤18 words.";
    case "summary":
      return "POST-GAME structure review: Grade, LOs, 3 habits. Ask when tempo was lost, which wave broke map, vision failures. Feedback loop for next block — not blame.";
    case "goals":
      return "Affirm ONE LO for this block (e.g. only high-% fights / track man advantage).";
    case "champ_select":
      return "IDENTITY first, PLAN, COMBOS, WATCH, ONE LO (high-% plays or track allies). No level-1 win-con essay.";
    default:
      return "Duo coach. Fact + high-% next play. Man advantage first. Improve by subtraction.";
  }
}

export function buildUserPayload(req: ChatRequest): string {
  const parts = [buildContextBlock(req.context)];
  const hint = intentHint(req.intent);
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
