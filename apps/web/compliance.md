# How LOLCallout works with League of Legends

## Clean architecture
- **No** DLL injection, memory reading, or input automation
- **No** fog-of-war hacks, enemy ult trackers beyond legal data, or scripts that play for you
- Local **Live Client Data API** on the player’s machine (`127.0.0.1:2999`) when a game is running
- Optional screen capture only when the user opts in
- AI coaching is advice only — the player always controls the game

## Companion UI (not an injected overlay)
- Always-on-top **companion window** outside the game process
- Voice-over callouts (hands-free)
- We do **not** place third-party ads inside the League client

## Modes
- Launch focus: Summoner’s Rift, ARAM, Arena
- TFT and other titles: future adapters (not claimed as shipped until built)

## Disclaimer
LOLCallout is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.

## Commercial posture
- We sell **AI coaching software and support**, not Riot intellectual property
- Users must comply with Riot’s Terms of Service
- Policies can change; we will adapt or discontinue features if required
