/** Voice: browser STT + browser/cloud TTS (xAI natural or your ElevenLabs clone) */

import { toSecondPersonCoach, toSpeakable } from "@riftcoach/shared";
import { API_URL } from "./config";
import { authHeaders } from "./authApi";

export type VoiceStyle = "competitive" | "calm" | "caster";
export type TtsEngine = "browser" | "xai" | "elevenlabs";

export interface VoicePrefs {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string;
  style: VoiceStyle;
  /** browser = robotic OS voices; xai = natural Grok TTS; elevenlabs = YOUR clone */
  engine: TtsEngine;
  /** xAI voice name or ElevenLabs voice_id */
  cloudVoice: string;
}

/** volume: 0.1–2.5 (100% = 1). Values above 1 boost Natural/xAI via Web Audio. */
export const VOICE_VOLUME_MIN = 0.1;
export const VOICE_VOLUME_MAX = 2.5;

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  rate: 0.88,
  pitch: 0.92,
  // 100% HTML element volume is the most reliable path in Electron.
  // Users can boost past 100% in Settings (decoded AudioBuffer path).
  volume: 1.0,
  voiceURI: "",
  style: "competitive",
  engine: "xai", // natural by default when API key works
  cloudVoice: "leo", // coach-like default among xAI voices
};

export function clampVoiceVolume(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_PREFS.volume;
  return Math.min(VOICE_VOLUME_MAX, Math.max(VOICE_VOLUME_MIN, n));
}

export function volumePercentLabel(v: number): string {
  return `${Math.round(clampVoiceVolume(v) * 100)}%`;
}

export const STYLE_PRESETS: Record<
  VoiceStyle,
  { rate: number; pitch: number; label: string; blurb: string }
> = {
  competitive: {
    rate: 0.88,
    pitch: 0.92,
    label: "Competitive",
    blurb: "Clear ranked comms — steady, not rushed",
  },
  calm: {
    rate: 0.8,
    pitch: 0.95,
    label: "Calm",
    blurb: "Slower review voice",
  },
  caster: {
    rate: 0.95,
    pitch: 1.0,
    label: "Caster",
    blurb: "A bit punchier, still controlled",
  },
};

export const XAI_VOICES = [
  { id: "leo", label: "Leo (recommended coach)" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
];

export function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function listEnglishVoices(): SpeechSynthesisVoice[] {
  if (!window.speechSynthesis) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^en(-|_|$)/i.test(v.lang) || /english/i.test(v.name))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

function scoreVoice(v: SpeechSynthesisVoice): number {
  let s = 0;
  const n = v.name;
  if (/en-US/i.test(v.lang)) s += 5;
  if (/Natural|Neural|Online|Google|Microsoft/i.test(n)) s += 8;
  if (/David|Guy|Mark|James|Ryan|Christopher|Eric|George|Brian|Tony|Richard/i.test(n)) s += 6;
  if (/Whisper|Robot|Bad|Joke|Evil|Cartoon/i.test(n)) s -= 20;
  return s;
}

export function pickCompetitiveVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI?: string
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  if (preferredURI) {
    const hit = voices.find((v) => v.voiceURI === preferredURI);
    if (hit) return hit;
  }
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
}

export { toSpeakable };

let speakQueue: Array<{ text: string; prefs: VoicePrefs }> = [];
let speaking = false;
/**
 * Monotonic generation. Every stopSpeaking() / interrupt bumps this so any
 * in-flight cloud fetch or browser utterance from an older generation is
 * discarded and never played (prevents double voice).
 */
