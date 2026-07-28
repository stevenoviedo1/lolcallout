import { toSpeakable } from "@riftcoach/shared";

export type TtsProvider = "browser" | "xai" | "elevenlabs";

export function ttsStatus() {
  return {
    xai: Boolean(process.env.XAI_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    defaultProvider: (process.env.TTS_PROVIDER as TtsProvider) || "xai",
    xaiVoices: ["eve", "ara", "leo", "rex", "sal"],
  };
}

export async function synthesizeSpeech(opts: {
  text: string;
  provider?: TtsProvider;
  /** xAI: eve|ara|leo|rex|sal · ElevenLabs: voice_id */
  voice?: string;
}): Promise<{ buffer: Buffer; mime: string; spoken: string; provider: string }> {
  const spoken = toSpeakable(opts.text, 280);
  if (!spoken) throw new Error("Empty speakable text");

  const provider =
    opts.provider ||
    (process.env.TTS_PROVIDER as TtsProvider) ||
    (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : process.env.XAI_API_KEY ? "xai" : "browser");

  if (provider === "elevenlabs") {
    return elevenLabsTts(spoken, opts.voice || process.env.ELEVENLABS_VOICE_ID);
  }
  if (provider === "xai") {
    return xaiTts(spoken, opts.voice || process.env.XAI_TTS_VOICE || "leo");
  }
  throw new Error("No cloud TTS configured. Set XAI_API_KEY or ELEVENLABS_API_KEY.");
}

async function xaiTts(text: string, voice: string): Promise<{
  buffer: Buffer;
  mime: string;
  spoken: string;
  provider: string;
}> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY missing");

  // Prefer a lower, coach-like voice; leo/rex often work for competitive male tone
  const voiceName = (voice || "leo").toLowerCase();

  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice: voiceName,
      // common optional fields — ignored if unsupported
      format: "mp3",
      language: "en",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`xAI TTS ${res.status}: ${errText.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  // Some APIs return JSON with base64; others return raw audio
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as {
      audio?: string;
      data?: string;
      audio_base64?: string;
      url?: string;
    };
    const b64 = json.audio || json.data || json.audio_base64;
    if (b64) {
      return {
        buffer: Buffer.from(b64, "base64"),
        mime: "audio/mpeg",
        spoken: text,
        provider: "xai",
      };
    }
    throw new Error("xAI TTS JSON response missing audio");
  }

  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mime: contentType.includes("wav")
      ? "audio/wav"
      : contentType.includes("ogg")
        ? "audio/ogg"
        : "audio/mpeg",
    spoken: text,
    provider: "xai",
  };
}

async function elevenLabsTts(
  text: string,
  voiceId?: string
): Promise<{ buffer: Buffer; mime: string; spoken: string; provider: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!vid) {
    throw new Error(
      "ELEVENLABS_VOICE_ID missing — clone your voice at elevenlabs.io and paste the voice id"
    );
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.35,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 300)}`);
  }

  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mime: "audio/mpeg",
    spoken: text,
    provider: "elevenlabs",
  };
}
