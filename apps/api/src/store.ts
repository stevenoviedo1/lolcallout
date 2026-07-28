import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ChatMessage,
  CoachSession,
  GameContext,
  SessionSummary,
} from "@riftcoach/shared";
import { v4 as uuid } from "uuid";

interface SessionRecord {
  session: CoachSession;
  messages: ChatMessage[];
  lastContext?: GameContext;
  summary?: SessionSummary;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");
const storePath = path.join(dataDir, "sessions.json");

const sessions = new Map<string, SessionRecord>();

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function isRealMatch(rec: SessionRecord): boolean {
  const s = rec.session;
  if (s.isMatch) return true;
  if (rec.summary) return true;
  if ((s.maxGameTime ?? 0) >= 90) return true; // ~1.5 min in a real game
  const useful = rec.messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "callout"
  );
  if (useful.length >= 2 && (s.maxGameTime ?? 0) >= 30) return true;
  return false;
}

function refreshSessionMeta(rec: SessionRecord) {
  const useful = rec.messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "callout"
  );
  rec.session.messageCount = useful.length;
  if (isRealMatch(rec)) {
    rec.session.isMatch = true;
    const champ = rec.session.champion || "Match";
    const mode = rec.session.mode && rec.session.mode !== "UNKNOWN" ? rec.session.mode : "";
    const clock =
      rec.session.maxGameTime != null
        ? ` · ${Math.floor(rec.session.maxGameTime / 60)}m`
        : "";
    rec.session.title = `${champ}${mode ? ` · ${mode}` : ""}${clock}`;
  }
}

function persist() {
  try {
    ensureDir();
    // Drop empty non-match sessions older than 2 hours from disk to reduce clutter
    const now = Date.now();
    for (const [id, rec] of [...sessions.entries()]) {
      if (isRealMatch(rec)) continue;
      const age = now - new Date(rec.session.createdAt).getTime();
      if (age > 2 * 60 * 60 * 1000 && (rec.messages.length <= 1 || !rec.session.isMatch)) {
        sessions.delete(id);
      }
    }

    const payload = Array.from(sessions.values()).map((r) => {
      refreshSessionMeta(r);
      return {
        session: r.session,
        messages: r.messages.slice(-100),
        summary: r.summary,
        lastContextBrief: r.lastContext
          ? {
              champion: r.lastContext.you?.championName,
              mode: r.lastContext.gameMode,
              gameTime: r.lastContext.gameTime,
              kda: r.lastContext.you
                ? `${r.lastContext.you.kills}/${r.lastContext.you.deaths}/${r.lastContext.you.assists}`
                : undefined,
            }
          : undefined,
      };
    });
    const trimmed = payload.slice(-80);
    fs.writeFileSync(storePath, JSON.stringify(trimmed, null, 2), "utf8");
  } catch (e) {
    console.warn("[store] persist failed", e);
  }
}

export function loadFromDisk() {
  try {
    if (!fs.existsSync(storePath)) return;
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8")) as Array<{
      session: CoachSession;
      messages: ChatMessage[];
      summary?: SessionSummary;
    }>;
    for (const row of raw) {
      if (!row?.session?.id) continue;
      const rec: SessionRecord = {
        session: row.session,
        messages: row.messages || [],
        summary: row.summary,
      };
      refreshSessionMeta(rec);
      sessions.set(row.session.id, rec);
    }
    console.log(`[store] loaded ${sessions.size} sessions from disk`);
  } catch (e) {
    console.warn("[store] load failed", e);
  }
}

export function createSession(partial?: {
  champion?: string;
  mode?: CoachSession["mode"];
}): CoachSession {
  const session: CoachSession = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    champion: partial?.champion,
    mode: partial?.mode,
    title: "Active session",
    isMatch: false,
    dataSource: "unknown",
    messageCount: 0,
  };
  sessions.set(session.id, { session, messages: [] });
  // Persist so API restarts don't orphan the UI's sessionId
  try {
    persist();
  } catch {
    /* ignore */
  }
  return session;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

