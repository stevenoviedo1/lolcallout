function fromQuery(key: string): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get(key);
  } catch {
    return null;
  }
}

/**
 * Account API — secure email/password auth + sessions + coach for downloadable clients.
 * Uses the public production API host (not a “Railway login”).
 */
export const CLOUD_API_URL =
  fromQuery("cloudApi") ||
  import.meta.env.VITE_CLOUD_API_URL ||
  "https://lolcallout-production.up.railway.app";

/** Same as cloud for packaged app; local only when explicitly overridden in dev */
export const AUTH_API_URL =
  fromQuery("authApi") || import.meta.env.VITE_AUTH_API_URL || CLOUD_API_URL;

/** Local API (Electron may still spawn for agent-adjacent tools) */
export const LOCAL_API_URL =
  fromQuery("localApi") || "http://127.0.0.1:8787";

/**
 * Coach/session API for the running UI.
 * Packaged download: cloud (real accounts + entitlements).
 * Dev: set VITE_API_URL=http://127.0.0.1:8787 or ?api=
 */
export const API_URL =
  fromQuery("api") ||
  import.meta.env.VITE_API_URL ||
  CLOUD_API_URL;

/** Live Client agent — always on this PC */
export const AGENT_URL =
  fromQuery("agent") || import.meta.env.VITE_AGENT_URL || "http://127.0.0.1:3847";
