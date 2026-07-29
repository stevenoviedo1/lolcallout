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
const REMEMBER_KEY = "lc_remember_me";
const REMEMBER_EMAIL_KEY = "lc_remember_email";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Professional "Remember me": save email + keep longer session — never store passwords. */
export function getRememberMe(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

export function getRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

export function setRememberPreferences(opts: {
  remember: boolean;
  email?: string;
}) {
  try {
    if (opts.remember) {
      localStorage.setItem(REMEMBER_KEY, "1");
      const email = (opts.email || "").trim();
      if (email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    /* ignore quota */
  }
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

export type AuthErrorCode =
  | "NO_PASSWORD"
  | "ACCOUNT_EXISTS"
  | "WEAK_PASSWORD"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "INVALID_EMAIL"
  | "MISSING_CREDENTIALS"
  | string;

export type AuthResult = {
  ok: boolean;
  error?: string;
  code?: AuthErrorCode;
  token?: string;
  user?: AuthUser;
  expiresAt?: string;
};

/** Client-side policy (mirrors API). */
export function isStrongPassword(password: string): boolean {
  if (password.length < 8 || password.length > 128) return false;
  if (!/[A-Za-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const labels = ["", "Weak", "Fair", "Good", "Strong"] as const;
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

async function postAuth(
  path: "/v1/auth/login" | "/v1/auth/register",
  email: string,
  password: string,
  remember = false
): Promise<AuthResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Email required", code: "INVALID_EMAIL" };
  if (!password) return { ok: false, error: "Password required", code: "MISSING_CREDENTIALS" };

  // Prefer cloud account API (shared accounts for every download).
  // Fall back to local API if cloud is unreachable or not yet upgraded.
  const bases = uniqueUrls(AUTH_API_URL, CLOUD_API_URL, LOCAL_API_URL);
  let lastError = "Could not reach sign-in server. Check your internet connection.";
  let lastCode: AuthErrorCode | undefined;

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: trimmed, password, remember }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
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
        return {
          ok: false,
          error: data.error || `Request failed (${res.status})`,
          code: data.code,
        };
      }
      if (!data.token || !data.user) {
        return { ok: false, error: "Sign-in response incomplete" };
      }
      setStoredToken(data.token);
      setRememberPreferences({ remember, email: data.user.email || trimmed });
      return {
        ok: true,
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt,
      };
    } catch (e) {
      lastError =
        e instanceof Error ? `Could not reach sign-in server: ${e.message}` : lastError;
      lastCode = undefined;
    }
  }

  return { ok: false, error: lastError, code: lastCode };
}

/** Sign in with email + password (existing account). */
export async function loginWithPassword(
  email: string,
  password: string,
  remember = false
): Promise<AuthResult> {
  return postAuth("/v1/auth/login", email, password, remember);
}

/** Create account with email + password. */
export async function registerWithPassword(
  email: string,
  password: string,
  remember = false
): Promise<AuthResult> {
  return postAuth("/v1/auth/register", email, password, remember);
}

/** Change password while signed in. Returns new token. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  remember = true
): Promise<AuthResult> {
  const bases = uniqueUrls(AUTH_API_URL, CLOUD_API_URL, LOCAL_API_URL);
  let lastError = "Could not reach account server";
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/v1/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ currentPassword, newPassword, remember }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        token?: string;
        user?: AuthUser;
        expiresAt?: string;
      };
      if (!res.ok) {
        if (res.status === 404) continue;
        return { ok: false, error: data.error || `Request failed (${res.status})`, code: data.code };
      }
      if (data.token) setStoredToken(data.token);
      return {
        ok: true,
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : lastError;
    }
  }
  return { ok: false, error: lastError };
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
  // Keep remembered email for convenience; clear only if user opted out
  if (!getRememberMe()) {
    setRememberPreferences({ remember: false });
  }
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