let speakGeneration = 0;
let activeTtsAbort: AbortController | null = null;
let currentPrefs: VoicePrefs = { ...DEFAULT_VOICE_PREFS };
let currentAudio: HTMLAudioElement | null = null;
let sharedAudioCtx: AudioContext | null = null;
let currentGain: GainNode | null = null;
/** Browser blocks audio until a user gesture — track unlock */
let audioUnlocked = false;
let lastVoiceError: string | null = null;
/** When the current utterance marked itself busy (for stuck detection) */
let speakingSince = 0;
/** Hard cap so a hung fetch/play can never leave the coach mute forever */
const MAX_UTTERANCE_MS = 28_000;
let utteranceWatchdog: number | null = null;
/** True while a line is queued or playing */
export function isVoiceBusy(): boolean {
  // Self-heal: if something hung without clearing the flag, free the coach
  if (speaking && speakingSince > 0 && Date.now() - speakingSince > MAX_UTTERANCE_MS + 500) {
    console.warn("[voice] stuck busy — force clearing");
    forceClearBusy("Voice stuck — cleared. Click ▶ Test once if still silent.");
  }
  return speaking || speakQueue.length > 0;
}

/** How long the current line has been in-flight (0 if idle) */
export function voiceBusyMs(): number {
  if (!speaking || !speakingSince) return 0;
  return Date.now() - speakingSince;
}

function clearUtteranceWatchdog() {
  if (utteranceWatchdog != null) {
    window.clearTimeout(utteranceWatchdog);
    utteranceWatchdog = null;
  }
}

function armUtteranceWatchdog(generation: number) {
  clearUtteranceWatchdog();
  utteranceWatchdog = window.setTimeout(() => {
    if (generation !== speakGeneration) return;
    console.warn("[voice] utterance watchdog fired — force stop");
    forceClearBusy(
      "Voice timed out (no audio finished). Click ▶ Test to unlock, or switch engine to Browser."
    );
  }, MAX_UTTERANCE_MS);
}

/**
 * Hard reset: clears queue, speaking flag, audio, and generation.
 * Used by stop, watchdog, and stuck-busy recovery.
 */
export function forceClearBusy(errorMsg?: string) {
  speakGeneration += 1;
  speakQueue = [];
  speaking = false;
  speakingSince = 0;
  clearUtteranceWatchdog();
  try {
    activeTtsAbort?.abort();
  } catch {
    /* ignore */
  }
  activeTtsAbort = null;
  hardStopAudioOnly();
  if (errorMsg) setVoiceError(errorMsg);
}

export function getSpeakGeneration(): number {
  return speakGeneration;
}

function getAudioContext(): AudioContext | null {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AC();
  }
  return sharedAudioCtx;
}
type VoiceListener = (info: { error: string | null; unlocked: boolean }) => void;
const voiceListeners = new Set<VoiceListener>();

