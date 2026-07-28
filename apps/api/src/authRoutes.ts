import type { Express, Request, Response, NextFunction } from "express";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  getSessionUser,
  grantFounders,
  grantPro,
  isValidEmail,
  publicUser,
  revokeSession,
  touchLogin,
  upsertUser,
  userHasAccess,
  type User,
} from "./authStore.js";
import { sendMagicLinkEmail } from "./email.js";

export type AuthedRequest = Request & { user?: User; sessionToken?: string };

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

  /** Request magic link */
  app.post("/v1/auth/magic-link", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }

      // Ensure user row exists (free until paid)
      upsertUser(email);

      const { rawToken, expiresAt } = createMagicLink(email);
      // Link opens API verify which redirects to app with token
      const magicUrl = `${apiPublic()}/v1/auth/verify?token=${encodeURIComponent(rawToken)}&redirect=${encodeURIComponent(appUrl() + "/#auth")}`;

      const mail = await sendMagicLinkEmail({
        to: email,
        magicUrl,
        expiresMinutes: 15,
      });

      const payload: Record<string, unknown> = {
        ok: true,
        email: email.toLowerCase(),
        expiresAt: new Date(expiresAt).toISOString(),
        emailed: mail.sent,
        provider: mail.provider,
        message: mail.sent
          ? "Check your email for a sign-in link."
          : "Dev mode: magic link printed in API console (set RESEND_API_KEY for real email).",
      };

      // Safe for local playtest when no email provider
      if (!mail.sent || process.env.AUTH_DEV_RETURN_LINK === "1") {
        payload.devMagicUrl = magicUrl;
      }

      res.json(payload);
    } catch (e) {
      console.error("[auth] magic-link", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to send link" });
    }
  });

  /** Browser click from email → session + redirect to app */
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
          <p><a href="${appUrl()}" style="color:#60a5fa">Back to app</a></p>
          </body></html>`
        );
    }

    const user = upsertUser(email);
    touchLogin(user.id);
    const session = createSession(user);

    const dest = new URL(redirect.includes("://") ? redirect : appUrl());
    dest.hash = `auth_token=${session.rawToken}`;

    res.setHeader(
      "Set-Cookie",
      `lc_session=${encodeURIComponent(session.rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
    );

    // Also return JSON if client prefers
    if (req.headers.accept?.includes("application/json")) {
      return res.json({
        ok: true,
        token: session.rawToken,
        user: publicUser(user),
        redirect: dest.toString(),
      });
    }

    res.redirect(302, dest.toString());
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
