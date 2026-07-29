import type { Express, Request, Response, NextFunction } from "express";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  getSessionUser,
  getUserByEmail,
  grantFounders,
  grantPro,
  isValidEmail,
  isValidPassword,
  passwordPolicyMessage,
  publicUser,
  revokeSession,
  setUserPassword,
  touchLogin,
  upsertUser,
  userHasAccess,
  verifyPassword,
  type User,
} from "./authStore.js";
import { sendMagicLinkEmail } from "./email.js";

export type AuthedRequest = Request & { user?: User; sessionToken?: string };

/** Simple in-memory rate limit (per process) — slows credential stuffing. */
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || String(req.socket?.remoteAddress || req.ip || "unknown");
}

function rateLimitAuth(
  req: Request,
  res: Response,
  bucket: string,
  max: number,
  windowMs: number
): boolean {
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  let row = authAttempts.get(key);
  if (!row || row.resetAt <= now) {
    row = { count: 0, resetAt: now + windowMs };
    authAttempts.set(key, row);
  }
  row.count += 1;
  if (row.count > max) {
    const retrySec = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retrySec));
    res.status(429).json({
      error: `Too many attempts. Try again in ${retrySec}s.`,
      code: "RATE_LIMITED",
    });
    return false;
  }
  return true;
}

function extractToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)lc_session=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return undefined;
}

export function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  req.sessionToken = token;
  req.user = getSessionUser(token) || undefined;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
}

export function requireAccess(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  if (process.env.AUTH_REQUIRE_PAID === "1" && !userHasAccess(req.user)) {
    res.status(402).json({
      error: "Pro or Founders plan required",
      plan: req.user.plan,
      accessUntil: req.user.accessUntil,
    });
    return;
  }
  next();
}