/** History: only real matches by default */
export function listSessions(opts?: { all?: boolean }): CoachSession[] {
  const rows = Array.from(sessions.values());
  const filtered = opts?.all ? rows : rows.filter(isRealMatch);
  return filtered
    .map((r) => {
      refreshSessionMeta(r);
      return r.session;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function pushContext(id: string, context: GameContext): boolean {
  const rec = sessions.get(id);
  if (!rec) return false;

  // Ignore mock context for match tracking (prevents fake history)
  if (context.source === "mock") {
    return true;
  }

  rec.lastContext = context;

  if (context.inGame && context.source === "live") {
    rec.session.dataSource = "live";
    const gt = context.gameTime || 0;
    rec.session.maxGameTime = Math.max(rec.session.maxGameTime ?? 0, gt);
    if (gt >= 60) {
      rec.session.isMatch = true;
    }
  }

  if (context.you?.championName && context.source === "live") {
    rec.session.champion = context.you.championName;
  }
  if (context.gameMode && context.gameMode !== "UNKNOWN" && context.source === "live") {
    rec.session.mode = context.gameMode;
  }

  refreshSessionMeta(rec);
  if (rec.session.isMatch) persist();
  return true;
}

export function addMessage(
  id: string,
  role: ChatMessage["role"],
  content: string,
  meta?: Record<string, unknown>
): ChatMessage | null {
  const rec = sessions.get(id);
  if (!rec) return null;
  const msg: ChatMessage = {
    id: uuid(),
    role,
    content,
    createdAt: new Date().toISOString(),
    meta,
  };
  rec.messages.push(msg);
  if (rec.messages.length > 120) {
    rec.messages = rec.messages.slice(-80);
  }
  refreshSessionMeta(rec);
  // Persist once there's real coaching activity
  if (
    role === "user" ||
    role === "assistant" ||
    role === "callout" ||
    rec.session.isMatch
  ) {
    persist();
  }
  return msg;
}

export function listMessages(id: string): ChatMessage[] {
  return sessions.get(id)?.messages ?? [];
}

export function endSession(
  id: string,
  result?: "win" | "loss" | "unknown",
  summary?: SessionSummary
): CoachSession | null {
  const rec = sessions.get(id);
  if (!rec) return null;
  rec.session.endedAt = new Date().toISOString();
  if (result) rec.session.result = result;
  if (summary) rec.summary = summary;
  rec.session.isMatch = true;
  refreshSessionMeta(rec);
  persist();
  return rec.session;
}

export function setSummary(id: string, summary: SessionSummary): boolean {
  const rec = sessions.get(id);
  if (!rec) return false;
  rec.summary = summary;
  rec.session.isMatch = true;
  refreshSessionMeta(rec);
  persist();
  return true;
}

export function getSummary(id: string): SessionSummary | undefined {
  return sessions.get(id)?.summary;
}

export function deleteSession(id: string): boolean {
  const ok = sessions.delete(id);
  if (ok) persist();
  return ok;
}

/**
 * Remove abandoned empty shells only.
 * CRITICAL: never delete young active sessions — history load used to wipe
 * the session the UI just created ("session not found" on What now / callouts).
 */
export function pruneEmptySessions(): number {
  let n = 0;
  const now = Date.now();
  for (const [id, rec] of [...sessions.entries()]) {
    if (isRealMatch(rec)) continue;
    if (rec.session.endedAt) continue;
    const ageMs = now - new Date(rec.session.createdAt).getTime();
    // Keep any session younger than 12 hours (active playtest/dev restarts)
    if (ageMs < 12 * 60 * 60 * 1000) continue;
    const useful = rec.messages.filter(
      (m) => m.role === "user" || m.role === "assistant" || m.role === "callout"
    );
    if (useful.length > 0) continue;
    sessions.delete(id);
    n++;
  }
  if (n) persist();
  return n;
}
