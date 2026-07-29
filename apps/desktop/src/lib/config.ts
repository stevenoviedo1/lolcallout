function fromQuery(key: string): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get(key);
  } catch {
    return null;
  }
}

/**
 * Global account + coach API for every download worldwide.
 * Prefer custom domain when DNS is live; Railway URL is the reliable default today.
 */
const RAILWAY_API = "https://lolcallout-production.up.railway.app";
const PUBLIC_API = "https://api.lolcallout.com";

/**
 * Product accounts live only on the cloud. Localhost is never used for sign-in
 * unless VITE_ALLOW_LOCAL_AUTH=1 or ?localAuth=1 (engineers only).
 */
export function allowLocalAuth(): boolean {
  return (
    fromQuery("localAuth") === "1" ||
    import.meta.env.VITE_ALLOW_LOCAL_AUTH === "1"
  );
}

/**
 * Cloud account API (auth, sessions, TTS, coach).
 * Packaged app always points here via Electron query params too.
 */
export const CLOUD_API_URL =
  fromQuery("cloudApi") ||
  import.meta.env.VITE_CLOUD_API_URL ||
  // Prefer Railway until api.lolcallout.com is confirmed everywhere
  RAILWAY_API;

/** Auth host — same as cloud for the product */
export const AUTH_API_URL =
  fromQuery("authApi") || import.meta.env.VITE_AUTH_API_URL || CLOUD_API_URL;

/** Local helper only for dev agent-adjacent tools — never for product auth */
export const LOCAL_API_URL =
  fromQuery("localApi") || "http://127.0.0.1:8787";

/**
 * Coach/session API for the running UI.
 * Product: always cloud. Dev: optional VITE_API_URL / ?api= override.
 */
export const API_URL =
  fromQuery("api") ||
  import.meta.env.VITE_API_URL ||
  CLOUD_API_URL;

/** Live Client agent — always on this PC */
export const AGENT_URL =
  fromQuery("agent") || import.meta.env.VITE_AGENT_URL || "http://127.0.0.1:3847";

/** Bases allowed for account operations (login, me, logout, change-password). */
export function accountApiBases(): string[] {
  const bases = [AUTH_API_URL, CLOUD_API_URL, API_URL];
  if (allowLocalAuth()) bases.push(LOCAL_API_URL);
  return bases.filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
}

/** Bases for coach health / sessions — product stays cloud-only. */
export function coachApiBases(): string[] {
  const bases = [API_URL, CLOUD_API_URL];
  if (allowLocalAuth()) bases.push(LOCAL_API_URL);
  return bases.filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
}

export { PUBLIC_API, RAILWAY_API };
