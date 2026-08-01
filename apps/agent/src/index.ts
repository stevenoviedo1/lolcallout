import express from "express";
import cors from "cors";
import type { AgentStatusResponse, GameContext } from "@riftcoach/shared";
import { emptyContext } from "@riftcoach/shared";
import { fetchLiveContext, loadMockContext } from "./liveClient.js";
import { EventDetector } from "./events.js";
import { capturePrimaryScreenJpeg } from "./capture.js";
import { DeathTracker } from "./deaths.js";
import { fetchChampSelect } from "./lcu.js";

const PORT = Number(process.env.AGENT_PORT || 3847);
const HOST = process.env.AGENT_HOST || "127.0.0.1";
const MOCK_MODE = (process.env.AGENT_USE_MOCK ?? "false").toLowerCase();
const CAPTURE_ENABLED = (process.env.AGENT_CAPTURE ?? "true").toLowerCase() !== "false";

let latest: GameContext = emptyContext();
let lastError = "";
let usingMock = false;
let sawLiveGame = false;
let wasInLiveGame = false;
const detector = new EventDetector();
const deathTracker = new DeathTracker();
let champSelect = null as Awaited<ReturnType<typeof fetchChampSelect>>;

function allowMock(): boolean {
  if (MOCK_MODE === "force") return true;
  if (MOCK_MODE === "true" || MOCK_MODE === "demo" || MOCK_MODE === "1") {
    return !sawLiveGame;
  }
  return false;
}

async function poll() {
  // Champ select (soft fail)
  champSelect = await fetchChampSelect();

  const live = await fetchLiveContext();

  if (live?.inGame) {
    // New match without lobby gap: clock rewound hard while still "in game"
    const newMatchMidstream =
      wasInLiveGame &&
      latest.inGame &&
      (latest.gameTime || 0) > 90 &&
      (live.gameTime || 0) < 50;
    if (!wasInLiveGame || newMatchMidstream) {
      deathTracker.reset();
      detector.resetSoft();
    }
    sawLiveGame = true;
    wasInLiveGame = true;
    const deathReport = deathTracker.ingest(live);
    latest = {
      ...live,
      deathReport: {
        total: deathReport.total,
        early: deathReport.early,
        mid: deathReport.mid,
        late: deathReport.late,
        dominant: deathReport.dominant,
      },
    };
    usingMock = false;
    lastError = "";
    detector.ingest(latest);
    return;
  }

  if (wasInLiveGame) {
    wasInLiveGame = false;
    const ended: GameContext = {
      ...emptyContext(),
      source: "none",
      deathReport: {
        total: deathTracker.report().total,
        early: deathTracker.report().early,
        mid: deathTracker.report().mid,
        late: deathTracker.report().late,
        dominant: deathTracker.report().dominant,
      },
      updatedAt: new Date().toISOString(),
    };
    detector.ingest(ended);
    detector.resetSoft();
    latest = ended;
    usingMock = false;
    lastError = "Game ended — waiting for next match";
    return;
  }

  if (allowMock()) {
    latest = loadMockContext();
    usingMock = true;
    lastError = "Demo mock data (no live game yet)";
    detector.ingest(latest);
    return;
  }

  latest = emptyContext();
  usingMock = false;
  lastError = champSelect?.active
    ? "In champ select — open LOLCallout for a plan"
    : "Not in game — start League to coach";
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "lolcallout-agent",
    captureEnabled: CAPTURE_ENABLED,
    mockMode: MOCK_MODE,
    sawLiveGame,
  });
});

app.get("/status", (_req, res) => {
  const rawSignals = detector.drain();
  const signals =
    latest.inGame && !usingMock && latest.source === "live" ? rawSignals : [];

  if (!latest.inGame || usingMock) {
    detector.clearSignals();
  }

  const status: AgentStatusResponse["status"] = latest.inGame
    ? usingMock
      ? "mock"
      : "in_game"
    : lastError && !sawLiveGame && !champSelect?.active
      ? "error"
      : "idle";

  const body: AgentStatusResponse = {
    status,
    message: lastError || (latest.inGame ? "In game" : "Waiting for League"),
    mock: usingMock,
    context: latest,
    signals,
    captureEnabled: CAPTURE_ENABLED,
    champSelect: champSelect || null,
    deathReport: deathTracker.report(),
  };
  res.json(body);
});

app.get("/context", (_req, res) => {
  res.json(latest);
});

app.get("/champ-select", (_req, res) => {
  res.json(champSelect || { active: false, updatedAt: new Date().toISOString() });
});

app.get("/deaths", (_req, res) => {
  res.json(deathTracker.report());
});

app.post("/capture", async (_req, res) => {
  if (!CAPTURE_ENABLED) {
    return res.status(403).json({ error: "Capture disabled" });
  }
  const shot = await capturePrimaryScreenJpeg();
  if (!shot) return res.status(501).json({ error: "Capture failed" });
  res.json(shot);
});

app.listen(PORT, HOST, () => {
  console.log(`[agent] LOLCallout listening on http://${HOST}:${PORT}`);
  console.log(`[agent] mock mode: ${MOCK_MODE}`);
  void poll();
  setInterval(() => void poll(), 1000);
});
