import type { GameMode } from "@riftcoach/shared";

export type InferredRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT" | "ARAM" | "ARENA" | "UNKNOWN";

/** Mode-level coaching personality */
export function modePlaybook(mode: GameMode, mapName?: string): string {
  const map = (mapName || "").toLowerCase();
  if (mode === "ARAM" || map === "map12") {
    return `## Mode playbook: ARAM
- Prioritize teamfight timing, cooldowns, and not inting side alone.
- Respect thrall/cannon waves; don't greed for one more spell if team is dead.
- Buy wisely between fights; stop sitting on full gold.
- Call FIGHT / RESET / HOLD more than "roam" or "ward river".`;
  }
  if (mode === "OTHER" && (map.includes("arena") || map === "map30")) {
    return `## Mode playbook: Arena
- Think in rounds: don't greed a bad fight when round is winnable later.
- Item/augment spikes matter more than CS.
- Short callouts: FIGHT, BAIT, RESET, PLAY FOR NEXT ROUND.`;
  }
  if (mode === "CLASSIC" || map === "map11") {
    return `## Mode playbook: Summoner's Rift
- Wave state, gold efficiency, and objective windows drive decisions.
- Never invent fog or enemy jungle path — only use provided stats/events.
- Prefer BASE / SHOVE / HOLD / GROUP / DROP / WARD language.`;
  }
  if (mode === "URF") {
    return `## Mode playbook: URF
- Cooldowns are short; spacing and summs still matter. Keep callouts ultra short.`;
  }
  return `## Mode playbook: General League
- Keep advice mode-aware from the labeled game mode when possible.`;
}

/** Lightweight class/role heuristics for common champs */
const ROLE_HINTS: Record<string, InferredRole> = {
  // common mids
  ahri: "MID",
  zed: "MID",
  syndra: "MID",
  orianna: "MID",
  yasuo: "MID",
  yone: "MID",
  akali: "MID",
  katarina: "MID",
  aurelionsol: "MID",
  // adcs
  jinx: "ADC",
  caitlyn: "ADC",
  jhin: "ADC",
  kaisa: "ADC",
  "kai'sa": "ADC",
  ezreal: "ADC",
  ashe: "ADC",
  // supports
  thresh: "SUPPORT",
  lulu: "SUPPORT",
  nami: "SUPPORT",
  milio: "SUPPORT",
  nautilus: "SUPPORT",
  // junglers
  leesin: "JUNGLE",
  "lee sin": "JUNGLE",
  viego: "JUNGLE",
  kindred: "JUNGLE",
  graves: "JUNGLE",
  // tops
  aatrox: "TOP",
  darius: "TOP",
  sett: "TOP",
  camille: "TOP",
  gnar: "TOP",
};

