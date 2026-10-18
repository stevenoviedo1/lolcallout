/**
 * Local AI via Ollama's OpenAI-compatible endpoint (http://127.0.0.1:11434/v1).
 * Everything runs on the player's own PC — no paid API, no game data leaves the machine.
 */

export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
/** Preferred model (custom fine-tune / Modelfile). */
export const PRIMARY_MODEL = process.env.LOLCOACH_MODEL || "lolcoach";
/** Used when the primary model isn't pulled/created. */
export const FALLBACK_MODEL = process.env.LOLCOACH_FALLBACK_MODEL || "qwen2.5:3b-instruct";
export const KEEP_ALIVE = process.env.LOLCOACH_KEEP_ALIVE || "5m";

export interface LocalAiStatus {
  ollamaRunning: boolean;
  /** Model that will be used, or null if neither is available */
  model: string | null;
  primaryModel: string;
  fallbackModel: string;
  installedModels: string[];
  hint: string | null;
  setupCommands: string[];
  baseUrl: string;
}

export const SETUP_COMMANDS = [
  `ollama pull ${FALLBACK_MODEL}`,
  "ollama create lolcoach -f models/lolcoach/Modelfile",
];

let cached: { at: number; status: LocalAiStatus } | null = null;

function matches(installed: string[], name: string): boolean {
  const want = name.includes(":") ? name : `${name}:latest`;
  return installed.some((m) => m === name || m === want);
}

/** Checks Ollama + installed models. Cached ~10s so callouts don't spam /api/tags. */
export async function localAiStatus(force = false): Promise<LocalAiStatus> {
  if (!force && cached && Date.now() - cached.at < 10_000) return cached.status;
  let installed: string[] = [];
  let running = false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      running = true;
      const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
      installed = (data.models || []).map((m) => m.name || m.model || "").filter(Boolean);
    }
  } catch {
    running = false;
  }
  const model = !running
    ? null
    : matches(installed, PRIMARY_MODEL)
      ? PRIMARY_MODEL
      : matches(installed, FALLBACK_MODEL)
        ? FALLBACK_MODEL
        : null;
  const hint = !running
    ? "Local AI offline — install Ollama (ollama.com) and start it. Using built-in coach lines for now."
    : !model
      ? `Ollama is running but no coach model is installed. Run: ollama pull ${FALLBACK_MODEL}`
      : null;
  const status: LocalAiStatus = {
    ollamaRunning: running,
    model,
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    installedModels: installed,
    hint,
    setupCommands: SETUP_COMMANDS,
    baseUrl: `${OLLAMA_URL}/v1`,
  };
  cached = { at: Date.now(), status };
  return status;
}

export function invalidateLocalAiStatus() {
  cached = null;
}

export interface OllamaChatParams {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature: number;
  max_tokens: number;
  signal?: AbortSignal;
}

/** Streams tokens from /v1/chat/completions (SSE). No reasoning_effort / prompt_cache_key. */
export async function* streamOllamaChat(p: OllamaChatParams): AsyncGenerator<string> {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature,
      max_tokens: p.max_tokens,
      stream: true,
      keep_alive: KEEP_ALIVE,
    }),
    signal: p.signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    invalidateLocalAiStatus();
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 200)}`);
  }
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const d = j.choices?.[0]?.delta?.content;
        if (d) yield d;
      } catch {
        /* partial / keepalive */
      }
    }
  }
}
