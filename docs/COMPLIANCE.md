# RiftCoach — Riot / Vanguard compliance

RiftCoach is a **companion coach**. It must never compromise competitive integrity.

## Green (allowed)

- Riot **Live Client Data API** (`https://127.0.0.1:2999/liveclientdata/...`)
- Optional **LCU** for lobby/champ select (fail soft if unavailable)
- Official Riot public API for post-game history (future)
- Optional **screen capture** (user opt-in / attach), same class as streaming tools
- Proactive callouts based only on legal live data (death, gold, HP%, events)
- Advice only — player retains full control

## Yellow (careful)

- Compact companion window always on top (do not steal focus mid-fight)
- Always-on vision frames (privacy + cost — default OFF)
- Primary-monitor capture may include non-game UI; prefer attach-screenshot

## Red (never)

- Memory reading, DLL injection, hooks into the game process
- Auto-move / auto-skill / input simulation
- Fog-of-war cheats, zoom hacks, enemy ult trackers beyond legal data
- Playing the game for the user

## Capture policy

- Off unless user clicks **Analyze screen**, enables vision-on-ask, or attaches 📎
- No injection into League; capture is OS-level screenshot
- Frames are not stored on disk by default (ephemeral to the chat request)

## Required boilerplate

> RiftCoach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
