# Riot policy: how LOLCallout stays compliant

LOLCallout is an **awareness coach**. It points out what is visible on the board.
**The player makes every decision.**

## Rules we follow

From Riot's developer policies ([General Policies](https://support-developer.riotgames.com/hc/en-us/articles/22801383038867-General-Policies), [developer.riotgames.com/docs/tft](https://developer.riotgames.com/docs/tft)), in-game products must not:

1. **Give real-time "go here now" prescriptions.** No live orders such as "Base now", "Go dragon", "Leave NOW".
2. **Make decisions for the player.** We don't choose the "best" play for them during a live game.
3. **Track or predict opponents.** No "expect X to force", no "X is one level from ult", no fog, jungle paths, or invented cooldowns.

What *is* allowed, and what we do:

- **Highlight decisions with several options**, and say what each one depends on.
- **Raise awareness from information the player can already see** (scoreboard, HP, gold, who's dead, levels, objective spawns).

## How the code applies them

| Area | Old (removed) | New |
|---|---|---|
| Low HP + gold | `Base now — low health with 1100 gold.` | `Low HP and 1100 unspent. Base is an option.` |
| Focus / target | `winning — right-click Jinx max range` | `3v2 — Jinx is the lowest-HP/fed threat in this fight.` |
| Respawn windows | `Lee down ~18s — start obj before they spawn` | `Lee dead (1 enemy dead) — an objective or camps are options.` |
| Objective timers | `Dragon in ~40s — crash wave and arrive early.` | `Dragon spawns in under a minute.` |
| Opponent prediction | `FUTURE (projected): expect Zed to force…` / `one level from ult` | removed. A visible fact like "Zed is level 6" is still OK. |

- `packages/prompts/src/index.ts`: the system prompt and "Coaching law" describe an awareness coach. `what_now` answers with options.
- Post-game, `why_die` and champ select can be more detailed and prescriptive, because they're reflection or pre-game, not live play.
- Local seed lines (`packages/shared/src/*`, `apps/api/src/coach.ts` fallbacks) keep their logic. Only the spoken strings changed.

When you add a new live line, check it:
- Does it state a visible fact?
- Does it offer options?
- Does it avoid any order, countdown-to-act, or prediction about an opponent?
