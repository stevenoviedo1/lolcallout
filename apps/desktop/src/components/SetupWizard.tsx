import { useMemo, useState } from "react";
import {
  STYLE_PRESETS,
  VOICE_VOLUME_MAX,
  VOICE_VOLUME_MIN,
  XAI_VOICES,
  unlockAudio,
  volumePercentLabel,
  welcomeVoice,
  type TtsEngine,
  type VoiceStyle,
} from "../lib/voice";
import {
  getAutoCompact,
  getCoachIntensity,
  markSetupComplete,
  setAutoCompact,
  setCoachIntensity,
  type CoachIntensity,
} from "../lib/setupPrefs";
import { setLayoutPersisted, useAppStore } from "../stores/useAppStore";

const STEPS = [
  { id: "welcome", title: "Welcome", blurb: "Your live duo coach" },
  { id: "callouts", title: "Callouts", blurb: "Personality, density, what you hear" },
  { id: "voice", title: "Voice", blurb: "How the coach sounds" },
  { id: "play", title: "Play setup", blurb: "Layout & HUD" },
  { id: "ready", title: "You're set", blurb: "Queue when ready" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const FOCUS_OPTIONS: {
  id: string;
  label: string;
  detail: string;
}[] = [
  {
    id: "ranked",
    label: "Ranked / climb",
    detail: "Tempo, deaths, objectives — competitive focus",
  },
  {
    id: "improve",
    label: "Get better",
    detail: "Habits, death patterns, clear next plays",
  },
  {
    id: "fun",
    label: "Norms / fun",
    detail: "Helpful tips without sweating every fight",
  },
  {
    id: "aram",
    label: "ARAM / rotating modes",
    detail: "Teamfight timing, less farm pressure",
  },
];

export function SetupWizard({
  onDone,
}: {
  onDone: () => void;
}) {
  const {
    calloutsEnabled,
    setCalloutsEnabled,
    voiceOverEnabled,
    setVoiceOverEnabled,
    voicePrefs,
    setVoiceStyle,
    setTtsEngine,
    setCloudVoice,
    setVoiceVolume,
    setVoiceRate,
    testVoiceOver,
    costSaver,
    setUrgentVoiceOnly,
    layout,
    alwaysListen,
    setAlwaysListen,
  } = useAppStore();

  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState(() => {
    try {
      return localStorage.getItem("rc_play_focus") || "ranked";
    } catch {
      return "ranked";
    }
  });
  const [intensity, setIntensity] = useState<CoachIntensity>(() => getCoachIntensity());
  const [autoCompact, setAutoCompactLocal] = useState(() => getAutoCompact());

  const current = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  const applyFocusDefaults = (id: string) => {
    setFocus(id);
    try {
      localStorage.setItem("rc_play_focus", id);
    } catch {
      /* ignore */
    }
    // Soft defaults per play style (user can still tweak later steps)
    if (id === "fun") {
      setIntensity("quiet");
      setUrgentVoiceOnly(true);
    } else if (id === "aram") {
      setIntensity("normal");
      setUrgentVoiceOnly(false);
    } else if (id === "improve") {
      setIntensity("talkative");
      setUrgentVoiceOnly(false);
    } else {
      setIntensity("normal");
      setUrgentVoiceOnly(false);
    }
  };

  const finish = () => {
    setCoachIntensity(intensity);
    setAutoCompact(autoCompact);
    // Callouts / voice already live in the store from this wizard
    markSetupComplete();
    // User gesture: unlock autoplay + short confirmation so in-game callouts work
    void unlockAudio().then(() => {
      if (voiceOverEnabled) {
        welcomeVoice(voicePrefs);
      }
    });
    onDone();
  };

  const next = () => {
    if (step >= STEPS.length - 1) {
      finish();
      return;
    }
    // Persist intensity as they leave callouts step
    if (current.id === "callouts") {
      setCoachIntensity(intensity);
    }
    if (current.id === "play") {
      setAutoCompact(autoCompact);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => setStep((s) => Math.max(0, s - 1));

  const skipAll = () => {
    // Sensible competitive defaults
    setCalloutsEnabled(true);
    setVoiceOverEnabled(true);
    setCoachIntensity("normal");
    setUrgentVoiceOnly(false);
    setAutoCompact(true);
    markSetupComplete();
    // Still unlock audio from this click so later callouts can play
    void unlockAudio().then(() => welcomeVoice(voicePrefs));
    onDone();
  };

  const summary = useMemo(() => {
    const eng =
      voicePrefs.engine === "xai"
        ? `Natural · ${voicePrefs.cloudVoice || "leo"}`
        : voicePrefs.engine === "elevenlabs"
          ? "My voice clone"
          : "Browser voice";
    return [
      `Focus: ${FOCUS_OPTIONS.find((f) => f.id === focus)?.label || focus}`,
      `Callouts: ${calloutsEnabled ? "on" : "off"} · ${intensity}${
        costSaver.urgentVoiceOnly ? " · impact-only" : ""
      }`,
      `Voice: ${eng} · ${STYLE_PRESETS[voicePrefs.style].label} · ${volumePercentLabel(
        voicePrefs.volume
      )}`,
      `HUD: ${layout === "compact" ? "Compact" : "Full"}${
        autoCompact ? " · auto-compact in game" : ""
      }`,
    ];
  }, [
    focus,
    calloutsEnabled,
    intensity,
    costSaver.urgentVoiceOnly,
    voicePrefs,
    layout,
    autoCompact,
  ]);

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-glow" aria-hidden />
        <header className="setup-header">
          <div className="setup-brand">
            <img src="/logo-circle.png" alt="" width={40} height={40} />
            <div>
              <p className="setup-eyebrow">First-time setup</p>
              <h1>Personalize LOLCallout</h1>
            </div>
          </div>
          <button type="button" className="setup-skip" onClick={skipAll}>
            Skip — use defaults
          </button>
        </header>

        <div className="setup-progress" aria-hidden>
          <i style={{ width: `${progress}%` }} />
        </div>

        <nav className="setup-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`setup-step-dot ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}
              onClick={() => setStep(i)}
              title={s.title}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="setup-step-num">{i + 1}</span>
              <span className="setup-step-label">{s.title}</span>
            </button>
          ))}
        </nav>

        <div className="setup-body">
          <p className="setup-step-title">{current.title}</p>
          <p className="setup-step-blurb muted">{current.blurb}</p>

          {current.id === "welcome" && (
            <div className="setup-panel">
              <p className="setup-copy">
                LOLCallout is a side coach for League — live callouts, voice in your ear, and
                post-game grades. Nothing injects into the game; we only use the official Live
                Client API.
              </p>
              <p className="setup-copy muted">What are you here for? (sets smart defaults)</p>
              <div className="setup-cards">
                {FOCUS_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`setup-choice ${focus === f.id ? "on" : ""}`}
                    onClick={() => applyFocusDefaults(f.id)}
                  >
                    <strong>{f.label}</strong>
                    <span>{f.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {current.id === "callouts" && (
            <div className="setup-panel">
              <p className="setup-copy">
                Pick a personality and how often the coach speaks. Field-aware callouts only fire
                when the board changes — not a timer.
              </p>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={calloutsEnabled}
                  onChange={(e) => setCalloutsEnabled(e.target.checked)}
                />
                <span>
                  <strong>Automatic live callouts</strong>
                  <span className="muted"> — deaths, HP, numbers, ult threats, convert windows</span>
                </span>
              </label>
              <p className="setup-section-label">Personality</p>
              <div className="setup-chips">
                {(
                  [
                    ["friend", "Friend coach", "Calm supportive duo — clear next plays"],
                    ["hype", "AI bro", "Normal talk like a friend — not robot callouts"],
                  ] as const
                ).map(([id, label, detail]) => {
                  const on =
                    (localStorage.getItem("rc_coach_personality") || "friend") === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`setup-choice compact ${on ? "on" : ""}`}
                      onClick={() => localStorage.setItem("rc_coach_personality", id)}
                      disabled={!calloutsEnabled}
                    >
                      <strong>{label}</strong>
                      <span>{detail}</span>
                    </button>
                  );
                })}
              </div>
              <p className="setup-section-label">Density</p>
              <div className="setup-chips">
                {(
                  [
                    ["quiet", "Quiet", "Only the highest-value lines"],
                    ["normal", "Normal", "Balanced for ranked"],
                    ["talkative", "Talkative", "More board changes → more tips"],
                  ] as [CoachIntensity, string, string][]
                ).map(([id, label, detail]) => (
                  <button
                    key={id}
                    type="button"
                    className={`setup-choice compact ${intensity === id ? "on" : ""}`}
                    onClick={() => setIntensity(id)}
                    disabled={!calloutsEnabled}
                  >
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </button>
                ))}
              </div>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={costSaver.urgentVoiceOnly}
                  onChange={(e) => setUrgentVoiceOnly(e.target.checked)}
                  disabled={!calloutsEnabled}
                />
                <span>
                  <strong>Impact-only voice</strong>
                  <span className="muted"> — fewer lines (death, low HP, numbers, kills…)</span>
                </span>
              </label>
            </div>
          )}

          {current.id === "voice" && (
            <div className="setup-panel">
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={voiceOverEnabled}
                  onChange={(e) => setVoiceOverEnabled(e.target.checked)}
                />
                <span>
                  <strong>Coach voice ON</strong>
                  <span className="muted"> — speak callouts out loud</span>
                </span>
              </label>

              <p className="setup-section-label">Engine</p>
              <div className="setup-chips row">
                {(
                  [
                    ["xai", "Natural (xAI)"],
                    ["browser", "Browser"],
                    ["elevenlabs", "My clone"],
                  ] as [TtsEngine, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`chip ${voicePrefs.engine === id ? "chip-on" : ""}`}
                    onClick={() => setTtsEngine(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {voicePrefs.engine === "xai" && (
                <>
                  <p className="setup-section-label">xAI voice</p>
                  <div className="setup-chips row">
                    {XAI_VOICES.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`chip ${
                          (voicePrefs.cloudVoice || "leo") === v.id ? "chip-on" : ""
                        }`}
                        onClick={() => setCloudVoice(v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <p className="setup-section-label">Style</p>
              <div className="setup-chips row">
                {(Object.keys(STYLE_PRESETS) as VoiceStyle[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${voicePrefs.style === key ? "chip-on" : ""}`}
                    onClick={() => setVoiceStyle(key)}
                    title={STYLE_PRESETS[key].blurb}
                  >
                    {STYLE_PRESETS[key].label}
                  </button>
                ))}
              </div>

              <label className="setup-slider">
                <span>
                  Volume <strong className="mono">{volumePercentLabel(voicePrefs.volume)}</strong>
                </span>
                <input
                  type="range"
                  min={VOICE_VOLUME_MIN}
                  max={VOICE_VOLUME_MAX}
                  step={0.05}
                  value={voicePrefs.volume}
                  onChange={(e) => setVoiceVolume(Number(e.target.value))}
                />
              </label>
              <label className="setup-slider">
                <span>
                  Speed <strong className="mono">{voicePrefs.rate.toFixed(2)}×</strong>
                </span>
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.02}
                  value={voicePrefs.rate}
                  onChange={(e) => setVoiceRate(Number(e.target.value))}
                />
              </label>

              <button
                type="button"
                className="chip chip-primary setup-test-voice"
                onClick={() => testVoiceOver()}
              >
                ▶ Test voice
              </button>
              <p className="muted setup-hint">
                Click Test once so the browser unlocks audio for later auto-callouts.
              </p>
            </div>
          )}

          {current.id === "play" && (
            <div className="setup-panel">
              <p className="setup-section-label">Default layout</p>
              <div className="setup-cards">
                <button
                  type="button"
                  className={`setup-choice ${layout === "full" ? "on" : ""}`}
                  onClick={() => setLayoutPersisted("full")}
                >
                  <strong>Full window</strong>
                  <span>Chat, brain, callouts — great on a second monitor</span>
                </button>
                <button
                  type="button"
                  className={`setup-choice ${layout === "compact" ? "on" : ""}`}
                  onClick={() => setLayoutPersisted("compact")}
                >
                  <strong>Compact HUD</strong>
                  <span>Minimal overlay for one-screen play</span>
                </button>
              </div>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={autoCompact}
                  onChange={(e) => setAutoCompactLocal(e.target.checked)}
                />
                <span>
                  <strong>Auto-compact when a live game starts</strong>
                </span>
              </label>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={alwaysListen}
                  onChange={(e) => setAlwaysListen(e.target.checked)}
                />
                <span>
                  <strong>Always-listen mic</strong>
                  <span className="muted">
                    {" "}
                    — say “Coach …” then your question; friend chat is ignored
                  </span>
                </span>
              </label>
              <p className="muted setup-hint">
                You can change everything later in Settings. Shortcut: Compact = Ctrl+Shift+U.
              </p>
            </div>
          )}

          {current.id === "ready" && (
            <div className="setup-panel">
              <p className="setup-copy">
                You’re ready. Open League, queue a game, and keep LOLCallout on a second monitor
                (or compact HUD).
              </p>
              <ul className="setup-summary">
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="setup-ready-tips">
                <p>
                  <strong>Tip:</strong> Click <em>▶ Test voice</em> once if you haven’t — unlocks
                  in-game audio.
                </p>
                <p>
                  <strong>Tip:</strong> Status should say <em>Live</em> when you’re in a match.
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="setup-footer">
          <button
            type="button"
            className="chip"
            onClick={back}
            disabled={step === 0}
          >
            Back
          </button>
          <div className="setup-footer-right">
            <span className="muted mono setup-page">
              {step + 1}/{STEPS.length}
            </span>
            <button type="button" className="send setup-next" onClick={next}>
              {step >= STEPS.length - 1 ? "Start coaching" : "Continue"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
