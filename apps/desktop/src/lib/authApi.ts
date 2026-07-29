import { API_URL, AUTH_API_URL, CLOUD_API_URL, LOCAL_API_URL } from "./config";

export interface AuthUser {
  id: string;
  email: string;
  plan: "free" | "founders" | "pro";
  foundersUntil?: string;
  accessUntil?: string;
  hasAccess: boolean;
  createdAt: string;
}

const TOKEN_KEY = "lc_auth_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniqueUrls(...urls: (string | null | undefined)[]): string[] {
  return urls.filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
}

/** Prefer the auth server, then coach API, for session checks */
function authBases(): string[] {
  return uniqueUrls(AUTH_API_URL, CLOUD_API_URL, API_URL, LOCAL_API_URL);
}

export async function waitForApi(timeoutMs = 15_000): Promise<boolean> {
  const bases = uniqueUrls(API_URL, AUTH_API_URL, CLOUD_API_URL, LOCAL_API_URL);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const base of bases) {
      try {
        const res = await fetch(`${base}/health`, { method: "GET" });
        if (res.ok) return true;
      } catch {
        /* try next */
      }
    }
    await sleep(300);
  }
  return false;
}

export type AuthResult = {
  ok: boolean;
  error?: string;
  token?: string;
  user?: AuthUser;
  expiresAt?: string;
};

async function postAuth(
  path: "/v1/auth/login" | "/v1/auth/register",
  email: string,
  password: string
): Promise<AuthResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Email required" };
  if (!password) return { ok: false, error: "Password required" };

  // Prefer cloud account API (shared accounts for every download).
  // Fall back to local API if cloud is unreachable or not yet upgraded.
  const bases = uniqueUrls(AUTH_API_URL, CLOUD_API_URL, LOCAL_API_URL);
  let lastError = "Could not reach sign-in server";

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: trimmed, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        user?: AuthUser;
        expiresAt?: string;
      };
      if (!res.ok) {
        // 404 = old server without password routes — try next base
        if (res.status === 404) {
          lastError = "Sign-in server needs an update. Try again later.";
          continue;
        }
        return { ok: false, error: data.error || `Request failed (${res.status})` };
      }
      if (!data.token || !data.user) {
        return { ok: false, error: "Sign-in response incomplete" };
      }
      setStoredToken(data.token);
      return {
        ok: true,
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt,
      };
    } catch (e) {
      lastError =
        e instanceof Error ? `Could not reach sign-in server: ${e.message}` : lastError;
    }
  }

  return { ok: false, error: lastError };
}

/** Sign in with email + password (existing account). */
export async function loginWithPassword(email: string, password: string): Promise<AuthResult> {
  return postAuth("/v1/auth/login", email, password);
}

/** Create account with email + password. */
export async function registerWithPassword(email: string, password: string): Promise<AuthResult> {
  return postAuth("/v1/auth/register", email, password);
}

export async function openInBrowser(url: string): Promise<void> {
  try {
    const w = window as Window & {
      lolcallout?: { openExternal?: (u: string) => Promise<boolean> };
    };
    if (w.lolcallout?.openExternal) {
      await w.lolcallout.openExternal(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function fetchMe(): Promise<AuthUser | null> {
  const t = getStoredToken();
  if (!t) return null;
  for (const base of authBases()) {
    try {
      const res = await fetch(`${base}/v1/auth/me`, {
        headers: { ...authHeaders() },
      });
      if (res.status === 401) continue;
      if (!res.ok) continue;
      const data = (await res.json()) as { user: AuthUser };
      return data.user;
    } catch {
      /* try next */
    }
  }
  setStoredToken(null);
  return null;
}

export async function logout(): Promise<void> {
  for (const base of authBases()) {
    try {
      await fetch(`${base}/v1/auth/logout`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
    } catch {
      /* ignore */
    }
  }
  setStoredToken(null);
}

/** Capture session token from URL hash (legacy magic-link deep link) */
export function consumeAuthHash(): string | null {
  const hash = window.location.hash || "";
  const m = hash.match(/auth_token=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  setStoredToken(token);
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* ignore */
  }
  return token;
}
