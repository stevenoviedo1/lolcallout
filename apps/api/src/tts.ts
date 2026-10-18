import { toSpeakable } from "@riftcoach/shared";

/**
 * Optional cloud TTS. Only ElevenLabs remains (owner-configured, off unless
 * ELEVENLABS_API_KEY is set). Default voice path is the browser's free
 * speechSynthesis on the player's PC.
 */
export type TtsProvider = "browser" | "elevenlabs";

export function ttsStatus() {
  return {
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    defaultProvider: "browser" as TtsProvider,
  };
}

export async function synthesizeSpeech(opts: {
  text: string;
  provider?: TtsProvider;
  /** ElevenLabs voice_id */
  voice?: string;
}): Promise<{ buffer: Buffer; mime: string; spoken: string; provider: string }> {
  const spoken = toSpeakable(opts.text, 280);
  if (!spoken) throw new Error("Empty speakable text");
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("No cloud TTS configured — use the browser voice.");
  }
  return elevenLabsTts(spoken, opts.voice || process.env.ELEVENLABS_VOICE_ID);
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
