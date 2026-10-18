import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMatchupCard, champSelectMatchup, getChampion, getItem, isCompletedItem, itemOptionsFor, threatTypeFor, DDRAGON_VERSION,
} from "../src/index.js";

test("champion lookup by id, display name, key", () => {
  assert.equal(getChampion("LeeSin")?.name, "Lee Sin");
  assert.equal(getChampion("Lee Sin")?.id, "LeeSin");
  assert.equal(getChampion("Wukong")?.id, "MonkeyKing");
  assert.equal(getChampion(103)?.name, "Ahri");
  assert.equal(getChampion("Nope"), null);
  assert.ok(DDRAGON_VERSION.length > 3);
  const ahri = getChampion("Ahri")!;
  assert.equal(ahri.spells.length, 4);
  assert.equal(ahri.range, 550);
});

test("item lookup by id and name; completed detection", () => {
  assert.equal(getItem(3157)?.name, "Zhonya's Hourglass");
  assert.equal(getItem("Zhonya's Hourglass")?.id, "3157");
  assert.ok(isCompletedItem(getItem("Zhonya's Hourglass")));
  assert.ok(!isCompletedItem(getItem("Boots")));
  assert.ok(getItem("Thornmail")!.flags.includes("antiheal"));
});

test("threat types use champ class then items", () => {
  assert.equal(threatTypeFor("Zed"), "AD");
  assert.equal(threatTypeFor("Syndra"), "AP");
  assert.equal(threatTypeFor("Malphite"), "TANK");
  assert.equal(threatTypeFor("Malphite", ["Thornmail", "Plated Steelcaps"]), "TANK");
});

test("matchup card counts AD threats and suggests armor options", () => {
  const card = buildMatchupCard({
    you: "Ahri",
    opponent: "Zed",
    enemies: ["Zed", "Darius", "Caitlyn", "Vi", "Soraka"].map((championName) => ({ championName })),
  });
  assert.ok(card.threats.AD >= 3);
  assert.equal(card.opponent, "Zed");
  assert.match(card.rangeNote!, /outrange/);
  assert.ok(card.healers.includes("Soraka"));
  const armor = card.itemNotes.find((n) => /AD threats/.test(n));
  assert.ok(armor, card.itemNotes.join("|"));
  assert.match(armor!, /armor items like .+ are options/);
  assert.ok(itemOptionsFor("armor", "AP").includes("Zhonya's Hourglass"));
});

test("champ select matchup from LCU state", () => {
  const card = champSelectMatchup({ myChampion: "Jinx", assignedPosition: "bottom", enemies: ["Caitlyn", "Lux", "Vi"] });
  assert.equal(card?.opponent, "Caitlyn");
  assert.equal(champSelectMatchup({ enemies: [] }), null);
});