export function getLastVoiceError(): string | null {
  return lastVoiceError;
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

export function onVoiceStatus(fn: VoiceListener): () => void {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
}

function notifyVoiceStatus() {
  const payload = { error: lastVoiceError, unlocked: audioUnlocked };
  for (const fn of voiceListeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

function setVoiceError(msg: string | null) {
  lastVoiceError = msg;
  notifyVoiceStatus();
}

/**
 * Must run from a click/keypress so Chromium allows later autoplay.
 * Safe to call multiple times.
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    // Silent WebAudio resume (reuse shared context for later gain boost)
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    }

    // Silent HTMLAudio unlock (helps some Electron/Chromium builds)
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    );
    silent.volume = 0.01;
    await silent.play().catch(() => undefined);
    silent.pause();

    // Prime speechSynthesis
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
    }

    audioUnlocked = true;
    setVoiceError(null);
    notifyVoiceStatus();
    return true;
  } catch (e) {
    console.warn("[voice] unlock failed", e);
    return false;
  }
}

export function setVoicePrefs(prefs: Partial<VoicePrefs>) {
  currentPrefs = { ...currentPrefs, ...prefs };
}

export function getVoicePrefs(): VoicePrefs {
  return { ...currentPrefs };
}

async function playCloudTts(
  text: string,
  prefs: VoicePrefs,
  generation: number
): Promise<void> {
  if (generation !== speakGeneration) return;

  activeTtsAbort?.abort();
  const controller = new AbortController();
  activeTtsAbort = controller;
  // Keep fetch short so "voice busy" doesn't sit silent for ages
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        text,
        provider: prefs.engine === "browser" ? "xai" : prefs.engine,
        voice: prefs.cloudVoice || undefined,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (generation !== speakGeneration) return;
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") {
      throw new Error("TTS request timed out — check API / network");
    }
    throw e instanceof Error ? e : new Error("TTS fetch failed");
  } finally {
    window.clearTimeout(timer);
  }

  // Interrupted while waiting on network — drop silently
  if (generation !== speakGeneration || controller.signal.aborted) {
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `TTS ${res.status}`);
  }

  const rawBlob = await res.blob();
  if (!rawBlob.size) throw new Error("Empty audio from TTS");
  if (generation !== speakGeneration) return;

  // Ensure MIME is set — empty type can fail decode/play in Electron
  const headerType = res.headers.get("content-type") || "";
  const mime =
    rawBlob.type ||
    (headerType.includes("wav")
      ? "audio/wav"
      : headerType.includes("ogg")
        ? "audio/ogg"
        : "audio/mpeg");
  const blob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: mime });

  const url = URL.createObjectURL(blob);
  const vol = clampVoiceVolume(prefs.volume ?? DEFAULT_VOICE_PREFS.volume);
  const rate = Math.min(1.25, Math.max(0.75, (prefs.rate || 0.88) / 0.88));

  try {
    // Prefer decodeAudioData when we need boost or when element play fails.
    // MediaElementSource was silently broken on many Electron builds (volume=0 path).
    if (vol > 1.01) {
      try {
        await playDecodedBuffer(blob, vol, rate, generation);
        return;
      } catch (e) {
        console.warn("[voice] decoded boost play failed, trying HTMLAudio", e);
      }
    }

    await playHtmlAudio(url, Math.min(1, vol), rate, generation);
  } catch (e) {
    // Last resort: browser TTS is handled by pumpQueue fallback
    URL.revokeObjectURL(url);
    throw e;
  } finally {
    // playHtmlAudio revokes on finish; if we used decode path, revoke here
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

/** Reliable boost path: decode full buffer + GainNode (no MediaElementSource). */
async function playDecodedBuffer(
  blob: Blob,
  vol: number,
  rate: number,
  generation: number
): Promise<void> {
  if (generation !== speakGeneration) return;
  const ctx = getAudioContext();
  if (!ctx) throw new Error("No AudioContext");
  if (ctx.state === "suspended") await ctx.resume();

  const ab = await blob.arrayBuffer();
  if (generation !== speakGeneration) return;
  // slice copy — decodeAudioData detaches the buffer on some engines
  const audioBuf = await ctx.decodeAudioData(ab.slice(0));
  if (generation !== speakGeneration) return;

  await new Promise<void>((resolve, reject) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = vol;
    source.buffer = audioBuf;
    source.playbackRate.value = rate;
    source.connect(gain);
    gain.connect(ctx.destination);
    currentGain = gain;

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      currentGain = null;
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
      if (generation !== speakGeneration) resolve();
      else if (err) reject(err);
      else resolve();
    };

    const ms = Math.ceil((audioBuf.duration / Math.max(0.5, rate)) * 1000) + 1500;
    const watchdog = window.setTimeout(() => finish(), Math.min(ms, MAX_UTTERANCE_MS));

    source.onended = () => {
      window.clearTimeout(watchdog);
      audioUnlocked = true;
      setVoiceError(null);
      finish();
    };

    try {
      source.start(0);
      audioUnlocked = true;
      setVoiceError(null);
    } catch (e) {
      window.clearTimeout(watchdog);
      finish(e instanceof Error ? e : new Error("Buffer play failed"));
    }
  });
}

/** Simple HTMLAudioElement path — most reliable in Electron for ≤100% volume. */
function playHtmlAudio(
  url: string,
  volume: number,
  rate: number,
  generation: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }

    const audio = new Audio();
    currentAudio = audio;
    audio.preload = "auto";
    // Do NOT set crossOrigin on blob: URLs — breaks playback on some Chromium builds
    audio.src = url;
    audio.volume = Math.min(1, Math.max(0.05, volume));
    audio.playbackRate = rate;

    let settled = false;
    let started = false;
    let playWatchdog = 0;

    const cleanup = () => {
      if (currentAudio === audio) currentAudio = null;
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(playWatchdog);
      cleanup();
      if (generation !== speakGeneration) resolve();
      else if (err) reject(err);
      else resolve();
    };

    const armWatchdog = (ms: number) => {
      window.clearTimeout(playWatchdog);
      playWatchdog = window.setTimeout(() => {
        if (!started || audio.paused) {
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finish(new Error("Audio playback timed out"));
        } else {
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finish();
        }
      }, ms);
    };

    armWatchdog(8_000);

    audio.onloadedmetadata = () => {
      if (settled || generation !== speakGeneration) return;
      const dur = audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        armWatchdog(Math.min(Math.ceil((dur / rate) * 1000) + 2500, MAX_UTTERANCE_MS));
      }
    };

    audio.onended = () => finish();
    audio.onerror = () => {
      if (generation !== speakGeneration) finish();
      else finish(new Error("Audio playback failed"));
    };

    void audio
      .play()
      .then(() => {
        if (generation !== speakGeneration) {
          try {
            audio.pause();
            audio.src = "";
          } catch {
            /* ignore */
          }
          finish();
          return;
        }
        started = true;
        audioUnlocked = true;
        setVoiceError(null);
      })
      .catch((err: unknown) => {
        if (generation !== speakGeneration) {
          finish();
          return;
        }
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") {
          finish(
            new Error("Browser blocked audio — click ▶ Test once (unlocks coach voice)")
          );
        } else {
          finish(err instanceof Error ? err : new Error("Audio play failed"));
        }
      });
  });
}

