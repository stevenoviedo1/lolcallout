/** Shared types for RiftCoach desktop, agent, and API. */

export type GameMode = "CLASSIC" | "ARAM" | "URF" | "ARENA" | "OTHER" | "UNKNOWN";

export type AgentStatus = "idle" | "in_game" | "mock" | "error";

export type CalloutSeverity = "info" | "warn" | "urgent";

export type CalloutKind =
  | "death"
  | "base"
  | "low_hp"
  | "objective"
  | "level_up"
  | "game_end"
  | "shutdown"
  | "tempo"
  | "kill"
  | "match_start"
  | "numbers"
  | "generic";

export interface PlayerScoreline {
  riotIdGameName?: string;
  championName: string;
  team: "ORDER" | "CHAOS" | "UNKNOWN";
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  gold?: number;
  isBot?: boolean;
  isDead?: boolean;
  summonerSpells?: string[];
  items?: string[];
  /** Live Client role/lane string when present (TOP, JUNGLE, …) — not map coords */
  laneRole?: string;
}

export interface AbilityLevels {
  Q?: number;
  W?: number;
  E?: number;
  R?: number;
}

export interface ActiveYou {
  championName: string;
  level: number;
  currentGold: number;
  totalGold?: number;
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  currentHealth?: number;
  maxHealth?: number;
  currentMana?: number;
  maxMana?: number;
  summonerSpells?: string[];
  items?: string[];
  isDead?: boolean;
  /** Live Client role/lane when present */
  laneRole?: string;
  /** Your ability ranks from Live Client (enemy CDs never available legally) */
  abilityLevels?: AbilityLevels;
}