export function registerAuthRoutes(app: Express) {
  const appUrl = () =>
    process.env.APP_URL || process.env.AUTH_APP_URL || "http://127.0.0.1:5173";
  const apiPublic = () =>
    process.env.API_PUBLIC_URL || `http://127.0.0.1:${process.env.API_PORT || 8787}`;

  /**
   * Create account with email + password (secure, works for any downloaded client).
   */
  app.post("/v1/auth/register", async (req, res) => {
    try {
      if (!rateLimitAuth(req, res, "register", 8, 15 * 60 * 1000)) return;

      const email = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      const remember = Boolean(req.body?.remember);
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Enter a valid email address.", code: "INVALID_EMAIL" });
      }
      // Enforce policy only on create / set-password (existing weak hashes still sign in)
      if (!isValidPassword(password)) {
        return res.status(400).json({ error: passwordPolicyMessage(), code: "WEAK_PASSWORD" });
      }

      const existing = getUserByEmail(email);
      if (existing?.passwordHash) {
        return res.status(409).json({
          error: "An account with this email already exists. Sign in instead.",
          code: "ACCOUNT_EXISTS",
        });
      }

      // New user, or paid/magic-link user setting a password for the first time
      const user = await setUserPassword(email, password);
      touchLogin(user.id);
      const session = createSession(user, { remember });
      res.status(201).json({
        ok: true,
        token: session.rawToken,
        user: publicUser(user),
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    } catch (e) {
      console.error("[auth] register", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Registration failed" });
    }
  });

  /**
   * Sign in with email + password.
   */
  app.post("/v1/auth/login", async (req, res) => {
    try {
      if (!rateLimitAuth(req, res, "login", 20, 15 * 60 * 1000)) return;

      const email = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      const remember = Boolean(req.body?.remember);
      if (!isValidEmail(email) || !password) {
        return res.status(400).json({
          error: "Email and password required",
          code: "MISSING_CREDENTIALS",
        });
      }

      const user = getUserByEmail(email);
      if (!user?.passwordHash) {
        // Helpful for paid / waitlist emails that never set a password
        if (user) {
          return res.status(401).json({
            error:
              "No password on this account yet. Use Create account with the same email to set one — your plan stays linked.",
            code: "NO_PASSWORD",
          });
        }
        return res.status(401).json({
          error: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        });
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        return res.status(401).json({
          error: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        });
      }

      touchLogin(user.id);
      const session = createSession(user, { remember });
      res.json({
        ok: true,
        token: session.rawToken,
        user: publicUser(user),
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    } catch (e) {
      console.error("[auth] login", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Sign-in failed" });
    }
  });

  /**
   * Dev-only email-only login. Never available on cloud (requires true loopback).
   * AUTH_DEV_RETURN_LINK no longer unlocks this — that was insecure.
   */
  app.post("/v1/auth/desktop-login", (req, res) => {
    try {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESKTOP_LOGIN !== "1") {
        return res.status(403).json({ error: "Use email and password to sign in" });
      }
      const host = String(req.hostname || req.ip || "").toLowerCase();
      const remote = String(req.socket?.remoteAddress || "");
      const local =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        remote === "127.0.0.1" ||
        remote === "::1" ||
        remote === "::ffff:127.0.0.1";
      if (!local) {
        return res.status(403).json({ error: "Desktop login only on local app" });
      }

      const email = String(req.body?.email || "").trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const user = upsertUser(email);
      touchLogin(user.id);
      const session = createSession(user);
      res.json({
        ok: true,
        token: session.rawToken,
        user: publicUser(user),
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    } catch (e) {
      console.error("[auth] desktop-login", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Sign-in failed" });
    }
  });

  /** Allowed post-verify redirects (desktop deep link + site) */
  function resolveRedirect(requested?: string): string {
    const r = String(requested || "").trim();
    const allowed = [
      "lolcallout://auth",
      "lolcallout://auth/",
      "https://lolcallout.com",
      "https://lolcallout.com/",
      "https://lolcallout.com/#auth",
      "https://www.lolcallout.com",
      "https://www.lolcallout.com/",
      "http://127.0.0.1:5179",
      "http://127.0.0.1:5179/",
      "http://localhost:5179",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ];
    if (r && allowed.some((a) => r === a || r.startsWith(a + "?") || r.startsWith(a + "#"))) {
      return r.startsWith("lolcallout:") ? "lolcallout://auth" : r;
    }
    if (r.startsWith("lolcallout://")) return "lolcallout://auth";
    return appUrl().startsWith("lolcallout:")
      ? "lolcallout://auth"
      : `${appUrl().replace(/\/$/, "")}/#auth`;
  }

  /** Request magic link (browser email → opens desktop via lolcallout://) */
  app.post("/v1/auth/magic-link", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }

      // Ensure user row exists (free until paid)
      upsertUser(email);

      const { rawToken, expiresAt } = createMagicLink(email);
      const desktop = Boolean(req.body?.desktop);
      const redirectTarget = resolveRedirect(
        desktop ? "lolcallout://auth" : String(req.body?.redirect || "")
      );
      const magicUrl = `${apiPublic()}/v1/auth/verify?token=${encodeURIComponent(rawToken)}&redirect=${encodeURIComponent(redirectTarget)}`;

      let mail: { sent: boolean; provider: string } = { sent: false, provider: "none" };
      try {
        mail = await sendMagicLinkEmail({
          to: email,
          magicUrl,
          expiresMinutes: 15,
        });
      } catch (mailErr) {
        console.error("[auth] email send error", mailErr);
        mail = { sent: false, provider: "error" };
      }

      const payload: Record<string, unknown> = {
        ok: true,
        email: email.toLowerCase(),
        expiresAt: new Date(expiresAt).toISOString(),
        emailed: mail.sent,
        provider: mail.provider,
        desktop,
        message: mail.sent
          ? "Check your email — click the link to open LOLCallout and finish sign-in."
          : "Email delivery isn’t configured on the server yet. Opening a secure browser link instead.",
      };

      // If Resend isn’t set, return the one-shot verify URL so the app can open it in a browser
      // (still completes via lolcallout:// deep link). Never return the raw token alone to clients.
      if (!mail.sent) {
        payload.browserAuthUrl = magicUrl;
      }

      res.json(payload);
    } catch (e) {
      console.error("[auth] magic-link", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to send link" });
    }
  });

  /** Browser/desktop click from email → session + redirect to app */
  app.get("/v1/auth/verify", (req, res) => {
    const token = String(req.query.token || "");
    const redirect = String(req.query.redirect || appUrl());
    if (!token) return res.status(400).send("Missing token");

    const email = consumeMagicLink(token);
    if (!email) {
      return res
        .status(400)
        .send(
          `<html><body style="font-family:system-ui;background:#0b0f1a;color:#e8eefc;padding:40px">
          <h1>Link expired or invalid</h1>
          <p>Request a new magic link from the LOLCallout app.</p>
          </body></html>`
        );
    }

    const user = upsertUser(email);
    touchLogin(user.id);
    const session = createSession(user);

    res.setHeader(
      "Set-Cookie",
      `lc_session=${encodeURIComponent(session.rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
    );

    // Also return JSON if client prefers (desktop in-app complete)
    if (req.headers.accept?.includes("application/json")) {
      return res.json({
        ok: true,
        token: session.rawToken,
        user: publicUser(user),
      });
    }

    // Custom protocol (Electron desktop) — hand off with an HTML bridge
    if (redirect.startsWith("lolcallout:")) {
      const deep = `lolcallout://auth?token=${encodeURIComponent(session.rawToken)}`;
      return res
        .status(200)
        .type("html")
        .send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Opening LOLCallout…</title>
<meta http-equiv="refresh" content="0;url=${deep}" />
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f1a;color:#e8eefc;display:grid;place-items:center;min-height:100vh;margin:0}
  a{color:#60a5fa;font-weight:700}
  .card{max-width:420px;padding:28px;border:1px solid rgba(96,165,250,.3);border-radius:16px;background:#121826;text-align:center}
</style></head>
<body><div class="card">
  <h1>Opening LOLCallout…</h1>
  <p>If the app doesn’t open, click below:</p>
  <p><a href="${deep}">Open LOLCallout</a></p>
  <p style="color:#8b9bb8;font-size:13px;margin-top:18px">You can close this tab after the app signs you in.</p>
</div>
<script>location.href=${JSON.stringify(deep)};</script>
</body></html>`);
    }

    try {
      const dest = new URL(redirect.includes("://") ? redirect : appUrl());
      dest.hash = `auth_token=${session.rawToken}`;
      return res.redirect(302, dest.toString());
    } catch {
      return res.redirect(302, `${appUrl()}#auth_token=${session.rawToken}`);
    }
  });

  /** Exchange magic token via POST (desktop can poll/use) */
  app.post("/v1/auth/verify", (req, res) => {
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ error: "token required" });
    const email = consumeMagicLink(token);
    if (!email) return res.status(400).json({ error: "Invalid or expired link" });
    const user = upsertUser(email);
    touchLogin(user.id);
    const session = createSession(user);
    res.json({
      ok: true,
      token: session.rawToken,
      user: publicUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  app.get("/v1/auth/me", authMiddleware, (req: AuthedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in" });
    res.json({ user: publicUser(req.user) });
  });

  app.post("/v1/auth/logout", authMiddleware, (req: AuthedRequest, res) => {
    if (req.sessionToken) revokeSession(req.sessionToken);
    res.setHeader("Set-Cookie", "lc_session=; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  /** Manual founders grant (dev only — never in production) */
  app.post("/v1/auth/dev-grant-founders", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "disabled in production" });
    }
    const email = String(req.body?.email || "").trim();
    if (!isValidEmail(email)) return res.status(400).json({ error: "email required" });
    const user = grantFounders(email);
    res.json({
      ok: true,
      user: publicUser(user),
      note: "Founders grant (dev only)",
    });
  });

  /**
   * Admin grant — requires ADMIN_SECRET (body or x-admin-secret header).
   * plan: pro | founders
   */
  app.post("/v1/auth/admin-grant", (req, res) => {
    const secret = String(
      req.headers["x-admin-secret"] || req.body?.secret || ""
    ).trim();
    const expected = process.env.ADMIN_SECRET || "";
    if (!expected || secret !== expected) {
      return res.status(403).json({ error: "forbidden" });
    }
    const email = String(req.body?.email || "").trim();
    if (!isValidEmail(email)) return res.status(400).json({ error: "email required" });
    const plan = String(req.body?.plan || "pro").toLowerCase();
    const months = Math.max(1, Math.min(36, Number(req.body?.months || 12)));
    const user =
      plan === "founders" ? grantFounders(email, months) : grantPro(email, months);
    res.json({ ok: true, user: publicUser(user) });
  });
}