export function inferRole(
  championName: string | undefined,
  mode: GameMode,
  creeps?: number,
  gameTime?: number
): InferredRole {
  if (mode === "ARAM") return "ARAM";
  const key = (championName || "").toLowerCase().replace(/[^a-z']/g, "");
  if (ROLE_HINTS[key]) return ROLE_HINTS[key];
  // CS heuristic late enough
  if (gameTime && gameTime > 300 && creeps != null) {
    const cspm = creeps / (gameTime / 60);
    if (cspm < 3.5) return "SUPPORT";
    if (cspm < 5.5) return "JUNGLE";
  }
  return "UNKNOWN";
}

export function rolePlaybook(role: InferredRole): string {
  switch (role) {
    case "MID":
      return `## Role playbook: MID (elite)
- Wave is your map permission: crash before base/roam; freeze when weak.
- Track side numbers — mid deaths create free roam or free punish.
- After first item: side wave + mid prio, not random river.
- Fight role: usually secondary engage / pick — not first into frontline.
- Convert: plates on enemy mid death; rotate only with crash.`;
    case "ADC":
      return `## Role playbook: ADC (elite)
- DPS windows and spacing > greedy CS under threat.
- Never face-check; your job is damage after team creates space.
- Mid-game: share sides, group for obj with max-range angle.
- When numbers green: your convert is tower/obj DPS, not chase.
- When red: nearest safe wave — don't mid 1v2.`;
    case "SUPPORT":
      return `## Role playbook: SUPPORT (elite)
- Crash → vision → move. Idle bot is a wasted map.
- Peel vs dive threats; engage only if kit + follow-up.
- Deep wards only when team can punish the face-check.
- Green light: ward pit/river then free side with carry.
- Red light: near vision only — no grief deep.`;
    case "JUNGLE":
      return `## Role playbook: JUNGLE (elite)
- You set the pulse: camps tempo → high-% looks → obj setup.
- Never invent pathing. Scoreboard + events only.
- Green light: YOU start obj; allies crash waves into it.
- Red light: opposite camps; skip river contest.
- Ganks only on shoved lanes or guaranteed numbers.`;
    case "TOP":
      return `## Role playbook: TOP (elite)
- Wave + TP windows. Don't 1v2 grief.
- Track bot/mid deaths for TP angles (when legal info allows).
- Ahead: side pressure that draws two — not ego chase.
- Behind: farm under tower; only high-% holds.
- Green: plates then base if gold high.`;
    case "ARAM":
      return `## Role playbook: ARAM fighter
- Don't int side alone after a won fight.
- Buy between skirmishes; hold for team cooldowns.`;
    case "ARENA":
      return `## Role playbook: Arena
- Round economy and spikes; pick fights you can finish.`;
    default:
      return `## Role playbook: Flexible
- Infer role from champion and CS when unclear; keep advice general but specific to stats.`;
  }
}

/** Short champ archetypes — extend over time */
const CHAMP_NOTES: Record<string, string> = {
  ahri: "Mobile mage assassin: charm windows, side angle, don't blow ult to greed one kill.",
  zed: "Assassin: pick isolated targets; if behind, farm to item spike — no 1v3 shadows.",
  jinx: "Hypercarry: reset fights, max range, don't face-check. DPS after team engages.",
  thresh: "Playmaking support: hook angles, lantern saves, don't int for style points.",
  leesin: "Early tempo jungler: gank windows early, scale via objectives not forced 1v9.",
  sett: "Juggernaut: short trades with W, side pressure, flash-W threats in fights.",
  orianna: "Orianna: ball is the play. Shockwave with team, not alone.",
  caitlyn: "Lane bully ADC: plate pressure, trap zones, late game max range.",
  yasuo: "Melee carry: only go in with knockups/team; windwall value > ego dashes.",
  lux: "Artillery: snare root combos, don't stand mid wave. Ult cleanup not openers always.",
  aurelionsol:
    "Asol: stack Q, long-range poke. Never melee range. Ult for disengage or pick. Support item: roam/enable.",
  gragas: "Gragas: short belly trades, save E for engage or disengage.",
  belveth: "Bel'Veth: stack on camps and waves, take over sides after form.",
  jhin: "Jhin: fourth shot windows, trap zones, don't face-check.",
  nami: "Nami: bubble engages, empower ADC, roam on wave crash.",
  zyra: "Zyra: plant zones, max range, don't face-check brush.",
  garen: "Garen: short spin trades, silence all-ins, side pressure when fed.",
  teemo: "Teemo: shroom zones, blind windows, don't overstay invades.",
};

export function champPlaybook(championName: string | undefined): string {
  if (!championName) return "";
  const key = championName.toLowerCase().replace(/[^a-z']/g, "");
  const note = CHAMP_NOTES[key];
  if (!note) {
    return `## Champion: ${championName}
- No curated playbook yet — coach from role + live stats. Still say the champion name in advice.`;
  }
  return `## Champion playbook: ${championName}
${note}`;
}

export function buildPlaybookBlock(opts: {
  mode: GameMode;
  mapName?: string;
  championName?: string;
  creeps?: number;
  gameTime?: number;
  roleOverride?: InferredRole;
}): string {
  const role =
    opts.roleOverride ||
    inferRole(opts.championName, opts.mode, opts.creeps, opts.gameTime);
  return [
    modePlaybook(opts.mode, opts.mapName),
    rolePlaybook(role),
    champPlaybook(opts.championName),
    `## Inferred role: ${role}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
