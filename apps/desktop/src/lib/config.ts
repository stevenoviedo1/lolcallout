function fromQuery(key: string): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get(key);
  } catch {
    return null;
  }
}

/**
 * Cloud API (Railway) — magic-link auth, sessions, TTS, chat.
 * Prefer the working Railway host (custom domain SSL may still be pending).
 */
export const CLOUD_API_URL =
  fromQuery("cloudApi") ||
  import.meta.env.VITE_CLOUD_API_URL ||
  "https://lolcallout-production.up.railway.app";

/**
 * Coach/session API.
 * Packaged app: cloud (so login works without local server).
 * Dev: local 8787 unless overridden.
 */
export const API_URL =
  fromQuery("api") ||
  import.meta.env.VITE_API_URL ||
  (fromQuery("cloudApi") ? CLOUD_API_URL : null) ||
  CLOUD_API_URL;

/** Live Client agent — always on this PC */
export const AGENT_URL =
  fromQuery("agent") || import.meta.env.VITE_AGENT_URL || "http://127.0.0.1:3847";

/** Optional local API (legacy / offline) */
export const LOCAL_API_URL =
  fromQuery("localApi") || "http://127.0.0.1:8787";
