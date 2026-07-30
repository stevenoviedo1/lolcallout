import type {
  AgentStatusResponse,
  CalloutRequest,
  ChatRequest,
  CoachSession,
  CreateSessionResponse,
  DetectedSignal,
  GameContext,
  MatchGrade,
  SessionGoal,
  SessionSummary,
} from "@riftcoach/shared";
import { API_URL, AGENT_URL } from "./config";
import { authHeaders } from "./authApi";

export async function fetchAgentStatus(): Promise<AgentStatusResponse> {
  const res = await fetch(`${AGENT_URL}/status`);
  if (!res.ok) throw new Error(`Agent ${res.status}`);
  return res.json();
}

export async function createSession(): Promise<CoachSession> {
  const res = await fetch(`${API_URL}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Create session ${res.status}`);
  const data = (await res.json()) as CreateSessionResponse;
  return data.session;
}

/** Returns true if the API still has this coach session. */
export async function sessionExists(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/v1/sessions/${sessionId}`, {
      headers: { ...authHeaders() },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushContext(sessionId: string, context: GameContext): Promise<void> {
  const res = await fetch(`${API_URL}/v1/sessions/${sessionId}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ context }),
  });
  if (res.status === 404) {
    const err = new Error("session not found");
    (err as Error & { code?: string }).code = "SESSION_NOT_FOUND";
    throw err;
  }
}

export async function fetchHistory(): Promise<CoachSession[]> {
  const res = await fetch(`${API_URL}/v1/history`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`History ${res.status}`);
  const data = (await res.json()) as { sessions: CoachSession[] };
  return data.sessions;
}

export async function pruneHistory(): Promise<void> {
  const res = await fetch(`${API_URL}/v1/history/prune`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`Prune ${res.status}`);
}

export async function fetchSessionDetail(id: string): Promise<{
  session: CoachSession;
  messages: { id: string; role: string; content: string; createdAt: string }[];
  summary?: SessionSummary;
}> {
  const res = await fetch(`${API_URL}/v1/sessions/${id}`);
  if (!res.ok) throw new Error(`Session ${res.status}`);
  return res.json();
}

export class MembershipRequiredError extends Error {
  code = "MEMBERSHIP_REQUIRED" as const;
  upgradeUrl: string;
  constructor(message: string, upgradeUrl?: string) {
    super(message);
    this.name = "MembershipRequiredError";
    this.upgradeUrl = upgradeUrl || "https://lolcallout.com/#founders";
  }
}

async function readSseStream(
  res: Response,
  onToken: (t: string) => void
): Promise<string> {
  if (!res.ok || !res.body) {
    let errText = "";
    let parsed: { error?: string; code?: string; upgradeUrl?: string } = {};
    try {
      errText = await res.text();
      parsed = JSON.parse(errText) as typeof parsed;
    } catch {
      /* plain text */
    }
    if (res.status === 402 || parsed.code === "MEMBERSHIP_REQUIRED") {
      throw new MembershipRequiredError(
        parsed.error || "Membership required for AI coaching",
        parsed.upgradeUrl
      );
    }
    if (res.status === 401) {
      throw new Error("Sign in required for AI coaching");
    }
    throw new Error(parsed.error || errText || `Request failed ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as {
          type: string;
          text?: string;
        };
        if (payload.type === "token" && payload.text) {
          full += payload.text;
          onToken(payload.text);
        } else if (payload.type === "done" && payload.text) {
          full = payload.text;
        } else if (payload.type === "error" && payload.text) {
          full = payload.text;
          onToken(payload.text);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return full;
}

export async function streamChat(
  sessionId: string,
  body: ChatRequest,
  onToken: (t: string) => void
): Promise<string> {
  const res = await fetch(`${API_URL}/v1/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    const err = new Error("session not found");
    (err as Error & { code?: string }).code = "SESSION_NOT_FOUND";
    throw err;
  }
  return readSseStream(res, onToken);
}

export async function streamCallout(
  sessionId: string,
  signal: DetectedSignal,
  context: GameContext,
  onToken: (t: string) => void,
  opts?: {
    personality?: CalloutRequest["personality"];
    recentCallouts?: string[];
    matchMemory?: CalloutRequest["matchMemory"];
  }
): Promise<string> {
  const body: CalloutRequest = {
    signal,
    context,
    personality: opts?.personality,
    recentCallouts: opts?.recentCallouts,
    matchMemory: opts?.matchMemory,
  };
  const res = await fetch(`${API_URL}/v1/sessions/${sessionId}/callout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    const err = new Error("session not found");
    (err as Error & { code?: string }).code = "SESSION_NOT_FOUND";
    throw err;
  }
  return readSseStream(res, onToken);
}

export async function endSession(
  sessionId: string,
  context: GameContext,
  result: "win" | "loss" | "unknown" = "unknown"
): Promise<{ summary: SessionSummary; session: CoachSession }> {
  const res = await fetch(`${API_URL}/v1/sessions/${sessionId}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ context, result }),
  });
  if (!res.ok) {
    let parsed: { error?: string; code?: string; upgradeUrl?: string } = {};
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      /* ignore */
    }
    if (res.status === 402 || parsed.code === "MEMBERSHIP_REQUIRED") {
      throw new MembershipRequiredError(
        parsed.error || "Membership required for AI post-game",
        parsed.upgradeUrl
      );
    }
    throw new Error(parsed.error || `End session ${res.status}`);
  }
  return res.json();
}

export async function captureScreen(): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(`${AGENT_URL}/capture`, { method: "POST" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchGrade(body: {
  kills: number;
  deaths: number;
  assists: number;
  creeps: number;
  gameTimeSec: number;
  earlyDeaths: number;
  goals?: SessionGoal[];
  repeatDeathPattern?: string | null;
  gameMode?: string;
  mapName?: string;
  queueType?: string;
  gameQueueConfigId?: number;
  scoreboard?: unknown[];
  team?: string;
}): Promise<MatchGrade> {
  const res = await fetch(`${API_URL}/v1/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Grade ${res.status}`);
  const data = (await res.json()) as { grade: MatchGrade };
  return data.grade;
}

export async function createCheckout(email: string, founders: boolean): Promise<string> {
  const res = await fetch(`${API_URL}/v1/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, founders }),
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed");
  return data.url;
}
