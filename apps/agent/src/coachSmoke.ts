/**
 * Local coach smoke: mock Ollama (no GPU needed) + real agent routes.
 * Run: npm run smoke:coach -w @riftcoach/agent
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import express from "express";
import type { CalloutRequest, GameContext } from "@riftcoach/shared";
import { emptyContext } from "@riftcoach/shared";

type Captured = Record<string, unknown>;
const captured: Captured[] = [];
let models: string[] = [];

const mock = http.createServer((req, res) => {
  if (req.url === "/api/tags") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    return;
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      captured.push(JSON.parse(body));
      res.setHeader("Content-Type", "text/event-stream");
      for (const t of ["CALLOUT: Lux is dead ", "— plates or base are both open."]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

function listen(server: http.Server): Promise<number> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
}

async function sse(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = text
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("data: "))
    .map((p) => JSON.parse(p.slice(6)) as { type: string; text?: string; source?: string; model?: string });
  return { status: res.status, events, text };
}

async function main() {
  const mockPort = await listen(mock);
  process.env.OLLAMA_URL = `http://127.0.0.1:${mockPort}`;
  const { registerCoachRoutes } = await import("./coach/index.js");
  const { invalidateLocalAiStatus } = await import("./coach/ollama.js");
  const { COACH_SYSTEM_PROMPT_SMALL } = await import("@riftcoach/prompts");

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  registerCoachRoutes(app);
  const agent = http.createServer(app);
  const port = await listen(agent);
  const base = `http://127.0.0.1:${port}`;

  const ctx: GameContext = { ...emptyContext(), inGame: true, gameTime: 900 };
  const callout: CalloutRequest = {
    signal: {
      id: "s1",
      kind: "kill",
      severity: "urgent",
      title: "Kill",
      detail: "Lux died",
      coachPrompt: "KIND: kill. Situation brief.",
      createdAt: new Date().toISOString(),
    } as CalloutRequest["signal"],
    context: ctx,
  };
  let pass = 0;
  const ok = (name: string) => {
    pass++;
    console.log(`  ✓ ${name}`);
  };

  // 1) No model pulled → callout 503 (desktop uses seed line), chat streams seed + hint
  models = [];
  invalidateLocalAiStatus();
  let st = (await (await fetch(`${base}/ai/status?refresh=1`)).json()) as { ollamaRunning: boolean; model: string | null; hint: string };
  assert.equal(st.ollamaRunning, true);
  assert.equal(st.model, null);
  assert.match(st.hint, /ollama pull qwen2\.5:3b-instruct/);
  ok("status: Ollama up, no model → setup hint");
  let r = await sse(`${base}/ai/callout`, callout);
  assert.equal(r.status, 503);
  assert.match(r.text, /LOCAL_AI_UNAVAILABLE/);
  ok("callout without model → 503 LOCAL_AI_UNAVAILABLE");
  r = await sse(`${base}/ai/chat`, { message: "what now?", intent: "what_now", context: ctx });
  assert.ok(r.events.some((e) => e.type === "done" && e.source === "seed"));
  ok("chat without model → built-in seed reply");
  assert.equal(captured.length, 0);

  // 2) Only fallback model installed → uses qwen2.5:3b-instruct
  models = ["qwen2.5:3b-instruct"];
  invalidateLocalAiStatus();
  r = await sse(`${base}/ai/callout`, callout);
  assert.equal(r.status, 200);
  const done = r.events.find((e) => e.type === "done");
  assert.equal(done?.text, "CALLOUT: Lux is dead — plates or base are both open.");
  let req = captured.at(-1)!;
  assert.equal(req.model, "qwen2.5:3b-instruct");
  assert.equal(req.keep_alive, "5m");
  assert.equal(req.stream, true);
  assert.equal(req.max_tokens, 180);
  assert.equal(req.temperature, 0.3);
  assert.ok(!("reasoning_effort" in req) && !("prompt_cache_key" in req));
  const msgs = req.messages as { role: string; content: string }[];
  assert.equal(msgs[0].content, COACH_SYSTEM_PROMPT_SMALL);
  assert.match(msgs[0].content, /RIOT POLICY/);
  ok("callout streams from fallback model with keep_alive=5m, per-intent params, no reasoning_effort/prompt_cache_key");

  // 3) lolcoach installed → preferred; summary params; frames stripped
  models = ["lolcoach:latest", "qwen2.5:3b-instruct"];
  invalidateLocalAiStatus();
  const sum = (await (await fetch(`${base}/ai/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: ctx }),
  })).json()) as { source: string; model: string };
  assert.equal(sum.source, "local-ai");
  req = captured.at(-1)!;
  assert.equal(req.model, "lolcoach");
  assert.equal(req.max_tokens, 700);
  assert.equal(req.temperature, 0.35);
  ok("summary prefers lolcoach, max_tokens 700 / temp 0.35");

  r = await sse(`${base}/ai/chat`, {
    message: "what do you see?",
    intent: "free",
    personality: "hype",
    context: ctx,
    frameBase64: "AAAA",
    frameMime: "image/png",
  });
  req = captured.at(-1)!;
  const userMsg = (req.messages as { content: unknown }[]).at(-1)!.content;
  assert.equal(typeof userMsg, "string");
  assert.ok(!String(userMsg).includes("## Screenshot"));
  assert.equal(req.max_tokens, 360);
  ok("chat is text-only (vision disabled), hype free max_tokens 360");

  agent.close();
  mock.close();
  console.log(`\nlocal coach smoke: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