function waitForVoices(ms = 800): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    window.setTimeout(done, ms);
  });
}

async function playBrowserTts(
  text: string,
  prefs: VoicePrefs,
  generation: number
): Promise<void> {
  if (!window.speechSynthesis) {
    throw new Error("No speechSynthesis in this browser — use Chrome/Edge or Natural (xAI)");
  }
  if (generation !== speakGeneration) return;

  // Chromium bug: cancel/resume can leave synth stuck silent
  window.speechSynthesis.cancel();
  await new Promise((r) => setTimeout(r, 40));
  if (generation !== speakGeneration) return;

  const all = await waitForVoices();
  if (generation !== speakGeneration) return;
  const english = listEnglishVoices();
  const voice = pickCompetitiveVoice(english.length ? english : all, prefs.voiceURI || undefined);

  await new Promise<void>((resolve, reject) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.min(1.4, Math.max(0.55, prefs.rate));
    u.pitch = Math.min(1.4, Math.max(0.7, prefs.pitch));
    // Browser TTS cannot boost past 100%
    u.volume = Math.min(1, Math.max(0.1, clampVoiceVolume(prefs.volume ?? 1)));
    u.lang = voice?.lang || "en-US";
    if (voice) u.voice = voice;

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      if (generation !== speakGeneration) {
        resolve();
        return;
      }
      if (err) reject(err);
      else resolve();
    };

    // If synth dies silently, don't hang the queue forever
    const watchdog = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      finish(new Error("Browser voice timed out — try Natural (xAI) engine"));
    }, 15_000);

    u.onend = () => finish();
    u.onerror = (ev) => {
      const code = (ev as SpeechSynthesisErrorEvent).error;
      if (code === "interrupted" || code === "canceled") finish();
      else finish(new Error(`Browser voice error: ${code || "unknown"}`));
    };

    try {
      window.speechSynthesis.speak(u);
      // Some Electron builds need a kick
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (e) {
      finish(e instanceof Error ? e : new Error("speak() failed"));
    }
  });
}

