import { API_URL, CLOUD_API_URL } from "./config";

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

/** Health of whichever API we're using for coach (cloud preferred). */
export async function waitForApi(timeoutMs = 15_000): Promise<boolean> {
  const bases = [API_URL, CLOUD_API_URL].filter(
    (v, i, a) => v && a.indexOf(v) === i
  );
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

export type MagicLinkResult = {
  ok: boolean;
  error?: string;
  message?: string;
  emailed?: boolean;
  browserAuthUrl?: string;
  provider?: string;
};

/**
 * Request magic link from the **cloud** API.
 * Email (if Resend configured) or browserAuthUrl opens verify → lolcallout:// deep link.
 */
export async function requestDesktopMagicLink(email: string): Promise<MagicLinkResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Email required" };

  try {
    const res = await fetch(`${CLOUD_API_URL}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: trimmed,
        desktop: true,
        redirect: "lolcallout://auth",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      emailed?: boolean;
      browserAuthUrl?: string;
      devMagicUrl?: string;
      provider?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || `Sign-in request failed (${res.status})` };
    }
    // Force deep-link return into the desktop app (works even if cloud API
    // was built before the desktop=true redirect flag existed).
    const rawBrowser = data.browserAuthUrl || data.devMagicUrl || "";
    let browserAuthUrl = rawBrowser;
    if (rawBrowser) {
      try {
        const u = new URL(rawBrowser);
        u.searchParams.set("redirect", "lolcallout://auth");
        browserAuthUrl = u.toString();
      } catch {
        /* keep raw */
      }
    }
    return {
      ok: true,
      message: data.message,
      emailed: data.emailed,
      browserAuthUrl: browserAuthUrl || undefined,
      provider: data.provider,
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Could not reach sign-in server: ${e.message}`
          : "Could not reach sign-in server",
    };
  }
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
  // Prefer cloud (token was issued there)
  const bases = [CLOUD_API_URL, API_URL].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/v1/auth/me`, {
        headers: { ...authHeaders() },
      });
      if (res.status === 401) {
        setStoredToken(null);
        return null;
      }
      if (!res.ok) continue;
      const data = (await res.json()) as { user: AuthUser };
      return data.user;
    } catch {
      /* try next base */
    }
  }
  return null;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${CLOUD_API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { ...authHeaders() },
    });
  } catch {
    /* ignore */
  }
  setStoredToken(null);
}

/** Capture session token from URL hash after magic-link deep link */
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
