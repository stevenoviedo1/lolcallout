import { create } from "zustand";
import type {
  AgentStatus,
  ChampSelectState,
  ChatMessage,
  CoachSession,
  DeathPatternReport,
  GameContext,
  MatchGrade,
  SessionGoal,
  SessionSummary,
} from "@riftcoach/shared";
import {
  DEFAULT_GOALS,
  emptyContext,
  buildSituationBrief,
  buildTempoCoachLine,
  coachPriority,
  detectCoachInsights,
  pickSpeakableInsight,
  emptyWatchState,
  buildLockInBrief,
  detectModeProfile,
  computeMatchAnalytics,
  computeCoachBrain,
  craftCoachLine,
  polishLine,
  isObviousLine,
  formatBrainHud,
  formatBrainForAi,
  mergeSessionLearningObjective,
  type DetectedSignal,
  type CoachWatchState,
  type CoachIntensity,
  type CoachBrainState,
} from "@riftcoach/shared";
import {
  captureScreen,
  createSession,
  endSession,
  fetchAgentStatus,
  fetchGrade,
  fetchHistory,
  fetchSessionDetail,
  pruneHistory,
  pushContext,
  sessionExists,
  streamCallout,
  streamChat,
} from "../lib/api";
import {
  DEFAULT_COST_SAVER,
  shouldRunAiCallout,
  shouldSpeakCallout,
  type CostSaverPrefs,
} from "../lib/costSaver";
import {
  DEFAULT_VOICE_PREFS,
  STYLE_PRESETS,
  isVoiceBusy,
  applyLiveVolume,
  clampVoiceVolume,
  getLastVoiceError,
  getSpeechRecognitionCtor,
  interpretVoiceCommand,
  onVoiceStatus,
  setVoicePrefs,
  speakText,
  stopSpeaking,
  testVoice,
  unlockAudio,
  type TtsEngine,
  type VoicePrefs,
  type VoiceStyle,
} from "../lib/voice";

type NavId = "home" | "live" | "history" | "settings";
type LayoutMode = "full" | "compact";

interface AppState {
  nav: NavId;
  setNav: (n: NavId) => void;
  layout: LayoutMode;
  setLayout: (l: LayoutMode) => void;
  agentStatus: AgentStatus;
  agentMessage: string;
  mock: boolean;
  context: GameContext;
  sessionId: string | null;
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  calloutsEnabled: boolean;
  setCalloutsEnabled: (v: boolean) => void;
  /** Speak callouts + coach replies out loud */
  voiceOverEnabled: boolean;
  setVoiceOverEnabled: (v: boolean) => void;
  voicePrefs: VoicePrefs;
  setVoiceRate: (rate: number) => void;
  setVoiceVolume: (volume: number) => void;
  setVoicePitch: (pitch: number) => void;
  setVoiceURI: (uri: string) => void;
  setVoiceStyle: (style: VoiceStyle) => void;
  setTtsEngine: (engine: TtsEngine) => void;
  setCloudVoice: (id: string) => void;
  testVoiceOver: () => void;
  /** Last TTS/playback error (null when healthy) */
  voiceError: string | null;
  /** Keep mic open and send spoken questions automatically */
  alwaysListen: boolean;
  setAlwaysListen: (v: boolean) => void;
  visionOnAsk: boolean;
  setVisionOnAsk: (v: boolean) => void;
  listening: boolean;
  history: CoachSession[];
  activeSummary: SessionSummary | null;
  toast: string | null;
  error: string | null;
  wasInGame: boolean;
  init: () => Promise<void>;
  pollAgent: () => Promise<void>;
  sendMessage: (
    text: string,
    intent?: ChatMessage["meta"] extends infer _ ? any : never,
    withVision?: boolean,
    frame?: { base64: string; mime: string }
  ) => Promise<void>;
  sendChip: (
    intent: "what_now" | "item" | "roam" | "objective" | "why_die",
    label: string
  ) => Promise<void>;
  analyzeScreen: () => Promise<void>;
  loadHistory: () => Promise<void>;
  openHistorySession: (id: string) => Promise<void>;
  finishGame: (result?: "win" | "loss" | "unknown") => Promise<void>;
  startVoice: (opts?: { continuous?: boolean }) => void;
  stopVoice: () => void;
  toggleAlwaysListen: () => void;
  newSession: () => Promise<void>;
  pruneHistory: () => Promise<void>;
  costSaver: CostSaverPrefs;
  setUrgentVoiceOnly: (v: boolean) => void;
  goals: SessionGoal[];
  setGoals: (g: SessionGoal[]) => void;
  lastGrade: MatchGrade | null;
  champSelect: ChampSelectState | null;
  deathReport: DeathPatternReport | null;
  requestChampSelectPlan: () => Promise<void>;
  /** Playtest debug: last coach cue */
  coachDebug: {
    text: string;
    source: "ai" | "local" | "none";
    kind: string;
    latencyMs: number;
    error: string | null;
  };
  /** Live coach brain snapshot for HUD */
  coachBrain: CoachBrainUi | null;
}

/** Compact brain for React UI (serializable) */
export interface CoachBrainUi {
  hud: string;
  tempo: string;
  tempoScore: number;
  focus: string;
  pattern: string;
  fightRole: string;
  fightRoleNote: string;
  highestValue: string;
  learningObjective: string;
  nextMinute: string[];
  threat: string | null;
  threatSeverity: string | null;
  counterplay: string;
  load: string;
  winConLine: string;
  topRisk: string | null;
  checklistWorth: string;
}

