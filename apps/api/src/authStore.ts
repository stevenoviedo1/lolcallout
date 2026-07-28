import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

export type Plan = "free" | "founders" | "pro";

export interface User {
  id: string;
  email: string;
  plan: Plan;
  /** Founders promo ends; then treated as pro if still active sub, else free */
  foundersUntil?: string;
  /** Paid access valid until (ISO) — set by Stripe/manual */
  accessUntil?: string;
  stripeCustomerId?: string;
  createdAt: string;
  lastLoginAt?: string;
}

interface MagicLink {
  email: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
}

interface Session {
  tokenHash: string;
  userId: string;
  email: string;
  expiresAt: number;
  createdAt: number;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");
const usersPath = path.join(dataDir, "users.json");
const linksPath = path.join(dataDir, "magic-links.json");
const sessionsPath = path.join(dataDir, "auth-sessions.json");

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function saveJson(file: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newId(): string {
  return crypto.randomUUID();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// --- Users ---

export function getUserByEmail(email: string): User | undefined {
  const users = loadJson<User[]>(usersPath, []);
  return users.find((u) => u.email === normalizeEmail(email));
}

export function getUserById(id: string): User | undefined {
  const users = loadJson<User[]>(usersPath, []);
  return users.find((u) => u.id === id);
}

export function upsertUser(email: string, patch?: Partial<User>): User {
  const users = loadJson<User[]>(usersPath, []);
  const e = normalizeEmail(email);
  let user = users.find((u) => u.email === e);
  if (!user) {
    user = {
      id: newId(),
      email: e,
      plan: "free",
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  }
  if (patch) Object.assign(user, patch);
  saveJson(usersPath, users);
  return user;
}

export function touchLogin(userId: string) {
  const users = loadJson<User[]>(usersPath, []);
  const u = users.find((x) => x.id === userId);
  if (!u) return;
  u.lastLoginAt = new Date().toISOString();
  saveJson(usersPath, users);
}

/**
 * Grant founders plan ($50/mo subscription).
 * `months` = how long the founders rate window runs from activation (6 default, 12 if sold out).
 * Access is extended with a small grace for billing; renewals should refresh via webhook.
 */
export function grantFounders(email: string, months = 6): User {
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  until.setDate(until.getDate() + 5); // billing grace
  return upsertUser(email, {
    plan: "founders",
    foundersUntil: until.toISOString(),
    accessUntil: until.toISOString(),
  });
}

export function grantPro(email: string, months = 1): User {
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  return upsertUser(email, {
    plan: "pro",
    accessUntil: until.toISOString(),
  });
}

/** Extend access by N months from max(now, current accessUntil) */
export function extendAccess(email: string, months = 1, plan?: Plan): User {
  const existing = getUserByEmail(email);
  const base = existing?.accessUntil
    ? new Date(Math.max(Date.now(), new Date(existing.accessUntil).getTime()))
    : new Date();
  base.setMonth(base.getMonth() + months);
  const nextPlan =
    plan ||
    (existing?.plan === "founders" ? "founders" : "pro");
  return upsertUser(email, {
    plan: nextPlan,
    accessUntil: base.toISOString(),
    ...(nextPlan === "founders" ? { foundersUntil: base.toISOString() } : {}),
  });
}

/** Cancel / expire paid access immediately */
export function revokeAccess(email: string): User {
  return upsertUser(email, {
    plan: "free",
    accessUntil: new Date(0).toISOString(),
  });
}

export function getUserByStripeCustomerId(customerId: string): User | undefined {
  if (!customerId) return undefined;
  const users = loadJson<User[]>(usersPath, []);
  return users.find((u) => u.stripeCustomerId === customerId);
}

export function userHasAccess(user: User | undefined): boolean {
  if (!user) return false;
  // Dev open mode when no AUTH_REQUIRE_PAID
  if (process.env.AUTH_REQUIRE_PAID !== "1" && process.env.NODE_ENV !== "production") {
    // Still respect plan if set, but free users allowed in dev
    if (user.plan === "free" && !user.accessUntil) return true;
  }
  if (user.plan === "free" && !user.accessUntil) {
    return process.env.AUTH_REQUIRE_PAID !== "1";
  }
  if (!user.accessUntil) return user.plan === "pro" || user.plan === "founders";
  return new Date(user.accessUntil).getTime() > Date.now();
}

/** Count paid founders seats (active founders plan with future access) */
export function countFoundersSeatsTaken(): number {
  const users = loadJson<User[]>(usersPath, []);
  const now = Date.now();
  return users.filter((u) => {
    if (u.plan !== "founders") return false;
    if (!u.accessUntil) return true;
    return new Date(u.accessUntil).getTime() > now;
  }).length;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    foundersUntil: user.foundersUntil,
    accessUntil: user.accessUntil,
    hasAccess: userHasAccess(user),
    createdAt: user.createdAt,
  };
}

// --- Magic links ---

const LINK_TTL_MS = 15 * 60 * 1000; // 15 min
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createMagicLink(email: string): { rawToken: string; expiresAt: number } {
  const e = normalizeEmail(email);
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const links = loadJson<MagicLink[]>(linksPath, []).filter((l) => l.expiresAt > Date.now());
  // one active link per email
  const next = links.filter((l) => l.email !== e);
  const expiresAt = Date.now() + LINK_TTL_MS;
  next.push({
    email: e,
    tokenHash: hash(rawToken),
    expiresAt,
    createdAt: Date.now(),
  });
  saveJson(linksPath, next);
  return { rawToken, expiresAt };
}

export function consumeMagicLink(rawToken: string): string | null {
  const links = loadJson<MagicLink[]>(linksPath, []);
  const h = hash(rawToken);
  const idx = links.findIndex((l) => l.tokenHash === h && l.expiresAt > Date.now());
  if (idx < 0) return null;
  const email = links[idx].email;
  links.splice(idx, 1);
  saveJson(linksPath, links);
  return email;
}

// --- Sessions ---

export function createSession(user: User): { rawToken: string; expiresAt: number } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const sessions = loadJson<Session[]>(sessionsPath, []).filter((s) => s.expiresAt > Date.now());
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.push({
    tokenHash: hash(rawToken),
    userId: user.id,
    email: user.email,
    expiresAt,
    createdAt: Date.now(),
  });
  // cap sessions per user
  const kept = sessions
    .filter((s) => s.userId !== user.id)
    .concat(
      sessions
        .filter((s) => s.userId === user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
    );
  saveJson(sessionsPath, kept);
  return { rawToken, expiresAt };
}

export function getSessionUser(rawToken: string | undefined): User | null {
  if (!rawToken) return null;
  const sessions = loadJson<Session[]>(sessionsPath, []);
  const h = hash(rawToken);
  const s = sessions.find((x) => x.tokenHash === h && x.expiresAt > Date.now());
  if (!s) return null;
  return getUserById(s.userId) || null;
}

export function revokeSession(rawToken: string) {
  const sessions = loadJson<Session[]>(sessionsPath, []);
  const h = hash(rawToken);
  saveJson(
    sessionsPath,
    sessions.filter((s) => s.tokenHash !== h)
  );
}
