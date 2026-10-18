#!/usr/bin/env node
/**
 * Fetch public Riot Data Dragon (no API key) and distill compact game knowledge:
 *   packages/shared/data/champions.json
 *   packages/shared/data/items.json
 * Usage: node scripts/fetch-ddragon.mjs [--version 14.20.1] [--locale en_US]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "packages/shared/data");
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const locale = arg("--locale", "en_US");
const BASE = "https://ddragon.leagueoflegends.com";

async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
}

/** Strip Data Dragon markup and keep the first sentence(s) up to max chars. */
export function plain(text, max = 160) {
  let s = String(text || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/@[A-Za-z0-9_.*]+@/g, "")
    .replace(/\(\s*[+%]*\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dot = cut.lastIndexOf(". ");
  return (dot > 60 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

const STAT_KEYS = {
  FlatPhysicalDamageMod: "ad",
  FlatMagicDamageMod: "ap",
  FlatArmorMod: "armor",
  FlatSpellBlockMod: "mr",
  FlatHPPoolMod: "hp",
  FlatMPPoolMod: "mana",
  PercentAttackSpeedMod: "as",
  FlatCritChanceMod: "crit",
  PercentMovementSpeedMod: "msPct",
  FlatMovementSpeedMod: "ms",
  PercentLifeStealMod: "lifesteal",
  FlatHPRegenMod: "hpRegen",
};

function itemStats(it) {
  const out = {};
  for (const [k, v] of Object.entries(it.stats || {})) {
    if (STAT_KEYS[k] && v) out[STAT_KEYS[k]] = Math.round(v * 100) / 100;
  }
  // Newer patches put AH/lethality/pen only in the description.
  const d = String(it.description || "");
  const grab = (re, key) => {
    const m = d.match(re);
    if (m) out[key] = Number(m[1]);
  };
  grab(/<attention>(\d+)<\/attention>\s*Ability Haste/i, "ah");
  grab(/<attention>(\d+)<\/attention>\s*Lethality/i, "lethality");
  grab(/<attention>(\d+)%<\/attention>\s*Magic Penetration/i, "magicPenPct");
  grab(/<attention>(\d+)%<\/attention>\s*Armor Penetration/i, "armorPenPct");
  return out;
}

function itemPassives(it) {
  const d = String(it.description || "");
  const out = [];
  const re = /<(passive|active)>([^<]+)<\/\1>/gi;
  let m;
  while ((m = re.exec(d)) && out.length < 2) out.push(m[2].trim());
  return out;
}

function itemFlags(it) {
  const d = plain(it.description, 2000).toLowerCase();
  const f = [];
  if (/grievous wounds|wounds/.test(d) || /Grievous|Thorns|Rot/.test(itemPassives(it).join(" "))) f.push("antiheal");
  if (/grants? (you )?a?\s*shield|shield (of|for)|gain a .*shield/.test(d)) f.push("shield");
  if ((it.tags || []).includes("LifeSteal") || /omnivamp|life steal/.test(d)) f.push("sustain");
  if (/stasis|untargetable/.test(d)) f.push("stasis");
  if (/slow resist|tenacity/.test(d)) f.push("tenacity");
  return f;
}

async function main() {
  const versions = await getJson(`${BASE}/api/versions.json`);
  const version = arg("--version", versions[0]);
  console.log(`Data Dragon ${version} (${locale})`);
  const cdn = `${BASE}/cdn/${version}/data/${locale}`;

  const champList = await getJson(`${cdn}/champion.json`);
  const ids = Object.keys(champList.data).sort();
  const champions = {};
  const queue = [...ids];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const full = (await getJson(`${cdn}/champion/${id}.json`)).data[id];
      const st = full.stats;
      champions[id] = {
        key: Number(full.key),
        name: full.name,
        title: full.title,
        tags: full.tags,
        resource: full.partype,
        range: st.attackrange,
        info: full.info, // attack/defense/magic/difficulty 0-10
        stats: {
          hp: st.hp, hpLvl: st.hpperlevel,
          armor: st.armor, armorLvl: st.armorperlevel,
          mr: st.spellblock, mrLvl: st.spellblockperlevel,
          ad: st.attackdamage, adLvl: st.attackdamageperlevel,
          as: st.attackspeed, asLvl: st.attackspeedperlevel,
          ms: st.movespeed,
        },
        passive: { name: full.passive.name, desc: plain(full.passive.description, 140) },
        spells: full.spells.map((s, i) => ({
          slot: "QWER"[i],
          name: s.name,
          desc: plain(s.description, 140),
        })),
      };
    }
  });
  await Promise.all(workers);

  const itemRaw = await getJson(`${cdn}/item.json`);
  const items = {};
  for (const [id, it] of Object.entries(itemRaw.data)) {
    // Summoner's Rift (map 11), purchasable, not hidden/ornn-only variants.
    if (!it.maps?.["11"] || it.gold?.purchasable === false || it.inStore === false) continue;
    if (it.requiredChampion || it.requiredAlly) continue;
    if (Number(id) > 9999) continue; // Arena / mode-variant ids (e.g. 667109)
    const into = it.into || [];
    const tier = it.gold.total >= 2200 && into.length === 0 ? "legendary" : it.tags?.includes("Boots") ? "boots" : into.length ? "component" : it.gold.total <= 500 ? "starter" : "legendary";
    items[id] = {
      name: it.name,
      cost: it.gold.total,
      tier,
      tags: it.tags || [],
      stats: itemStats(it),
      from: it.from || [],
      into: into.slice(0, 6),
      passives: itemPassives(it),
      flags: itemFlags(it),
    };
  }

  await mkdir(outDir, { recursive: true });
  const champOut = { version, champions: Object.fromEntries(Object.entries(champions).sort()) };
  const itemOut = { version, items };
  await writeFile(join(outDir, "champions.json"), JSON.stringify(champOut));
  await writeFile(join(outDir, "items.json"), JSON.stringify(itemOut));
  const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0);
  console.log(`champions: ${ids.length} (${kb(champOut)} KB) · items: ${Object.keys(items).length} (${kb(itemOut)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