let pollTimer: number | undefined;
let calloutBusy = false;
const processedSignals = new Set<string>();
let recognition: SpeechRecognition | null = null;
let wantContinuous = false;
let restartTimer: number | undefined;
/** Per-match counters for cost control */
let spokenThisGame = 0;
let aiCalloutsThisGame = 0;
/** Human-like watch state (deltas, not timers) */
let coachWatch: CoachWatchState = emptyWatchState();
/** Anti-repeat spoken tips */
let lastSpokenTips: string[] = [];
let lastSpokenAt = 0;
/** Hard lock: only one coach voice in flight */
let coachVoiceLockedUntil = 0;
/** Champ select lock-in already briefed */
let lastLockInKey = "";
/** Sticky learning objective across the match (3-block style) */
let sessionLearningObjective: string | null = null;

function brainToUi(brain: CoachBrainState): CoachBrainUi {
  return {
    hud: formatBrainHud(brain),
    tempo: brain.tempo,
    tempoScore: brain.tempoScore,
    focus: brain.focus,
    pattern: brain.pattern,
    fightRole: brain.fightRole,
    fightRoleNote: brain.fightRoleNote,
    highestValue: brain.highestValue,
    learningObjective: brain.growth.learningObjective,
    nextMinute: brain.nextMinute,
    threat: brain.threat?.name ?? null,
    threatSeverity: brain.threat?.severity ?? null,
    counterplay: brain.counterplay,
    load: brain.load,
    winConLine: brain.winConLine,
    topRisk: brain.mistakeRisks[0]
      ? `${brain.mistakeRisks[0].label} → ${brain.mistakeRisks[0].fix}`
      : null,
    checklistWorth: brain.checklist.worthIt,
  };
}

/** Coaching intensity: quiet | normal | talkative */
function getCoachIntensity(): CoachIntensity {
  const v = localStorage.getItem("rc_coach_intensity");
  if (v === "quiet" || v === "talkative") return v;
  return "normal";
}
/** Min gap between non-urgent spoken tips (was 14s — felt broken) */
const MIN_SPEAK_GAP_MS = 7_500;
/** Death / critical always cut through */
const URGENT_KINDS = new Set(["death", "low_hp", "numbers"]);

function normalizeTip(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRepeatTip(text: string): boolean {
  const n = normalizeTip(text);
  if (!n) return true;
  // Only block near-exact repeats (was too aggressive → silent coach)
  return lastSpokenTips.some((prev) => {
    const p = normalizeTip(prev);
    if (p === n) return true;
    if (p.length > 20 && n.length > 20 && (p.includes(n) || n.includes(p))) return true;
    const wa = new Set(n.split(" ").filter((w) => w.length > 3));
    const wb = p.split(" ").filter((w) => w.length > 3);
    if (wb.length < 5 || wa.size < 5) return false;
    let hit = 0;
    for (const w of wb) if (wa.has(w)) hit++;
    return hit / wb.length >= 0.72 && hit >= 5;
  });
}

function isUrgentKind(kind: string): boolean {
  return URGENT_KINDS.has(kind);
}

function fallbackSafePreview(signal: DetectedSignal): string {
  const t = (signal.spokenFallback || signal.detail || signal.title || signal.kind).trim();
  return t.slice(0, 100);
}

/** Ensure API still has our session; recreate if pruned/restarted. */
async function ensureCoachSession(): Promise<string> {
  const current = useAppStore.getState().sessionId;
  if (current && (await sessionExists(current))) return current;
  const session = await createSession();
  useAppStore.setState({
    sessionId: session.id,
    error: null,
  });
  console.info("[session] recreated", session.id, current ? `(was ${current})` : "(none)");
  return session.id;
}

function speakIfEnabled(
  text: string,
  kind: "callout" | "reply" | "system",
  calloutKind?: string,
  opts?: { force?: boolean }
): boolean {
  const st = useAppStore.getState();
  // Auto-arm voice for live callouts so it doesn't stay "off" by accident
  if (!st.voiceOverEnabled) {
    if (kind === "callout") {
      localStorage.setItem("rc_voiceover", "1");
      useAppStore.setState({ voiceOverEnabled: true });
      void unlockAudio();
    } else {
      console.info("[voice] skipped — Voice-over is OFF");
      return false;
    }
  }
  if (!text.trim()) return false;

  const now = Date.now();
  const urgent = opts?.force || (kind === "callout" && isUrgentKind(calloutKind || ""));

  // Non-urgent: respect lock. Urgent: interrupt previous line.
  if (!urgent && now < coachVoiceLockedUntil) {
    console.info("[voice] skipped — coach voice still locked", kind, calloutKind);
    return false;
  }
  if (kind === "callout" && !urgent && isRepeatTip(text)) {
    console.info("[voice] skipped — repeat tip");
    return false;
  }

  if (kind === "callout") {
    if (
      !urgent &&
      !shouldSpeakCallout(calloutKind || "generic", st.costSaver, spokenThisGame)
    ) {
      console.info("[voice] skipped — cost saver", calloutKind);
      return false;
    }
    spokenThisGame += 1;
    lastSpokenTips = [text, ...lastSpokenTips].slice(0, 8);
  }

  // Lock only for line duration (~2.8–7s) — was up to 12s and stacked with 14s gap
  const words = text.trim().split(/\s+/).length;
  const estMs = urgent
    ? Math.min(6_500, Math.max(2_200, words * 280 + 800))
    : Math.min(7_500, Math.max(2_800, words * 300 + 900));
  coachVoiceLockedUntil = now + estMs;
  lastSpokenAt = now;

  const base = st.voicePrefs;
  setVoicePrefs(base);
  const isLiveCallout = kind === "callout";
  speakText(text, {
    interrupt: true,
    rate: Math.min(1.2, base.rate + (isLiveCallout ? 0.06 : 0)),
    pitch: base.pitch,
    volume: clampVoiceVolume(base.volume ?? DEFAULT_VOICE_PREFS.volume),
    maxChars: isLiveCallout ? 100 : 180,
    prefs: base,
  });
  return true;
}

function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem("rc_voice_prefs");
    if (!raw) return { ...DEFAULT_VOICE_PREFS };
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      ...DEFAULT_VOICE_PREFS,
      ...parsed,
      rate: Number(parsed.rate ?? DEFAULT_VOICE_PREFS.rate),
      pitch: Number(parsed.pitch ?? DEFAULT_VOICE_PREFS.pitch),
      volume: clampVoiceVolume(Number(parsed.volume ?? DEFAULT_VOICE_PREFS.volume)),
      voiceURI: String(parsed.voiceURI ?? ""),
      style: (parsed.style as VoiceStyle) || "competitive",
      engine: (parsed.engine as TtsEngine) || DEFAULT_VOICE_PREFS.engine,
      cloudVoice: String(parsed.cloudVoice ?? DEFAULT_VOICE_PREFS.cloudVoice),
    };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