async function pumpQueue() {
  if (speaking) return;
  const next = speakQueue.shift();
  if (!next) return;
  speaking = true;
  speakingSince = Date.now();
  const generation = speakGeneration;
  const { text, prefs } = next;
  currentPrefs = { ...prefs };
  armUtteranceWatchdog(generation);

  try {
    if (generation !== speakGeneration) return;

    // Exactly ONE engine per utterance — never cloud then browser at once
    if (prefs.engine === "xai" || prefs.engine === "elevenlabs") {
      try {
        await playCloudTts(text, prefs, generation);
        if (generation === speakGeneration) setVoiceError(null);
      } catch (e) {
        if (generation !== speakGeneration) return;
        const msg = e instanceof Error ? e.message : "Cloud TTS failed";
        console.warn("[voice] cloud TTS failed, falling back to browser", e);
        // Kill any partial cloud audio before browser starts
        hardStopAudioOnly();
        try {
          window.speechSynthesis?.cancel();
          await playBrowserTts(text, prefs, generation);
          if (generation === speakGeneration) {
            setVoiceError(`Cloud TTS failed (${msg}) — used browser voice`);
          }
        } catch (e2) {
          if (generation !== speakGeneration) return;
          const msg2 = e2 instanceof Error ? e2.message : "Browser TTS failed";
          console.error("[voice] all TTS failed", e, e2);
          setVoiceError(`Voice failed: ${msg}. Fallback: ${msg2}`);
        }
      }
    } else {
      try {
        await playBrowserTts(text, prefs, generation);
        if (generation === speakGeneration) setVoiceError(null);
      } catch (e) {
        if (generation !== speakGeneration) return;
        const msg = e instanceof Error ? e.message : "Browser TTS failed";
        console.warn("[voice] browser TTS failed, trying xAI", e);
        try {
          window.speechSynthesis?.cancel();
          await playCloudTts(text, { ...prefs, engine: "xai" }, generation);
          if (generation === speakGeneration) {
            setVoiceError(`Browser voice failed — used Natural (xAI)`);
          }
        } catch (e2) {
          if (generation !== speakGeneration) return;
          const msg2 = e2 instanceof Error ? e2.message : "xAI TTS failed";
          setVoiceError(`Voice failed: ${msg}. ${msg2}`);
        }
      }
    }
  } finally {
    // Only the active generation may clear the busy flag / continue queue
    if (generation === speakGeneration) {
      clearUtteranceWatchdog();
      speaking = false;
      speakingSince = 0;
      await new Promise((r) => setTimeout(r, 80));
      if (generation === speakGeneration) void pumpQueue();
    }
  }
}

function hardStopAudioOnly() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (currentGain) {
    try {
      currentGain.gain.value = 0;
    } catch {
      /* ignore */
    }
    currentGain = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
}

/** Lines currently playing + waiting (for “don’t cut mid-callout” logic). */
export function voicePipelineDepth(): number {
  return (speaking ? 1 : 0) + speakQueue.length;
}

export function speakText(
  text: string,
  opts?: {
    /**
     * true  = cut current audio and play this now (Test / user stop only).
     * false = wait for the current callout to finish, then play (default for coach).
     */
    interrupt?: boolean;
    rate?: number;
    pitch?: number;
    volume?: number;
    maxChars?: number;
    prefs?: Partial<VoicePrefs>;
    /** Your champion — strip "Ahri:" style address so coach talks to you */
    yourChampion?: string | null;
  }
) {
  const second = toSecondPersonCoach(text, opts?.yourChampion);
  const spoken = toSpeakable(second, opts?.maxChars ?? 200, opts?.yourChampion);
  if (!spoken) {
    console.warn("[voice] empty speakable text from", text.slice(0, 80));
    return;
  }

  const prefs: VoicePrefs = {
    ...currentPrefs,
    ...opts?.prefs,
    rate: opts?.rate ?? opts?.prefs?.rate ?? currentPrefs.rate,
    pitch: opts?.pitch ?? opts?.prefs?.pitch ?? currentPrefs.pitch,
    volume: opts?.volume ?? opts?.prefs?.volume ?? currentPrefs.volume,
  };

  prefs.volume = clampVoiceVolume(prefs.volume ?? DEFAULT_VOICE_PREFS.volume);

  // Default: never cut mid-sentence. Only Test / explicit interrupt stops current audio.
  const interrupt = opts?.interrupt === true;
  if (interrupt) {
    stopSpeaking();
    speakQueue = [{ text: spoken, prefs }];
    void pumpQueue();
    return;
  }

  // Queue behind whatever is playing. Keep at most one pending tip so we don't
  // stack five outdated lines — fresher tip replaces the next slot only.
  if (speaking || speakQueue.length > 0) {
    if (speakQueue.length >= 1) {
      speakQueue[speakQueue.length - 1] = { text: spoken, prefs };
    } else {
      speakQueue.push({ text: spoken, prefs });
    }
    if (!speaking) void pumpQueue();
    return;
  }

  speakQueue = [{ text: spoken, prefs }];
  void pumpQueue();
}

