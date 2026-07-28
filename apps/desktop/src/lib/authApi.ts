import { API_URL } from "./config";

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

export async function requestMagicLink(email: string): Promise<{
  ok: boolean;
  message?: string;
  devMagicUrl?: string;
  emailed?: boolean;
  error?: string;
}> {
  const res = await fetch(`${API_URL}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error || "Request failed" };
  return data;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const t = getStoredToken();
  if (!t) return null;
  const res = await fetch(`${API_URL}/v1/auth/me`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    if (res.status === 401) setStoredToken(null);
    return null;
  }
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { ...authHeaders() },
    });
  } catch {
    /* ignore */
  }
  setStoredToken(null);
}

/** Capture token from URL hash after magic-link redirect */
export function consumeAuthHash(): string | null {
  const hash = window.location.hash || "";
  const m = hash.match(/auth_token=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  setStoredToken(token);
  // Clean hash without reload
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState({}, "", url.toString());
  return token;
}
