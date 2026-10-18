import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLivePolicy } from "../../packages/shared/dist/src/index.js";
import { makeCallouts, makeSummaries, makeChampSelect, estTokens, MAX_TOKENS } from "../make-training-data.mjs";

test("policy filter rejects imperative targets", () => {
  for (const bad of [
    "CALLOUT: Base NOW.", "CALLOUT: Go dragon, they're down.", "CALLOUT: Leave the wave.", "CALLOUT: Take the tower.",
    "CALLOUT: Collapse on Jinx.", "CALLOUT: Focus the Zed.", "CALLOUT: Push then take baron.", "CALLOUT: Zed has no ult for 40s.",
  ]) {
    assert.equal(checkLivePolicy(bad).ok, false, bad);
  }
});

test("generated callout targets are all policy-safe, chat-formatted and short", () => {
  const { rows } = makeCallouts(300, 3);
  assert.ok(rows.length >= 280);
  for (const r of rows) {
    assert.deepEqual(r.messages.map((m) => m.role), ["system", "user", "assistant"]);
    const target = r.messages[2].content;
    assert.match(target, /^CALLOUT: /);
    assert.deepEqual(checkLivePolicy(target).reasons, [], target);
    assert.ok(estTokens(r.messages.map((m) => m.content).join("\n")) < MAX_TOKENS);
    assert.match(r.messages[1].content, /SITUATION SUMMARY/);
  }
});

test("post-game and champ-select rows carry habits + matchup", () => {
  const s = makeSummaries(20, 5);
  assert.ok(s.every((r) => /^POST-GAME SUMMARY/.test(r.messages[2].content)));
  const c = makeChampSelect(20, 5);
  assert.ok(c.every((r) => /MATCHUP CARD/.test(r.messages[1].content) && /^PLAN:/.test(r.messages[2].content)));
});
