import { useEffect, useMemo, useState } from "react";
import {
  QUICK_CHIPS,
  computeMatchAnalytics,
  formatGameClock,
} from "@riftcoach/shared";
import {
  listEnglishVoices,
  STYLE_PRESETS,
  VOICE_VOLUME_MAX,
  VOICE_VOLUME_MIN,
  XAI_VOICES,
  stopSpeaking,
  volumePercentLabel,
  type TtsEngine,
  type VoiceStyle,
} from "./lib/voice";
import { hpPct, modeFullLabel, modeLabel } from "./lib/modeLabel";
import { setLayoutPersisted, useAppStore } from "./stores/useAppStore";

export default function App() {
  const {
    nav,
    setNav,
    layout,
    agentStatus,
    agentMessage,
    mock,
    context,
    messages,
    sessionId,
    input,
    setInput,
    streaming,
    calloutsEnabled,
    setCalloutsEnabled,
    voiceOverEnabled,
    setVoiceOverEnabled,
    voicePrefs,
    setVoiceRate,
    setVoiceVolume,
    setVoicePitch,
    setVoiceURI,
    setVoiceStyle,
    setTtsEngine,
    setCloudVoice,
    testVoiceOver,
    voiceError,
    alwaysListen,
    visionOnAsk,
    setVisionOnAsk,
    listening,
    history,
    activeSummary,
    toast,
    error,
    init,
    sendMessage,
    sendChip,
    analyzeScreen,
    loadHistory,
    openHistorySession,
    finishGame,
    startVoice,
    stopVoice,
    toggleAlwaysListen,
    newSession,
    pruneHistory,
    costSaver,
    setUrgentVoiceOnly,
    goals,
    lastGrade,
    champSelect,
    deathReport,
    requestChampSelectPlan,
    coachDebug,
    coachBrain,
    coachSilence,
    nextQueueLo,
  } = useAppStore();

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const refresh = () => setVoices(listEnglishVoices());
    refresh();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    const el = document.getElementById("chat-end");
    el?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (nav === "history") void loadHistory();
  }, [nav, loadHistory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        void sendChip("what_now", "What now?");
      } else if (k === "m") {
        e.preventDefault();
        setVoiceOverEnabled(!useAppStore.getState().voiceOverEnabled);
      } else if (k === "l") {
        e.preventDefault();
        toggleAlwaysListen();
      } else if (k === "k") {
        e.preventDefault();
        stopSpeaking();
      } else if (k === "u") {
        e.preventDefault();
        setLayoutPersisted(useAppStore.getState().layout === "full" ? "compact" : "full");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendChip, setVoiceOverEnabled, toggleAlwaysListen]);

  const you = context.you;
  const live = agentStatus === "in_game" || agentStatus === "mock";
  const isRealLive = agentStatus === "in_game" && !mock;
  const modeShort = modeLabel(context.gameMode, context.mapName);
  const modeFull = modeFullLabel(context.gameMode, context.mapName);
  const hp = you ? hpPct(you.currentHealth, you.maxHealth) : null;
  const analytics = useMemo(
    () => (context.inGame && context.you ? computeMatchAnalytics(context) : null),
    [context]
  );
  const compact = layout === "compact";
  const showLive = nav === "live" || compact;
  const showHome = nav === "home" && !compact;
  const showHistory = nav === "history" && !compact;
  const showSettings = nav === "settings" && !compact;

  const statusLabel =
    agentStatus === "in_game"
      ? "Live"
      : agentStatus === "mock"
        ? "Mock"
        : agentStatus === "error"
          ? "Offline"
          : "Idle";

  const statusClass =
    agentStatus === "in_game" ? "is-live" : agentStatus === "mock" ? "is-mock" : "";

  const dotClass =
    agentStatus === "in_game" ? "live" : agentStatus === "mock" ? "mock" : "idle";

  const latestCallout = useMemo(
    () => [...messages].reverse().find((m) => m.role === "callout" && m.content.trim()),
    [messages]
  );

  const canSend = !streaming && Boolean(sessionId);

  return (
    <div className={`app layout-${layout}`}>
      {toast && <div className="toast">{toast}</div>}

      {coachDebug.text && (
        <div className="coach-debug" title={coachDebug.error || undefined}>
          <span className={`cd-src ${coachDebug.source}`}>{coachDebug.source}</span>
          <span className="cd-kind">{coachDebug.kind}</span>
          <span className="cd-ms">{coachDebug.latencyMs}ms</span>
          <span className="cd-text">{coachDebug.text}</span>
          {coachDebug.error && <span className="cd-err">{coachDebug.error}</span>}
        </div>
      )}

      {live && coachSilence && !coachDebug.text && (
        <div className="coach-silence" title="Silence is intentional — no high-score insight">
          {coachSilence}
        </div>
      )}

      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <img className="brand-icon" src="/icon.jpg" alt="" width={26} height={26} />
            <span className="brand-name">LOLCallout</span>
          </div>
          <div className={`status-pill ${statusClass}`} title={agentMessage}>
            <span className={`dot ${dotClass}`} />
            <span>{statusLabel}</span>
            {live && (
              <>
                <span className="mode-tag">{modeShort}</span>
                {you && (
                  <span className="mono">
                    {formatGameClock(context.gameTime)} · {you.championName}
                    {you.isDead ? " · DEAD" : ""}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`chip ${voiceOverEnabled ? "chip-on" : ""}`}
            title="Ctrl+Shift+M"
            onClick={() => setVoiceOverEnabled(!voiceOverEnabled)}
          >
            {voiceOverEnabled ? "🔊 Voice" : "🔇 Voice"}
          </button>
          <label className="vol-chip" title="Coach volume (boost past 100%)">
            <span className="vol-chip-ico">🔈</span>
            <input
              type="range"
              min={VOICE_VOLUME_MIN}
              max={VOICE_VOLUME_MAX}
              step={0.05}
              value={voicePrefs.volume}
              onChange={(e) => setVoiceVolume(Number(e.target.value))}
              aria-label="Coach voice volume"
            />
            <span className="mono vol-chip-pct">{volumePercentLabel(voicePrefs.volume)}</span>
          </label>
          {!compact && (
            <button
              type="button"
              className="chip"
              title="Test coach audio"
              onClick={() => testVoiceOver()}
            >
              ▶ Test
            </button>
          )}
          <button
            type="button"
            className={`chip ${alwaysListen || listening ? "chip-on" : ""}`}
            title="Ctrl+Shift+L"
            onClick={() => toggleAlwaysListen()}
          >
            {alwaysListen ? "🎙 LIVE" : "🎙"}
          </button>
          <button
            type="button"
            className="chip icon"
            title="Stop speech (Ctrl+Shift+K)"
            onClick={() => stopSpeaking()}
          >
            ⏹
          </button>
          <button
            type="button"
            className="chip"
            title="Ctrl+Shift+U"
            onClick={() => setLayoutPersisted(compact ? "full" : "compact")}
          >
            {compact ? "Full" : "Compact"}
          </button>
        </div>
      </header>

      {/* In-game stats strip — compact always; full only when live */}
      {(compact || live) && (
        <div className={`live-strip ${you ? "" : "hidden"}`}>
          {you ? (
            <>
              <div className="live-stat">
                <span className="lbl">Champ</span>
                <span className="val">
                  {you.championName} L{you.level}
                  {you.isDead ? <span className="dead-badge"> DEAD</span> : null}
                </span>
                {hp != null && !you.isDead && (
                  <div
                    className={`live-hp ${hp < 30 ? "danger" : hp < 55 ? "warn" : ""}`}
                    title={`${Math.round(hp)}% HP`}
                  >
                    <i style={{ width: `${hp}%` }} />
                  </div>
                )}
              </div>
              <div className="live-stat">
                <span className="lbl">KDA</span>
                <span className="val">
                  {you.kills}/{you.deaths}/{you.assists}
                </span>
              </div>
              <div className="live-stat">
                <span className="lbl">CS</span>
                <span className="val">{you.creeps}</span>
              </div>
              <div className="live-stat">
                <span className="lbl">Gold</span>
                <span className="val">{Math.round(you.currentGold)}</span>
              </div>
              <div className="live-stat grow">
                <span className="lbl">Clock</span>
                <span className="val">
                  {formatGameClock(context.gameTime)} · {modeShort}
                </span>
              </div>
              {deathReport && deathReport.total > 0 && (
                <div className="live-stat">
                  <span className="lbl">Deaths</span>
                  <span className="val">{deathReport.total}</span>
                </div>
              )}
              {coachBrain && (
                <div className={`live-stat brain-strip tempo-${coachBrain.tempo}`}>
                  <span className="lbl">Brain</span>
                  <span className="val mono">
                    {coachBrain.tempo.toUpperCase()}{" "}
                    {coachBrain.tempoScore >= 0 ? "+" : ""}
                    {coachBrain.tempoScore}
                    <span className="brain-strip-sep">·</span>
                    {coachBrain.focus}
                    <span className="brain-strip-sep">·</span>
                    {coachBrain.fightRole}
                  </span>
                </div>
              )}
              <button
                type="button"
                className="chip chip-primary"
                style={{ marginLeft: "auto", flexShrink: 0 }}
                disabled={streaming}
                title="Get a coaching line right now"
                onClick={() => void sendChip("what_now", "What now?")}
              >
                Coach me
              </button>
            </>
          ) : (
            <div className="live-stat grow">
              <span className="lbl">Status</span>
              <span className="val" style={{ color: "var(--muted)", fontFamily: "var(--font)" }}>
                {agentMessage || "Waiting for League…"}
              </span>
            </div>
          )}
        </div>
      )}

      {!compact && (
        <nav className="nav">
          <p className="nav-label">Navigate</p>
          {(
            [
              ["home", "Home"],
              ["live", "Live"],
              ["history", "History"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={nav === id ? "active" : ""}
              onClick={() => setNav(id)}
              type="button"
            >
              {label}
            </button>
          ))}
          <button type="button" className="chip" style={{ marginTop: 10 }} onClick={() => void newSession()}>
            New session
          </button>
          <div className="nav-footer">
            <div className="hotkey-help">
              <p className="panel-title">Hotkeys</p>
              <p className="muted small" style={{ margin: 0 }}>
                <kbd>Ctrl+Shift+C</kbd> What now
                <br />
                <kbd>Ctrl+Shift+M</kbd> Voice
                <br />
                <kbd>Ctrl+Shift+U</kbd> Compact
                <br />
                <kbd>Ctrl+Shift+K</kbd> Stop speech
              </p>
            </div>
            <p className="legal">Not endorsed by Riot. Live Client only.</p>
          </div>
        </nav>
      )}

      <main className="main">
        {showHome && (
          <div className="playtest-home">
            <h2>Playtest ready</h2>
            <p className="lead-home">
              Leave this window open, queue League, and the coach goes live automatically.
            </p>
            <ul className="checklist">
              <li className={agentStatus !== "error" ? "ok" : "bad"}>
                <div className="checklist-row">
                  <span className="checklist-ico">{agentStatus !== "error" ? "✓" : "!"}</span>
                  <span>
                    Agent {agentStatus === "error" ? "offline — run npm run dev" : "connected"}
                  </span>
                </div>
              </li>
              <li className={voiceOverEnabled ? "ok" : ""}>
                <div className="checklist-row">
                  <span className="checklist-ico">{voiceOverEnabled ? "✓" : "○"}</span>
                  <span>Voice {voiceOverEnabled ? "ON" : "off — click Voice in the top bar"}</span>
                </div>
              </li>
              <li>
                <div className="checklist-row">
                  <span className="checklist-ico">▶</span>
                  <button type="button" className="chip chip-on" onClick={() => testVoiceOver()}>
                    Test voice
                  </button>
                </div>
                {voiceError ? (
                  <span className="err">{voiceError}</span>
                ) : (
                  <span className="muted small">Click once to unlock Windows audio for callouts</span>
                )}
              </li>
              <li className={isRealLive ? "ok" : champSelect?.active ? "ok" : ""}>
                <div className="checklist-row">
                  <span className="checklist-ico">{isRealLive ? "✓" : "○"}</span>
                  <span>
                    {isRealLive
                      ? `In game — ${modeFull} · ${you?.championName || "?"}`
                      : champSelect?.active
                        ? "Champ select detected"
                        : "Waiting for League…"}
                  </span>
                </div>
              </li>
            </ul>
            <p className="muted" style={{ marginTop: 10 }}>
              {agentMessage}
            </p>
            <div className="chips" style={{ justifyContent: "center", marginTop: 16 }}>
              <button
                type="button"
                className="chip chip-primary"
                disabled={streaming}
                onClick={() => {
                  setNav("live");
                  void sendChip("what_now", "What now?");
                }}
              >
                Coach me now
              </button>
              <button type="button" className="chip" onClick={() => setNav("live")}>
                Open Live
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setLayoutPersisted("compact")}
              >
                Compact mode
              </button>
              {champSelect?.active && (
                <button
                  type="button"
                  className="chip"
                  disabled={streaming}
                  onClick={() => void requestChampSelectPlan()}
                >
                  Champ plan
                </button>
              )}
            </div>
          </div>
        )}

        {showLive && (
          <div className="chat">
            {!isRealLive && messages.length <= 2 && (
              <div className="waiting-banner">
                <strong>Waiting for a live game</strong>
                <p>
                  Queue up — status turns green and the coach arms. Press{" "}
                  <kbd>Ctrl+Shift+C</kbd> for What now.
                </p>
              </div>
            )}

            {compact && latestCallout && (
              <div className="msg callout" style={{ order: -1 }}>
                <div className="meta">Latest coach</div>
                {latestCallout.content}
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="meta">
                  {m.role === "assistant"
                    ? "Coach"
                    : m.role === "callout"
                      ? "Live callout"
                      : m.role === "system"
                        ? "System"
                        : "You"}
                  {streaming &&
                  m === messages[messages.length - 1] &&
                  (m.role === "assistant" || m.role === "callout")
                    ? " · …"
                    : ""}
                </div>
                {m.content || (streaming ? "…" : "")}
              </div>
            ))}

            {lastGrade && (
              <div className="summary-card grade-card">
                <div className="meta">Match grade</div>
                <strong className="grade-letter">{lastGrade.letter}</strong>
                <span className="muted"> {lastGrade.score}/100</span>
                <ul>
                  {lastGrade.goals.map((g) => (
                    <li key={g.id}>
                      {g.passed ? "✓" : "✗"} {g.detail}
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {lastGrade.habits.join(" · ")}
                </p>
              </div>
            )}
            {activeSummary && (
              <div className="summary-card">
                <div className="meta">Post-game</div>
                {activeSummary.scoreline && <strong>{activeSummary.scoreline}</strong>}
                <ul>
                  {activeSummary.focusAreas.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            <div id="chat-end" />
          </div>
        )}

        {showHistory && (
          <div className="history-panel">
            <h2>Match history</h2>
            <p className="muted">Real live matches only.</p>
            <button type="button" className="chip" onClick={() => void pruneHistory()}>
              Clean empty sessions
            </button>
            <ul className="history-list">
              {history.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void openHistorySession(s.id)}>
                    <strong>{s.title || s.champion || "Match"}</strong>
                    <span className="muted">
                      {new Date(s.createdAt).toLocaleString()}
                      {s.maxGameTime ? ` · ${Math.floor(s.maxGameTime / 60)} min` : ""}
                      {s.messageCount ? ` · ${s.messageCount} msgs` : ""}
                    </span>
                  </button>
                </li>
              ))}
              {history.length === 0 && (
                <li className="muted">No matches yet — finish a live game with coach on.</li>
              )}
            </ul>
          </div>
        )}

        {showSettings && (
          <div className="settings-panel">
            <h2>Settings</h2>
            <p className="muted">Playtest voice, callouts, and layout.</p>

            <h3 className="settings-sub">Playtest</h3>
            <label className="toggle">
              <input
                type="checkbox"
                checked={localStorage.getItem("rc_auto_compact") !== "0"}
                onChange={(e) => {
                  localStorage.setItem("rc_auto_compact", e.target.checked ? "1" : "0");
                }}
              />
              Auto-compact when a live game starts
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={calloutsEnabled}
                onChange={(e) => setCalloutsEnabled(e.target.checked)}
              />
              Automatic live callouts
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={costSaver.urgentVoiceOnly}
                onChange={(e) => setUrgentVoiceOnly(e.target.checked)}
              />
              Cost Saver — still event-driven (not a timer)
            </label>
            <p className="settings-sub">Coach intensity</p>
            <div className="style-row">
              {(
                [
                  ["quiet", "Quiet"],
                  ["normal", "Normal"],
                  ["talkative", "Talkative"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${
                    (localStorage.getItem("rc_coach_intensity") || "normal") === id
                      ? "chip-on"
                      : ""
                  }`}
                  onClick={() => {
                    localStorage.setItem("rc_coach_intensity", id);
                    useAppStore.setState({ toast: `Coach intensity: ${label}` });
                    window.setTimeout(() => {
                      if (useAppStore.getState().toast?.startsWith("Coach intensity")) {
                        useAppStore.setState({ toast: null });
                      }
                    }, 2000);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Quiet = only high-impact moments. Talkative = lower insight threshold. Never a 30s
              metronome.
            </p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={voiceOverEnabled}
                onChange={(e) => setVoiceOverEnabled(e.target.checked)}
              />
              Voice-over ON
            </label>

            <div className="voice-controls">
              <p className="settings-sub" style={{ marginTop: 4 }}>
                Voice
              </p>
              <div className="style-row">
                {(
                  [
                    ["xai", "Natural (xAI)"],
                    ["elevenlabs", "My voice"],
                    ["browser", "Browser"],
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
                <label className="slider-label">
                  xAI voice
                  <select
                    className="voice-select"
                    value={voicePrefs.cloudVoice || "leo"}
                    onChange={(e) => setCloudVoice(e.target.value)}
                  >
                    {XAI_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {voicePrefs.engine === "elevenlabs" && (
                <label className="slider-label">
                  ElevenLabs Voice ID
                  <input
                    className="voice-select"
                    value={voicePrefs.cloudVoice}
                    onChange={(e) => setCloudVoice(e.target.value.trim())}
                    placeholder="voice_id"
                  />
                </label>
              )}
              {voicePrefs.engine === "browser" && (
                <label className="slider-label">
                  System voice
                  <select
                    className="voice-select"
                    value={voicePrefs.voiceURI}
                    onChange={(e) => setVoiceURI(e.target.value)}
                  >
                    <option value="">Auto</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="style-row">
                {(Object.keys(STYLE_PRESETS) as VoiceStyle[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${voicePrefs.style === key ? "chip-on" : ""}`}
                    onClick={() => setVoiceStyle(key)}
                  >
                    {STYLE_PRESETS[key].label}
                  </button>
                ))}
              </div>
              <label className="slider-label">
                Coach volume <span className="mono">{volumePercentLabel(voicePrefs.volume)}</span>
                <input
                  type="range"
                  min={VOICE_VOLUME_MIN}
                  max={VOICE_VOLUME_MAX}
                  step={0.05}
                  value={voicePrefs.volume}
                  onChange={(e) => setVoiceVolume(Number(e.target.value))}
                />
              </label>
              <label className="slider-label">
                Speed <span className="mono">{voicePrefs.rate.toFixed(2)}×</span>
                <input
                  type="range"
                  min={0.6}
                  max={1.15}
                  step={0.01}
                  value={voicePrefs.rate}
                  onChange={(e) => setVoiceRate(Number(e.target.value))}
                />
              </label>
              {voicePrefs.engine === "browser" && (
                <label className="slider-label">
                  Pitch <span className="mono">{voicePrefs.pitch.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.75}
                    max={1.15}
                    step={0.01}
                    value={voicePrefs.pitch}
                    onChange={(e) => setVoicePitch(Number(e.target.value))}
                  />
                </label>
              )}
              <button type="button" className="chip chip-on" onClick={() => testVoiceOver()}>
                ▶ Test voice
              </button>
              {voiceError && <p className="err">{voiceError}</p>}
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={visionOnAsk}
                onChange={(e) => setVisionOnAsk(e.target.checked)}
              />
              Attach screen on every ask (heavy)
            </label>
            {error && <p className="err">{error}</p>}
          </div>
        )}
      </main>

      {!compact && (
        <aside className="hud">
          {champSelect?.active && (
            <div className="stat-card gold-border">
              <h3>Champ select</h3>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {champSelect.assignedPosition || "role n/a"}
              </p>
              <button
                type="button"
                className="chip chip-primary"
                disabled={streaming}
                onClick={() => void requestChampSelectPlan()}
              >
                Get plan
              </button>
            </div>
          )}

          <p className="panel-title">Coach brain</p>
          {coachBrain ? (
            <div className="stat-card brain-card">
              <div className={`brain-hud tempo-${coachBrain.tempo}`}>
                <span className="brain-tempo">
                  {coachBrain.tempo.toUpperCase()}{" "}
                  <span className="mono">
                    {coachBrain.tempoScore >= 0 ? "+" : ""}
                    {coachBrain.tempoScore}
                  </span>
                </span>
                <span className="brain-focus">{coachBrain.focus}</span>
                <span className="brain-fight">{coachBrain.fightRole}</span>
                {coachBrain.load === "high" && (
                  <span className="brain-load">LOAD↑</span>
                )}
                {coachBrain.load === "medium" && (
                  <span className="brain-load med">LOAD</span>
                )}
              </div>
              <p className="brain-value">
                <strong>Now:</strong> {coachBrain.highestValue}
              </p>
              <p className="brain-lo">
                <strong>LO:</strong> {coachBrain.learningObjective}
              </p>
              {coachBrain.winConLine && (
                <p className="brain-wincon">
                  <strong>Win:</strong> {coachBrain.winConLine}
                </p>
              )}
              {coachBrain.mapClock && (
                <p className="brain-mapclock muted">
                  <strong>Clock:</strong> {coachBrain.mapClock}
                </p>
              )}
              {coachBrain.throwLadder && (
                <p className="brain-risk">Throw ladder: {coachBrain.throwLadder}</p>
              )}
              {coachBrain.nextMinute.length > 0 && (
                <ol className="brain-next">
                  {coachBrain.nextMinute.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
              {coachBrain.threat && (
                <p className="items-line brain-threat">
                  Threat: <strong>{coachBrain.threat}</strong>
                  {coachBrain.threatSeverity
                    ? ` (${coachBrain.threatSeverity})`
                    : ""}
                </p>
              )}
              {coachBrain.counterplay && (
                <p className="brain-counter muted">
                  Counter: {coachBrain.counterplay}
                </p>
              )}
              {coachBrain.topRisk && (
                <p className="brain-risk">Risk: {coachBrain.topRisk}</p>
              )}
              {coachBrain.checklistWorth && (
                <p className="brain-check muted">
                  Worth it? {coachBrain.checklistWorth}
                </p>
              )}
              <p className="brain-meta muted">
                {coachBrain.pattern} · {coachBrain.fightRoleNote}
              </p>
            </div>
          ) : (
            <div className="stat-card brain-idle">
              <p className="muted" style={{ margin: 0 }}>
                Brain arms in a live game — tempo, fight role, LO, next plays.
              </p>
              {nextQueueLo && (
                <p className="brain-lo" style={{ marginTop: 10 }}>
                  {nextQueueLo}
                </p>
              )}
            </div>
          )}

          <p className="panel-title">Premium analytics</p>
          {analytics ? (
            <div className="stat-card analytics-card">
              <div className={`pressure-pill pressure-${analytics.pressure}`}>
                {analytics.pressure.toUpperCase()}
                <span className="mono">
                  {" "}
                  {analytics.killLead >= 0 ? "+" : ""}
                  {analytics.killLead} K
                </span>
              </div>
              <p className="analytics-wincon">
                <strong>Win con:</strong> {analytics.winCon.replace(/_/g, " ")}
              </p>
              <div className="stat-grid">
                <div>
                  <span>Team</span>
                  <br />
                  <strong>
                    {analytics.team.kills}/{analytics.team.deaths}
                  </strong>
                  <span className="muted"> · {analytics.team.alive} up</span>
                </div>
                <div>
                  <span>Enemy</span>
                  <br />
                  <strong>
                    {analytics.enemy.kills}/{analytics.enemy.deaths}
                  </strong>
                  <span className="muted"> · {analytics.enemy.alive} up</span>
                </div>
                <div>
                  <span>CS/m</span>
                  <br />
                  <strong>{analytics.you.cspm.toFixed(1)}</strong>
                </div>
                <div>
                  <span>Role</span>
                  <br />
                  <strong>{analytics.you.roleHint}</strong>
                </div>
              </div>
              {analytics.fedEnemies[0] && (
                <p className="items-line">Threat: {analytics.fedEnemies.join(", ")}</p>
              )}
              {analytics.you.powerSpike && (
                <p className="items-line">Spike: {analytics.you.powerSpike}</p>
              )}
              {analytics.objectiveWindows[0] && (
                <p className="items-line">Window: {analytics.objectiveWindows[0]}</p>
              )}
              <ul className="event-list analytics-insights">
                {analytics.insights.slice(0, 3).map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="stat-card">
              <p className="muted" style={{ margin: 0 }}>
                Analytics arm when you enter a live game.
              </p>
            </div>
          )}

          <p className="panel-title">Live HUD</p>
          {you ? (
            <div className="stat-card">
              <h3>
                {you.championName}{" "}
                <span className="muted">
                  L{you.level} · {modeShort}
                </span>
                {you.isDead ? <span className="dead-tag"> DEAD</span> : null}
              </h3>
              {hp != null && (
                <div className="hp-bar-wrap" title={`HP ${Math.round(hp)}%`}>
                  <div
                    className={`hp-bar ${hp < 30 ? "danger" : hp < 55 ? "warn" : ""}`}
                    style={{ width: `${hp}%` }}
                  />
                </div>
              )}
              <div className="stat-grid">
                <div>
                  <span>KDA</span>
                  <br />
                  <strong>
                    {you.kills}/{you.deaths}/{you.assists}
                  </strong>
                </div>
                <div>
                  <span>CS</span>
                  <br />
                  <strong>{you.creeps}</strong>
                </div>
                <div>
                  <span>Gold</span>
                  <br />
                  <strong>{Math.round(you.currentGold)}</strong>
                </div>
                <div>
                  <span>Clock</span>
                  <br />
                  <strong>{formatGameClock(context.gameTime)}</strong>
                </div>
              </div>
              {you.items && you.items.length > 0 && (
                <p className="items-line">{you.items.filter(Boolean).slice(0, 6).join(" · ")}</p>
              )}
            </div>
          ) : (
            <div className="stat-card">
              <h3>Waiting</h3>
              <p className="muted" style={{ margin: 0 }}>
                {agentMessage}
              </p>
            </div>
          )}

          {deathReport && deathReport.total > 0 && (
            <div className="stat-card">
              <h3>Deaths {deathReport.total}</h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                E{deathReport.early} · M{deathReport.mid} · L{deathReport.late}
                {deathReport.dominant ? ` · ${deathReport.dominant}` : ""}
              </p>
            </div>
          )}

          <p className="panel-title">Goals</p>
          <ul className="event-list">
            {goals.map((g) => (
              <li key={g.id}>
                {g.label}: <strong style={{ color: "var(--text)" }}>{g.target}</strong>
              </li>
            ))}
          </ul>

          <p className="panel-title">Events</p>
          <ul className="event-list">
            {(context.recentEvents || []).slice(-5).map((e, i) => (
              <li key={`${e.type}-${e.gameTime}-${i}`}>
                <strong>{formatGameClock(e.gameTime)}</strong> {e.type}
                {e.message ? ` — ${e.message}` : ""}
              </li>
            ))}
            {(!context.recentEvents || context.recentEvents.length === 0) && (
              <li>No events yet</li>
            )}
          </ul>

          {mock && <p className="warn-line">Mock data — real games only for history.</p>}

          <button
            type="button"
            className="chip block"
            disabled={streaming}
            onClick={() => void finishGame("unknown")}
          >
            End game + grade
          </button>
        </aside>
      )}

      <footer className="composer">
        {error && <div className="err">{error}</div>}

        {compact ? (
          <div className="compact-actions">
            <button
              type="button"
              className="chip chip-primary"
              disabled={!canSend}
              onClick={() => void sendChip("what_now", "What now?")}
            >
              What now?
            </button>
            <button
              type="button"
              className="chip"
              disabled={!canSend}
              onClick={() => void sendChip("why_die", "Why did I die?")}
            >
              Why die?
            </button>
            <button
              type="button"
              className="chip"
              disabled={!canSend}
              onClick={() => void sendChip("item", "Item?")}
            >
              Item?
            </button>
            <button type="button" className="chip" onClick={() => testVoiceOver()}>
              ▶ Test
            </button>
          </div>
        ) : (
          <div className="chips">
            {QUICK_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${c.id === "what_now" ? "chip-primary" : ""}`}
                disabled={!canSend}
                onClick={() => void sendChip(c.id, c.label)}
              >
                {c.label}
              </button>
            ))}
            <button type="button" className="chip" disabled={streaming} onClick={() => void analyzeScreen()}>
              Analyze screen
            </button>
            <button
              type="button"
              className="chip"
              disabled={streaming}
              onClick={() => void requestChampSelectPlan()}
            >
              Champ plan
            </button>
          </div>
        )}

        <form
          className="compose-row"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <button
            type="button"
            className={`mic ${listening || alwaysListen ? "on" : ""}`}
            title="Mic"
            onClick={() => {
              if (alwaysListen || listening) stopVoice();
              else startVoice({ continuous: false });
            }}
          >
            {alwaysListen ? "LIVE" : listening ? "●" : "Mic"}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isRealLive
                ? `Ask coach… (${modeShort} · ${you?.championName || "you"})`
                : "Ask the coach anything…"
            }
            disabled={streaming}
            aria-label="Message coach"
          />
          {!compact && (
            <label className="chip file-chip" title="Attach screenshot">
              📎
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const data = String(reader.result || "");
                    const base64 = data.split(",")[1];
                    if (base64) {
                      void sendMessage(input || "What do you see?", "free", true, {
                        base64,
                        mime: file.type || "image/jpeg",
                      });
                    }
                  };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <button className="send" type="submit" disabled={streaming || !input.trim()}>
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