export interface GameEvent {
  type:
    | "GAME_START"
    | "GAME_END"
    | "DEATH"
    | "LEVEL_UP"
    | "ITEM_CHANGE"
    | "DRAGON"
    | "BARON"
    | "HERALD"
    | "TURRET"
    | "OTHER";
  gameTime: number;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface GameContext {
  source: "live" | "mock" | "none";
  inGame: boolean;
  gameTime: number;
  gameMode: GameMode;
  mapName?: string;
  /** Queue type / config if Live Client or LCU exposes it (ranked vs normal) */
  queueType?: string;
  gameQueueConfigId?: number;
  you: ActiveYou | null;
  scoreboard: PlayerScoreline[];
  recentEvents: GameEvent[];
  updatedAt: string;
  /** Inferred or LCU role */
  inferredRole?: string;
  /** Death pattern summary for coach */
  deathReport?: {
    total: number;
    early: number;
    mid: number;
    late: number;
    dominant: string | null;
  };
}

export interface ChampSelectState {
  active: boolean;
  myChampion?: string;
  myChampionId?: number;
  assignedPosition?: string;
  allies?: string[];
  enemies?: string[];
  bans?: string[];
  message?: string;
  updatedAt: string;
}

/** Local agent → UI signal for proactive coaching */
export interface DetectedSignal {
  id: string;
  kind: CalloutKind;
  severity: CalloutSeverity;
  gameTime: number;
  title: string;
  detail?: string;
  /** Hint for coach prompt */
  coachPrompt: string;
  /** Local rule-based spoken line when AI fails — never pure narration */
  spokenFallback?: string;
  createdAt: string;
}

export type ChatRole = "user" | "assistant" | "system" | "callout";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface CoachSession {
  id: string;
  createdAt: string;
  endedAt?: string;
  champion?: string;
  mode?: GameMode;
  result?: "win" | "loss" | "unknown";
  title?: string;
  /** True once a real live match was tracked (not empty/UI restarts) */
  isMatch?: boolean;
  /** Peak game clock seen (seconds) */
  maxGameTime?: number;
  /** live | mock | mixed */
  dataSource?: "live" | "mock" | "unknown";
  messageCount?: number;
}

export interface SessionSummary {
  sessionId: string;
  bullets: string[];
  focusAreas: string[];
  scoreline?: string;
  createdAt: string;
  raw?: string;
}

export interface CreateSessionRequest {
  deviceId?: string;
  champion?: string;
  mode?: GameMode;
}

export interface CreateSessionResponse {
  session: CoachSession;
}

export interface PushContextRequest {
  context: GameContext;
}

export interface ChatRequest {
  message: string;
  context?: GameContext;
  intent?:
    | "what_now"
    | "item"
    | "roam"
    | "objective"
    | "why_die"
    | "callout"
    | "summary"
    | "goals"
    | "champ_select"
    | "free";
  /** Optional JPEG/PNG base64 (no data: prefix) for vision */
  frameBase64?: string;
  frameMime?: string;
  goals?: import("./goals.js").SessionGoal[];
  deathReport?: import("./deaths.js").DeathPatternReport;
  /** friend = supportive duo · hype = funny praise + smack */
  personality?: import("./personality.js").CoachPersonality;
  /** Recent spoken lines — model must not repeat */
  recentCallouts?: string[];
  /** Optional sticky match memory from client */
  matchMemory?: import("./matchMemory.js").MatchMemory;
}

export interface CalloutRequest {
  signal: DetectedSignal;
  context?: GameContext;
  personality?: import("./personality.js").CoachPersonality;
  recentCallouts?: string[];
  matchMemory?: import("./matchMemory.js").MatchMemory;
}

export interface AgentStatusResponse {
  status: AgentStatus;
  message: string;
  mock: boolean;
  context: GameContext;
  /** New signals since last poll (agent keeps short buffer) */
  signals: DetectedSignal[];
  captureEnabled?: boolean;
  champSelect?: ChampSelectState | null;
  deathReport?: import("./deaths.js").DeathPatternReport | null;
}

export interface HistoryListResponse {
  sessions: CoachSession[];
}

export const QUICK_CHIPS = [
  { id: "what_now" as const, label: "What now?" },
  { id: "item" as const, label: "Item?" },
  { id: "roam" as const, label: "Roam?" },
  { id: "objective" as const, label: "Objective?" },
  { id: "why_die" as const, label: "Why did I die?" },
];

export function emptyContext(): GameContext {
  return {
    source: "none",
    inGame: false,
    gameTime: 0,
    gameMode: "UNKNOWN",
    you: null,
    scoreboard: [],
    recentEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

export function formatGameClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function hpPercent(you: ActiveYou | null | undefined): number | null {
  if (!you?.maxHealth || you.maxHealth <= 0) return null;
  if (you.currentHealth == null) return null;
  return (you.currentHealth / you.maxHealth) * 100;
}

export { toSpeakable } from "./speakable.js";
export {
  CHAMPION_BY_ID,
  championNameFromId,
  resolveChampionLabel,
} from "./championIds.js";
export {
  DEFAULT_GOALS,
  goalsForMode,
  gradeMatch,
  killParticipation,
  scoreToLolLetter,
  type GoalId,
  type GoalResult,
  type LolGradeLetter,
  type MatchGrade,
  type SessionGoal,
} from "./goals.js";
export {
  analyzeDeaths,
  phaseForTime,
  type DeathPatternReport,
  type DeathRecord,
} from "./deaths.js";
export {
  buildDeathCoachBrief,
  buildSignalCoachLines,
  buildTempoCoachLine,
  resolveLiveCalloutLine,
  isAramMode,
  isArenaMode,
  isNoRecallMode,
  type CoachLines,
  type DeathCoachBrief,
} from "./coachBrief.js";
export {
  buildSituationBrief,
  localFallbackLine,
  coachPriority,
  type SituationBrief,
} from "./situation.js";
export {
  computeMatchAnalytics,
  formatAnalyticsForAi,
  strategyNextAction,
  type MatchAnalytics,
  type MacroPhase,
  type Pressure,
  type WinCon,
  type TeamTotals,
} from "./analytics.js";
export {
  buildStrategyPlan,
  formatStrategyForAi,
  type StrategyPlan,
} from "./strategy.js";
export {
  detectModeProfile,
  type CoachModeFamily,
  type ModeProfile,
} from "./modes.js";
export {
  detectCoachInsights,
  pickSpeakableInsight,
  explainCoachSilence,
  emptyWatchState,
  thresholdFor,
  type CoachInsight,
  type CoachWatchState,
  type CoachIntensity,
  type InsightKind,
} from "./insights.js";
export {
  runCoachSmoke,
  mainSmokeCli,
  SMOKE_CASES,
  type SmokeCase,
  type SmokeResult,
} from "./coachSmoke.js";
export {
  getChampKit,
  buildLockInBrief,
  buildEnemyThreatForecast,
  normalizeChampKey,
  CHAMP_KITS,
  type ChampKit,
} from "./champKnowledge.js";
export {
  craftCoachLine,
  polishLine,
  isObviousLine,
  nextCoachAction,
  modeStubFromAnalytics,
  buildTempoOptions,
  explainBestOptions,
  type PlayOption,
} from "./coachLines.js";
export {
  parseCoachPersonality,
  personalitySystemBlock,
  flavorLine,
  toNaturalTalk,
  isTelegraphicLine,
  namesAreDown,
  COACH_PERSONALITY_LABELS,
  type CoachPersonality,
} from "./personality.js";
export {
  buildFieldState,
  formatFieldStateForAi,
  type FieldState,
  type FieldUnit,
  type UltStatus,
} from "./fieldState.js";
export {
  buildCombatIntel,
  formatCombatIntelForAi,
  parseKillEvent,
  type CombatIntel,
  type FightLight,
  type KillFeedItem,
} from "./combatIntel.js";
export {
  emptyMatchMemory,
  updateMatchMemory,
  rememberSpoken,
  topHabits,
  predictNextMistakes,
  formatMemoryForAi,
  memoryBlocksLine,
  type MatchMemory,
  type MemoryEvent,
  type HabitCounter,
} from "./matchMemory.js";
export {
  synthesizeEliteCallouts,
  pickEliteCallout,
  formatEliteForAi,
  type EliteCallout,
  type ElitePriority,
} from "./eliteCoach.js";
export {
  readBattle,
  formatBattleForAi,
  battleIsUrgent,
  type BattleRead,
  type BattlePhase,
  type BattleJob,
  type BattleParticipant,
} from "./battleReader.js";
export {
  makeShotcall,
  polishShotcall,
  type Shotcall,
} from "./shotcall.js";
export {
  deepReasonBoard,
  formatDeepReasonForAi,
  type DeepReasoning,
  type ReasonOption,
} from "./deepReason.js";
export {
  computeOracleBrain,
  estimateWinProb,
  formatOracleForAi,
  type OracleBrain,
  type SequenceStep,
} from "./oracleBrain.js";
export {
  computeTacticalBrain,
  rankThreats,
  comboWindowFor,
  formatTacticalForAi,
  type TacticalBrain,
  type ThreatEntry,
} from "./tacticalBrain.js";
export {
  computeObjClockBrain,
  formatObjClockForAi,
  type ObjClockBrain,
  type ObjTimer,
  type ObjKind,
} from "./objClockBrain.js";
export {
  buildPostGameReport,
  formatPostGameReportText,
  formatPostGameReportForAi,
  type PostGameReport,
  type PostGameCard,
  type PostGameHabitFix,
} from "./postGameReport.js";
export {
  computeCoachBrain,
  applyBrainToOptions,
  formatBrainForAi,
  formatGrowthProtocol,
  brainSpeakHint,
  formatBrainHud,
  mergeSessionLearningObjective,
  topMistakeWarning,
  loadBlockLearningObjective,
  saveBlockLearningObjective,
  maybeRotateBlockLearningObjective,
  resolveLearningObjective,
  formatPostGameLoCard,
  type CoachBrainState,
  type GrowthState,
  type TempoState,
  type StructureFocus,
  type PatternCategory,
  type StackItem,
  type DecisionChecklist,
  type BoardAffordance,
} from "./coachBrain.js";
export {
  getRoleModel,
  phaseScript,
  inferFightRole,
  buildThreatModel,
  assessMistakeRisks,
  winConScript,
  nextMinutePlan,
  rolePrioritiesNow,
  type FightRole,
  type MistakeKind,
  type MistakeRisk,
  type RoleModel,
  type PhaseScript,
  type ThreatModel,
} from "./brainModels.js";