export function stopSpeaking() {
  // Bump generation first so in-flight fetch/play aborts cleanly
  speakGeneration += 1;
  speakQueue = [];
  speaking = false;
  speakingSince = 0;
  clearUtteranceWatchdog();
  try {
    activeTtsAbort?.abort();
  } catch {
    /* ignore */
  }
  activeTtsAbort = null;
  hardStopAudioOnly();
}

/** Live-adjust volume while something is playing (Natural/xAI path) */
export function applyLiveVolume(volume: number) {
  const v = clampVoiceVolume(volume);
  currentPrefs = { ...currentPrefs, volume: v };
  if (currentGain) {
    currentGain.gain.value = v;
  } else if (currentAudio) {
    currentAudio.volume = Math.min(1, v);
  }
}

export function testVoice(prefs?: Partial<VoicePrefs>) {
  // Unlock from this click so later auto-callouts can play
  void unlockAudio().then(() => {
    if (prefs) setVoicePrefs(prefs);
    speakText(
      // Deliberately includes KDA-style numbers to prove date fix
      "Coach online. You're four kills, one death, three assists. Base now. One thousand six hundred gold. Don't fight without flash.",
      { interrupt: true, maxChars: 320, prefs }
    );
  });
}

/** Short line after setup / first unlock — call only from a user gesture. */
export function welcomeVoice(prefs?: Partial<VoicePrefs>) {
  void unlockAudio().then(() => {
    if (prefs) setVoicePrefs(prefs);
    speakText("Coach online. I'm with you this game.", {
      interrupt: true,
      maxChars: 120,
      prefs,
    });
  });
}

export async function fetchTtsStatus(): Promise<{
  xai: boolean;
  elevenlabs: boolean;
  xaiVoices: string[];
}> {
  try {
    const res = await fetch(`${API_URL}/v1/tts/status`);
    if (!res.ok) throw new Error("status fail");
    return res.json();
  } catch {
    return { xai: false, elevenlabs: false, xaiVoices: [] };
  }
}

/** Map rough voice commands to chips / free text */
export function interpretVoiceCommand(raw: string): {
  text: string;
  intent?: "what_now" | "item" | "roam" | "objective" | "why_die" | "free";
} | null {
  const t = raw.trim();
  if (!t || t.length < 2) return null;

  const lower = t.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  if (lower.length < 3) return null;

  let body = lower;
  const wake = /^(hey )?coach[, ]+|^(hey )?rift[, ]+|^ok coach[, ]+/i;
  if (wake.test(body)) {
    body = body.replace(wake, "").trim();
  }
  if (!body) return null;

  if (/^(what now|what do i do|help|call|status|next)$/i.test(body) || body.includes("what now")) {
    return { text: "What now?", intent: "what_now" };
  }
  if (/\b(item|buy|shop|build)\b/i.test(body)) {
    return { text: body, intent: "item" };
  }
  if (/\b(roam|gank|leave lane)\b/i.test(body)) {
    return { text: body, intent: "roam" };
  }
  if (/\b(dragon|baron|herald|objective|obj)\b/i.test(body)) {
    return { text: body, intent: "objective" };
  }
  if (/\b(why.*(die|died)|death review|how did i die)\b/i.test(body)) {
    return { text: "Why did I die?", intent: "why_die" };
  }

  return { text: t, intent: "free" };
}
