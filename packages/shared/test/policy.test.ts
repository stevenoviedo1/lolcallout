import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLivePolicy, isLivePolicySafe } from "../src/index.js";

const BAD = [
  "Base NOW", "Go dragon.", "Leave NOW", "Take baron.", "Collapse mid!", "Focus Jinx.", "Base now — low health.",
  "Zed's ult is down, all in.", "Flash is down on Caitlyn", "Expect Lee to gank bot", "Dragon in ~40s — crash wave",
  "Lee is about to gank", "You should recall.", "The best option is dragon.", "Push bot then rotate.",
  "Low HP — back and buy.", "Vi is topside in the fog",
];
const GOOD = [
  "Low HP and 1100 unspent. Base is an option.",
  "5v3 with Zed and Vi dead — an objective, towers or a reset are all options.",
  "They have 3 AD threats — armor items like Zhonya's Hourglass are options.",
  "Zed is level 6.",
  "Dragon spawns in under a minute.",
  "Nice kill — shoving, roaming, or basing are options depending on your wave.",
];

test("policy filter rejects live commands, timers and predictions", () => {
  for (const b of BAD) assert.equal(isLivePolicySafe(b), false, `should reject: ${b}`);
});

test("policy filter keeps awareness + options lines", () => {
  for (const g of GOOD) assert.deepEqual(checkLivePolicy(g).reasons, [], g);
});