function persistVoicePrefs(prefs: VoicePrefs) {
  localStorage.setItem("rc_voice_prefs", JSON.stringify(prefs));
  setVoicePrefs(prefs);
}

export const useAppStore = create<AppState>((set, get) => ({
  nav: "live",
  setNav: (nav) => set({ nav }),
  layout: "full",
  setLayout: (layout) => set({ layout }),
  agentStatus: "idle",
  agentMessage: "Starting…",
  mock: false,
  context: emptyContext(),
  sessionId: null,
  messages: [],
  input: "",
  setInput: (input) => set({ input }),
  streaming: false,
  calloutsEnabled: true,
  setCalloutsEnabled: (calloutsEnabled) => {
    localStorage.setItem("rc_callouts", calloutsEnabled ? "1" : "0");
    set({ calloutsEnabled });
  },
  voiceOverEnabled: true,
  setVoiceOverEnabled: (voiceOverEnabled) => {
    localStorage.setItem("rc_voiceover", voiceOverEnabled ? "1" : "0");
    if (!voiceOverEnabled) {
      stopSpeaking();
      set({ voiceOverEnabled, voiceError: null });
      return;
    }
    // User gesture: unlock autoplay so death callouts can speak later
    void unlockAudio();
    set({ voiceOverEnabled: true });
    setVoicePrefs(get().voicePrefs);
  },
  voicePrefs: { ...DEFAULT_VOICE_PREFS },
  voiceError: null,
  setVoiceRate: (rate) => {
    const voicePrefs = { ...get().voicePrefs, rate };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  setVoiceVolume: (volume) => {
    const v = clampVoiceVolume(volume);
    const voicePrefs = { ...get().voicePrefs, volume: v };
    persistVoicePrefs(voicePrefs);
    applyLiveVolume(v);
    set({ voicePrefs });
  },
  setVoicePitch: (pitch) => {
    const voicePrefs = { ...get().voicePrefs, pitch };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  setVoiceURI: (voiceURI) => {
    const voicePrefs = { ...get().voicePrefs, voiceURI };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  setVoiceStyle: (style) => {
    const preset = STYLE_PRESETS[style];
    const voicePrefs = {
      ...get().voicePrefs,
      style,
      rate: preset.rate,
      pitch: preset.pitch,
    };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  setTtsEngine: (engine) => {
    const voicePrefs = {
      ...get().voicePrefs,
      engine,
      cloudVoice:
        engine === "xai"
          ? get().voicePrefs.cloudVoice || "leo"
          : engine === "elevenlabs"
            ? get().voicePrefs.cloudVoice
            : get().voicePrefs.cloudVoice,
    };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  setCloudVoice: (cloudVoice) => {
    const voicePrefs = { ...get().voicePrefs, cloudVoice };
    persistVoicePrefs(voicePrefs);
    set({ voicePrefs });
  },
  testVoiceOver: () => {
    const prefs = get().voicePrefs;
    // Ensure voice-over is on when testing
    localStorage.setItem("rc_voiceover", "1");
    set({ voiceOverEnabled: true, voiceError: null, toast: "Playing test voice…" });
    setVoicePrefs(prefs);
    void unlockAudio().then(() => {
      testVoice(prefs);
      window.setTimeout(() => {
        const err = getLastVoiceError();
        if (err) {
          set({ voiceError: err, toast: err, error: err });
        } else if (get().toast === "Playing test voice…") {
          set({ toast: "Voice OK — you should have heard the coach" });
          window.setTimeout(() => {
            if (get().toast?.startsWith("Voice OK")) set({ toast: null });
          }, 3500);
        }
      }, 2500);
    });
  },
  alwaysListen: false,
  setAlwaysListen: (alwaysListen) => {
    localStorage.setItem("rc_always_listen", alwaysListen ? "1" : "0");
    set({ alwaysListen });
    if (alwaysListen) get().startVoice({ continuous: true });
    else get().stopVoice();
  },
  visionOnAsk: false,
  setVisionOnAsk: (visionOnAsk) => {
    localStorage.setItem("rc_vision", visionOnAsk ? "1" : "0");
    set({ visionOnAsk });
  },
  listening: false,
  history: [],
  activeSummary: null,
  toast: null,
  error: null,
  wasInGame: false,
  costSaver: { ...DEFAULT_COST_SAVER },
  setUrgentVoiceOnly: (urgentVoiceOnly) => {
    const costSaver = { ...get().costSaver, urgentVoiceOnly };
    localStorage.setItem("rc_urgent_voice", urgentVoiceOnly ? "1" : "0");
    set({ costSaver });
  },
  goals: [...DEFAULT_GOALS],
  setGoals: (goals) => {
    localStorage.setItem("rc_goals", JSON.stringify(goals));
    set({ goals });
  },
  lastGrade: null,
  champSelect: null,
  deathReport: null,
  coachDebug: {
    text: "",
    source: "none",
    kind: "",
    latencyMs: 0,
    error: null,
  },
  coachBrain: null,
  requestChampSelectPlan: async () => {
    const cs = get().champSelect;
    const brief = buildLockInBrief({
      myChampion: cs?.myChampion,
      myChampionId: cs?.myChampionId,
      position: cs?.assignedPosition,
      enemies: cs?.enemies,
      allies: cs?.allies,
      modeLabel: "Detect SR / ARAM / Arena when game starts",
    });
    // Show local lock-in card immediately
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `lockin-${Date.now()}`,
          role: "callout",
          content: [
            brief.title,
            "",
            "COMBOS:",
            ...brief.combos.map((c) => `• ${c}`),
            "",
            `EARLY: ${brief.early}`,
            "",
            "FORECAST:",
            ...brief.forecast.map((f) => `• ${f}`),
            "",
            "WATCH FOR:",
            ...brief.watchFor.map((w) => `• ${w}`),
          ].join("\n"),
          createdAt: new Date().toISOString(),
          meta: { kind: "champ_select", source: "local" },
        },
      ],
      nav: "live",
      toast: brief.speak.slice(0, 120),
    }));
    if (get().voiceOverEnabled) {
      speakIfEnabled(brief.speak, "callout", "match_start");
    }
    // AI enrich text only — sendMessage skips TTS for champ_select (local brief already spoke)
    await get().sendMessage(brief.aiPrompt, "champ_select");
  },

  init: async () => {
    // Surface TTS failures in UI
    onVoiceStatus(({ error }) => {
      if (error) set({ voiceError: error });
      else if (get().voiceError) set({ voiceError: null });
    });

    const callouts = localStorage.getItem("rc_callouts");
    const vision = localStorage.getItem("rc_vision");
    const layout = localStorage.getItem("rc_layout") as LayoutMode | null;
    const voiceOver = localStorage.getItem("rc_voiceover");
    const always = localStorage.getItem("rc_always_listen");
    const urgent = localStorage.getItem("rc_urgent_voice");
    const voicePrefs = loadVoicePrefs();
    setVoicePrefs(voicePrefs);

    set({
      calloutsEnabled: callouts !== "0",
      visionOnAsk: vision === "1",
      layout: layout === "compact" ? "compact" : "full",
      voiceOverEnabled: voiceOver !== "0", // default ON
      alwaysListen: always === "1",
      voicePrefs,
      costSaver: {
        ...DEFAULT_COST_SAVER,
        urgentVoiceOnly: urgent !== "0",
        // Prefer AI-assisted tempo on local host (XAI key present)
        backgroundAiCallouts: localStorage.getItem("rc_ai_callouts") !== "0",
      },
      goals: (() => {
        try {
          const raw = localStorage.getItem("rc_goals");
          if (raw) return JSON.parse(raw) as SessionGoal[];
        } catch {
          /* ignore */
        }
        return [...DEFAULT_GOALS];
      })(),
    });

    // Warm TTS voices list (Chrome loads async)
    window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
      window.speechSynthesis.getVoices();
    });

    try {
      const session = await createSession();
      set({
        sessionId: session.id,
        messages: [
          {
            id: "sys-1",
            role: "system",
            content:
              "Hands-free ready. Turn on Always listen (Mic stays open) and Voice-over (callouts spoken). Say “coach what now”, “item”, “why did I die”.",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to create session (is API running?)",
      });
    }

    await get().pollAgent();
    void get().loadHistory();
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => void get().pollAgent(), 1000);

    if (get().alwaysListen) {
      get().startVoice({ continuous: true });
    }
  },

  pollAgent: async () => {
    try {
      const status = await fetchAgentStatus();
      const wasInGame = get().wasInGame;
      // Only "real" live games count — mock must not look like a match
      const nowInGame = status.context.inGame && !status.mock && status.context.source === "live";

      const ctx: GameContext = {
        ...status.context,
        deathReport: status.deathReport
          ? {
              total: status.deathReport.total,
              early: status.deathReport.early,
              mid: status.deathReport.mid,
              late: status.deathReport.late,
              dominant: status.deathReport.dominant,
            }
          : status.context.deathReport,
      };

      set({
        agentStatus: status.status,
        agentMessage: status.message,
        mock: status.mock,
        context: ctx,
        error: null,
        wasInGame: nowInGame,
        champSelect: status.champSelect || null,
        deathReport: status.deathReport || null,
      });

      // Auto lock-in brief when champion is locked (LCU)
      if (status.champSelect?.active) {
        const lockKey = `${status.champSelect.myChampionId || status.champSelect.myChampion || ""}:${status.champSelect.assignedPosition || ""}`;
        const locked = Boolean(
          (status.champSelect.myChampionId && status.champSelect.myChampionId > 0) ||
            status.champSelect.myChampion
        );
        if (
          locked &&
          lockKey !== lastLockInKey &&
          !get().streaming &&
          get().sessionId
        ) {
          lastLockInKey = lockKey;
          void get().requestChampSelectPlan();
        }
        if (!locked) {
          set({ toast: "Champ select — lock a champion for combos + forecast" });
        }
      } else {
        lastLockInKey = "";
      }

      const { sessionId, calloutsEnabled, streaming } = get();
      if (nowInGame) {
        void (async () => {
          try {
            const sid = sessionId && (await sessionExists(sessionId))
              ? sessionId
              : await ensureCoachSession();
            await pushContext(sid, ctx);
          } catch {
            /* ignore push errors; next poll retries */
          }
        })();
      }

      // Entered a new live game → reset budgets + playtest-friendly UI
      if (!wasInGame && nowInGame) {
        spokenThisGame = 0;
        aiCalloutsThisGame = 0;
        coachWatch = emptyWatchState();
        lastSpokenTips = [];
        sessionLearningObjective = null;
        const champ = status.context.you?.championName || "game";
        const modeProf = detectModeProfile({
          gameMode: status.context.gameMode,
          mapName: status.context.mapName,
          queueType: status.context.queueType,
          gameQueueConfigId: status.context.gameQueueConfigId,
        });
        set({
          nav: "live",
          toast: `Live — ${modeProf.label} · ${champ}. Coach brain online.`,
          coachBrain: null,
        });
        window.setTimeout(() => {
          if (get().toast?.startsWith("Live —")) set({ toast: null });
        }, 4000);
        // Auto compact for second-monitor play (once per session preference)
        if (localStorage.getItem("rc_auto_compact") !== "0" && get().layout === "full") {
          localStorage.setItem("rc_layout", "compact");
          set({ layout: "compact" });
        }
      }

      // Game just ended: stop voice spam + one summary (not endless callouts)
      if (wasInGame && !nowInGame && sessionId) {
        stopSpeaking();
        calloutBusy = false;
        spokenThisGame = 0;
        aiCalloutsThisGame = 0;
        if (!streaming) {
          set({ toast: "Game ended — generating summary…" });
          void get().finishGame("unknown");
        }
      }

      // Live coach brain snapshot every poll while in game (HUD + AI context)
      let liveBrain: CoachBrainState | null = null;
      if (nowInGame && ctx.you && !status.mock) {
        const aSnap = computeMatchAnalytics(ctx);
        if (aSnap) {
          try {
            liveBrain = computeCoachBrain(aSnap);
            sessionLearningObjective = mergeSessionLearningObjective(
              sessionLearningObjective,
              liveBrain,
              { forceRefresh: !sessionLearningObjective }
            );
            // Prefer sticky LO in growth display
            const ui = brainToUi(liveBrain);
            ui.learningObjective = sessionLearningObjective || ui.learningObjective;
            set({ coachBrain: ui });
          } catch {
            /* brain optional */
          }
        }
      } else if (!nowInGame && get().coachBrain) {
        set({ coachBrain: null });
      }

      // Human-like coach: only speak when insight score clears threshold (no timer filler)
      if (calloutsEnabled && !calloutBusy && nowInGame && !status.mock && ctx.you) {
        const { insights, next: watchNext, mode: modeProf } = detectCoachInsights({
          ctx,
          prev: coachWatch,
          agentSignals: status.signals || [],
          avoidLines: lastSpokenTips,
        });
        coachWatch = watchNext;

        // Mark agent signals processed so we don't double-handle below
        for (const s of status.signals || []) processedSignals.add(s.id);

        const intensity = getCoachIntensity();
        const best = pickSpeakableInsight(insights, intensity);
        if (best) {
          const brainBlock = liveBrain ? formatBrainForAi(liveBrain) : "";
          const stickyLo = sessionLearningObjective || liveBrain?.growth.learningObjective || "";
          // Stable id per signature so deferred voice can retry (don't burn Date.now() ids)
          const synthetic: DetectedSignal = {
            id: `insight::${best.kind}::${best.signature}`,
            kind: (best.kind === "pressure_flip" ||
            best.kind === "wincon_change" ||
            best.kind === "fed_enemy_new" ||
            best.kind === "death_pattern" ||
            best.kind === "gold_sit" ||
            best.kind === "behind_farm" ||
            best.kind === "tempo_flip" ||
            best.kind === "brain_risk" ||
            best.kind === "brain_window"
              ? "tempo"
              : best.kind) as DetectedSignal["kind"],
            severity: best.severity,
            gameTime: ctx.gameTime,
            title: best.reason,
            detail: best.line,
            coachPrompt: [
              `INSIGHT: ${best.reason} (score ${best.score})`,
              stickyLo ? `SESSION LO: ${stickyLo}` : "",
              `MODE: ${modeProf.label}`,
              ...modeProf.rules.map((r) => `RULE: ${r}`),
              brainBlock,
              buildSituationBrief(ctx, "tempo", { lastTips: lastSpokenTips, extra: best.reason }).text,
              `FALLBACK: ${best.line}`,
              "One speakable sentence. Pick BEST option for THIS role+board. No timer filler. Never invent fog.",
            ]
              .filter(Boolean)
              .join("\n"),
            spokenFallback: best.line,
            createdAt: new Date().toISOString(),
          };
          status.signals = [synthetic];
          // Do NOT mark lastSpokenAt / signatures here — only after voice actually fires
        } else {
          status.signals = [];
        }
      }
      if (!nowInGame) {
        coachWatch = emptyWatchState();
        lastSpokenTips = [];
        lastSpokenAt = 0;
        coachVoiceLockedUntil = 0;
        sessionLearningObjective = null;
      }

      if (calloutsEnabled && !calloutBusy && nowInGame && !status.mock) {
        const signals = [...(status.signals || [])]
          .filter((s) => !processedSignals.has(s.id))
          .sort((a, b) => coachPriority(b.kind) - coachPriority(a.kind));
        const signal = signals[0];
        if (signal) {
          const cs = get().costSaver;
          const willSpeak = shouldSpeakCallout(signal.kind, cs, spokenThisGame);
          const isUrgent = isUrgentKind(signal.kind) || signal.severity === "urgent";
          const gapOk = Date.now() - lastSpokenAt >= MIN_SPEAK_GAP_MS || isUrgent;
          // Cloud TTS "busy" must not mute forever — only soft-block non-urgent
          const voiceFree =
            isUrgent || (Date.now() >= coachVoiceLockedUntil && !isVoiceBusy());

          // Permanent reject (cost saver / budget) — mark processed
          if (!willSpeak) {
            processedSignals.add(signal.id);
            set({
              coachDebug: {
                text: `(muted cost-saver: ${signal.kind})`,
                source: "none",
                kind: signal.kind,
                latencyMs: 0,
                error: "cost saver or max spoken",
              },
            });
          } else if (!gapOk || !voiceFree) {
            // Temporary — do NOT mark processed; retry next poll
            set({
              coachDebug: {
                text: fallbackSafePreview(signal),
                source: "none",
                kind: signal.kind,
                latencyMs: 0,
                error: !gapOk ? "waiting speak gap" : "voice busy — retry",
              },
            });
          } else {
            // Build line first; only mark processed after we commit to speak
            const brief = buildSituationBrief(
              ctx,
              signal.kind as Parameters<typeof buildSituationBrief>[1],
              { lastTips: lastSpokenTips, extra: signal.detail }
            );

            const modeProfLocal = detectModeProfile({
              gameMode: ctx.gameMode,
              mapName: ctx.mapName,
              queueType: (ctx as GameContext & { queueType?: string }).queueType,
            });
            const analytics = computeMatchAnalytics(ctx);
            let brainForCall: CoachBrainState | null = liveBrain;
            if (!brainForCall && analytics) {
              try {
                brainForCall = computeCoachBrain(analytics);
              } catch {
                /* ignore */
              }
            }
            let fallback =
              signal.spokenFallback?.trim() ||
              brief.fallback ||
              buildTempoCoachLine(ctx, { avoid: lastSpokenTips })?.live ||
              "";
            if (analytics) {
              if (!fallback || isObviousLine(fallback)) {
                fallback = polishLine(
                  craftCoachLine(analytics, signal.kind || "tempo", modeProfLocal),
                  analytics,
                  modeProfLocal
                );
              } else {
                fallback = polishLine(fallback, analytics, modeProfLocal);
              }
            }
            if (!fallback.trim()) {
              fallback =
                brainForCall?.highestValue
                  ? `${ctx.you?.championName || "You"}: ${brainForCall.highestValue}`
                  : `${ctx.you?.championName || "You"}: shove this wave then move first.`;
            }

            if (!isUrgent && isRepeatTip(fallback)) {
              processedSignals.add(signal.id);
              set({
                coachDebug: {
                  text: fallback.slice(0, 80),
                  source: "none",
                  kind: signal.kind,
                  latencyMs: 0,
                  error: "repeat tip",
                },
              });
            } else {
              processedSignals.add(signal.id);
              if (processedSignals.size > 200) {
                [...processedSignals].slice(0, 100).forEach((id) => processedSignals.delete(id));
              }

              calloutBusy = true;
              const assistantId = `c-${signal.id}-${Date.now()}`;
              const started = Date.now();

              const AI_KINDS = new Set([
                "death",
                "kill",
                "numbers",
                "objective",
                "low_hp",
                "base",
                "level_up",
                "match_start",
                "shutdown",
              ]);
              const useAi =
                (AI_KINDS.has(signal.kind) ||
                  signal.severity === "urgent" ||
                  signal.severity === "warn") &&
                Boolean(get().sessionId && shouldRunAiCallout(cs, aiCalloutsThisGame));

              set((s) => ({
                messages: [
                  ...s.messages,
                  {
                    id: assistantId,
                    role: "callout",
                    content: useAi ? "…" : fallback,
                    createdAt: new Date().toISOString(),
                    meta: { kind: signal.kind, severity: signal.severity },
                  },
                ],
                toast: useAi ? "Coach…" : fallback.slice(0, 140),
                nav: "live",
              }));

              void unlockAudio();

              const paint = (line: string, source: "ai" | "local", err?: string) => {
                set((s) => ({
                  messages: s.messages.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: line, meta: { ...m.meta, source } }
                      : m
                  ),
                  toast: line.slice(0, 140),
                  coachDebug: {
                    text: line,
                    source,
                    kind: signal.kind,
                    latencyMs: Date.now() - started,
                    error: err || null,
                  },
                }));
                window.setTimeout(() => {
                  if (get().toast?.includes(line.slice(0, 12))) set({ toast: null });
                }, 4000);
              };

              const releaseBusy = () => {
                const releaseIn = Math.max(600, Math.min(5_000, coachVoiceLockedUntil - Date.now()));
                window.setTimeout(() => {
                  calloutBusy = false;
                }, releaseIn);
              };

              // Always speak local craft line immediately (force if urgent)
              const spoke = speakIfEnabled(fallback, "callout", signal.kind, {
                force: isUrgent,
              });
              paint(fallback, "local", spoke ? undefined : "speak gate blocked");
              if (spoke) {
                coachWatch.lastSpokenAt = Date.now();
                const parts = signal.id.startsWith("insight::")
                  ? signal.id.split("::")
                  : null;
                const sig = parts && parts[2] ? parts.slice(2).join("::") : signal.kind;
                coachWatch.lastSignatures = [sig, ...coachWatch.lastSignatures].slice(0, 12);
              }
              releaseBusy();

              if (useAi && spoke) {
                aiCalloutsThisGame += 1;
                const enriched: DetectedSignal = {
                  ...signal,
                  coachPrompt: [
                    brief.instruction,
                    brief.text,
                    brainForCall ? formatBrainForAi(brainForCall) : "",
                    sessionLearningObjective
                      ? `SESSION LO (sticky): ${sessionLearningObjective}`
                      : "",
                    `FALLBACK (improve for THIS role+board; ban platitudes): ${fallback}`,
                    "One speakable sentence ≤18 words. Best option only. Threat/gold/HP/dead + next play.",
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  spokenFallback: fallback,
                };
                // AI upgrades on-screen text only — no second voice
                void (async () => {
                  try {
                    const sid = await ensureCoachSession();
                    const full = await streamCallout(sid, enriched, ctx, () => undefined);
                    const trimmed = full
                      .replace(/^(ACTION|CALLOUT|LIVE|NOTE|CAUSE|FIX|NEXT|VERDICT):\s*/gim, "")
                      .replace(/\n+/g, " ")
                      .replace(/\s+/g, " ")
                      .trim();
                    let line = trimmed.length >= 6 ? trimmed.slice(0, 200) : "";
                    if (analytics && line && isObviousLine(line)) {
                      line = polishLine(line, analytics, modeProfLocal);
                    }
                    if (
                      line.length >= 6 &&
                      !isRepeatTip(line) &&
                      !(analytics && isObviousLine(line)) &&
                      line.toLowerCase() !== fallback.toLowerCase()
                    ) {
                      paint(line, "ai");
                    }
                  } catch {
                    /* local already spoken */
                  }
                })();
              }
            }
          }
        }
      }

    } catch {
      set({
        agentStatus: "error",
        agentMessage: "Agent offline — start apps/agent",
      });
    }
  },

  sendMessage: async (text, intent, withVision, frame) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    let sessionId: string;
    try {
      sessionId = await ensureCoachSession();
    } catch (e) {
      set({
        error:
          e instanceof Error
            ? e.message
            : "No session — is the API running on :8787?",
      });
      return;
    }

    let frameBase64: string | undefined = frame?.base64;
    let frameMime: string | undefined = frame?.mime;
    if (!frameBase64 && (withVision || get().visionOnAsk)) {
      set({ toast: "Capturing screen…" });
      const shot = await captureScreen();
      if (shot) {
        frameBase64 = shot.base64;
        frameMime = shot.mime;
      } else {
        set({
          toast: null,
          error: "Screen capture failed (AV/blocked). Use 📎 to attach a screenshot instead.",
        });
      }
      set({ toast: null });
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed + (frameBase64 ? " 📎" : ""),
      createdAt: new Date().toISOString(),
      meta: intent ? { intent } : undefined,
    };
    const assistantId = `a-${Date.now()}`;
    set((s) => ({
      messages: [
        ...s.messages,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
        },
      ],
      input: "",
      streaming: true,
      error: null,
      nav: "live",
    }));

    const runChat = async (sid: string) => {
      let full = "";
      await streamChat(
        sid,
        {
          message: trimmed,
          intent,
          context: get().context,
          frameBase64,
          frameMime,
          goals: get().goals,
          deathReport: get().deathReport || undefined,
        },
        (token) => {
          full += token;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m
            ),
          }));
        }
      );
      return full;
    };

    // champ_select already spoke the local lock-in brief — never double-speak AI
    const shouldVoiceReply = intent !== "champ_select";

    try {
      let full = await runChat(sessionId);
      if (shouldVoiceReply) speakIfEnabled(full, "reply");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      // Auto-recover stale session once (API restart / prune)
      if (/session not found/i.test(msg)) {
        try {
          const sid = await ensureCoachSession();
          const full = await runChat(sid);
          if (shouldVoiceReply) speakIfEnabled(full, "reply");
          set({ error: null });
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : "Chat failed";
          set((s) => ({
            error: msg2,
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content || `Error: ${msg2}` } : m
            ),
          }));
        }
      } else {
        set((s) => ({
          error: msg,
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content || `Error: ${msg}` } : m
          ),
        }));
      }
    } finally {
      set({ streaming: false });
    }
  },

  sendChip: async (intent, label) => {
    await get().sendMessage(label, intent);
  },

  analyzeScreen: async () => {
    await get().sendMessage("Analyze my screen and tell me what to do next.", "what_now", true);
  },

  loadHistory: async () => {
    try {
      const sessions = await fetchHistory();
      set({ history: sessions });
    } catch {
      /* ignore */
    }
  },

  openHistorySession: async (id) => {
    try {
      const detail = await fetchSessionDetail(id);
      set({
        sessionId: detail.session.id,
        messages: detail.messages as ChatMessage[],
        activeSummary: detail.summary || null,
        nav: "live",
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to open session" });
    }
  },

  finishGame: async (result = "unknown") => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    // Avoid double summary spam
    if (get().streaming) return;
    try {
      stopSpeaking();
      set({ streaming: true, toast: "Writing post-game summary…" });
      // Prefer last live context; don't send mock
      const ctx = get().context;
      const safeCtx =
        ctx.source === "mock" ? { ...ctx, inGame: false, source: "none" as const } : ctx;
      const you = get().context.you;
      const dr = get().deathReport;
      let grade: MatchGrade | null = null;
      try {
        grade = await fetchGrade({
          kills: you?.kills ?? 0,
          deaths: you?.deaths ?? 0,
          assists: you?.assists ?? 0,
          creeps: you?.creeps ?? 0,
          gameTimeSec: get().context.gameTime || 0,
          earlyDeaths: dr?.early ?? 0,
          goals: get().goals,
          repeatDeathPattern: dr?.dominant,
        });
      } catch {
        /* grade optional */
      }

      const { summary } = await endSession(sessionId, safeCtx, result);
      const raw = summary.raw || summary.bullets.join(". ");
      const gradeLine = grade
        ? `\n\nGRADE ${grade.letter} (${grade.score}/100)\n${grade.goals.map((g) => `${g.passed ? "✓" : "✗"} ${g.detail}`).join("\n")}\nHabits: ${grade.habits.join(" · ")}`
        : "";
      set((s) => ({
        activeSummary: summary,
        lastGrade: grade,
        messages: [
          ...s.messages,
          {
            id: `sum-${Date.now()}`,
            role: "system",
            content: raw + gradeLine,
            createdAt: new Date().toISOString(),
            meta: { kind: "summary", grade },
          },
        ],
        toast: grade
          ? `Game over — Grade ${grade.letter}`
          : "Summary ready — callouts stopped until next match",
      }));
      speakIfEnabled(
        grade ? `Grade ${grade.letter}. ${grade.habits[0] || raw}` : raw,
        "reply"
      );
      void get().loadHistory();
      // Fresh shell for next game (won't appear in history until a real match)
      const next = await createSession();
      set({
        sessionId: next.id,
        messages: [
          {
            id: "sys-next",
            role: "system",
            content: "Ready for next match. Callouts only run during a live game.",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Summary failed" });
    } finally {
      set({ streaming: false });
      window.setTimeout(() => set({ toast: null }), 3500);
    }
  },

  startVoice: (opts) => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      set({ error: "Speech recognition not supported. Use Chrome or Edge." });
      return;
    }

    wantContinuous = Boolean(opts?.continuous || get().alwaysListen);

    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        /* ignore */
      }
      recognition = null;
    }
    if (restartTimer) {
      window.clearTimeout(restartTimer);
      restartTimer = undefined;
    }

    const rec = new SR();
    recognition = rec;
    rec.lang = "en-US";
    rec.continuous = wantContinuous;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      // Use latest final result
      let transcript = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          transcript += ev.results[i][0]?.transcript || "";
        }
      }
      if (!transcript && ev.results[0]?.[0]?.transcript) {
        transcript = ev.results[0][0].transcript;
      }
      transcript = transcript.trim();
      if (!transcript) return;

      // If busy answering, queue only short commands by ignoring during stream
      if (get().streaming) {
        set({ toast: `Heard (busy): ${transcript.slice(0, 40)}` });
        return;
      }

      const cmd = interpretVoiceCommand(transcript);
      if (!cmd) return;

      set({ toast: `Heard: ${cmd.text}` });
      void get().sendMessage(cmd.text, cmd.intent);
    };

    rec.onerror = (ev: Event) => {
      const err = (ev as { error?: string }).error;
      // continuous mode: ignore no-speech / aborted
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed") {
        set({
          listening: false,
          alwaysListen: false,
          error: "Mic permission denied. Allow microphone for this site.",
        });
        wantContinuous = false;
        return;
      }
      if (!wantContinuous) set({ listening: false });
    };

    rec.onend = () => {
      if (wantContinuous && get().alwaysListen) {
        // Browser stops after pauses — auto-restart
        restartTimer = window.setTimeout(() => {
          if (!wantContinuous || !get().alwaysListen) return;
          try {
            recognition?.start();
            set({ listening: true });
          } catch {
            // Already started
          }
        }, 250);
        return;
      }
      set({ listening: false });
      recognition = null;
    };

    try {
      rec.start();
      set({ listening: true, error: null, toast: wantContinuous ? "Always listen ON" : "Listening…" });
    } catch (e) {
      set({
        listening: false,
        error: e instanceof Error ? e.message : "Could not start mic",
      });
    }
  },

  stopVoice: () => {
    wantContinuous = false;
    if (restartTimer) {
      window.clearTimeout(restartTimer);
      restartTimer = undefined;
    }
    try {
      if (recognition) {
        recognition.onend = null;
        recognition.stop();
      }
    } catch {
      /* ignore */
    }
    recognition = null;
    set({ listening: false, alwaysListen: false, toast: null });
    localStorage.setItem("rc_always_listen", "0");
  },

  toggleAlwaysListen: () => {
    const next = !get().alwaysListen;
    get().setAlwaysListen(next);
  },

  newSession: async () => {
    try {
      stopSpeaking();
      const session = await createSession();
      set({
        sessionId: session.id,
        messages: [
          {
            id: "sys-new",
            role: "system",
            content: "New session started. History only lists real matches.",
            createdAt: new Date().toISOString(),
          },
        ],
        activeSummary: null,
        nav: "live",
      });
      void get().loadHistory();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Could not start session" });
    }
  },

  pruneHistory: async () => {
    try {
      await pruneHistory();
      await get().loadHistory();
      set({ toast: "History cleaned" });
      window.setTimeout(() => set({ toast: null }), 2000);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Prune failed" });
    }
  },
}));

export function setLayoutPersisted(layout: LayoutMode) {
  localStorage.setItem("rc_layout", layout);
  useAppStore.getState().setLayout(layout);
}
