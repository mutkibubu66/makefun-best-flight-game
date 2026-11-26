# Skyline Ridge — a bush-plane flight game

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/mutkibubu66/makefun-best-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/mutkibubu66/makefun-best-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Skyline Ridge** is an original bush-plane flight game for make.fun's
[Make the best flight game](https://make.fun/bounty/best-flight-game-20261126-0057)
competition. Fly the Kestrel out of Ridgefield runway 36, thread the gold rings
over a patchwork valley and river, dodge hot-air balloons, drop supplies at the
riverside cabin, watch your fuel and hull — then bring her home and land.

## Play

Open `game/index.html` in a desktop browser (or serve `game/` with any static
server, e.g. `node serve.ts` → http://localhost:8080). No network, no build
step, no install.

| Key | What it does |
| --- | --- |
| `1` / `2` / `3` | Pick a sortie: Ring Run, River Rescue, Storm Dusk |
| `Enter` | Fly the selected sortie |
| `↑` / `↓` | Pitch (nose up / down) |
| `←` / `→` | Bank and turn |
| `Shift` / `Ctrl` | Throttle up / down |
| `Space` | Drop supplies over the cabin (River Rescue) |
| `P` | Pause · `M` | Mute |

The mouse steers too: hold the pointer off-centre to bank and pitch.

## Sorties

- **Ring Run** — a morning valley circuit: 8 rings, then land on runway 36.
- **River Rescue** — a sunset run with a supply drop at the riverside cabin.
- **Storm Dusk** — a gusty dusk run on short fuel.

Score for rings (streaks pay extra), the supply drop (+500), and a good
landing (+400, +250 more for a greaser). A hard landing costs hull; three
balloon strikes or a hillside ends the sortie.

## How it is built

Pure JavaScript + Canvas 2D, no libraries, no external files. The source is
split by job under `game/src/`: `config.js` (tuning, missions, skies),
`world.js` (terrain, river, runway, rings), `physics.js` (the flight model),
`render.js` (perspective chase view, the Kestrel, the lit instruments),
`audio.js` (synthesised WebAudio engine, wind and chimes), `input.js`
(keyboard + mouse), `shots.js` (deterministic screenshot scenes), `main.js`
(the loop and screens).

`main.ts` hands the entry in: it copies `game/` and `screenshots/` to
`/output` and writes `/output/dossier.json` with the vendored make.fun
library (`vendor/makefun-game.ts`, unchanged).

## License

MIT — see [LICENSE](LICENSE).
