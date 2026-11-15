# AER: Atmospheric Equilibrium & Recovery

**A Marswalk planner with a survival game inside it**, built in 48 hours for the NASA Space Apps Challenge 2026:
*Interplanetary Survival Guide: Martian Map*. Team **PerformativeLarper**.

- **Play it:** https://aer-black.vercel.app (desktop Chrome or Edge recommended)
- **Demo video (30 s):** https://drive.google.com/file/d/1s3T8p-cCRnKPCYDEftu1k4uROGvmMmFD/view

A meteor strike forces a lone astronaut to crash-land in Jezero Crater with a dead radio. To survive they plan every
walk on a map built from real NASA data, scavenge and repair their lander into a base, then reach the Perseverance
rover to call Earth, before their own exhaled CO₂, the cold or a dust storm stops them.

## What it does

- **A hyperlocal layered map** of 6.4 × 4 km of Jezero Crater, from the Octavia E. Butler landing site to the western
  delta: HiRISE photos and elevation, slope, a THEMIS thermal-inertia layer for soft sand, and Perseverance's real
  hardware, sample sites and traverse.
- **Route costing:** click waypoints and the route finds a walkable path, costs it in oxygen, CO₂ scrubber, cooling
  water and battery, and shows the **point of no return**: the last moment you can turn back and still reach shelter.
- **A suit simulation** built on NASA physiology and spacesuit data: one metabolic rate drives O₂ use, CO₂ and the
  scrubber; body heat is balanced against the cold and the suit's cooler. Tested with Vitest.
- **A 3D world** from the real HiRISE elevation (hills drawn 1.6× taller, labelled on screen), with day and night, dust
  storms, real Perseverance wind recorded on Mars, and a field journal of habitability findings.
- **The story:** scavenge supplies and salvage real Mars 2020 hardware, repair the lander, build the comms link, and
  call Earth through a real orbiter relay pass. An end-of-game replay races your route against Perseverance's real
  drive.

Game fiction (the AER-1 lander, supplies, radio calls, repair recipes) and design values are labelled as such, and
every chart names its mission, instrument and sol. Data is archived, not live.

## How to play

| Keys | Action |
| --- | --- |
| W A S D, Shift | Walk, run |
| Mouse, Q · E, scroll | Look around, turn the camera, zoom |
| V | First / third person |
| F · I | Pick up what's in reach · open the pack (repairs are in the pack) |
| 1 · 2 · 3 · 4 | Use an O₂ bottle · LiOH canister · water pack · battery pack |
| J | Field journal |
| M · N · Space | Sound · music · pause |

The mission card under the minimap always says what to do next. Click the minimap to plan a route.

## NASA data

HiRISE (Mars Reconnaissance Orbiter), THEMIS (Mars Odyssey), Perseverance MEDA weather, Mastcam-Z dust optical depth,
SuperCam rock compositions and its microphone recording of Martian wind, Mars 2020 waypoints, traverse, samples and
raw images, the NASA Mars Relay Network Handbook, NASA TM-103623 (solar radiation on Mars), and NASA life-support
and spacesuit references (Apollo PLSS, BVAD, ISS baselines, MOXIE). Full sources, links and caveats are in
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and [docs/SUBMISSION.md](docs/SUBMISSION.md).

## Run it locally

```bash
npm install
npm run dev     # app at http://localhost:5173
npm test        # Vitest
npm run build   # type-check + production build
```

Built with TypeScript, React, Vite and three.js; the data pipeline is Python (NumPy, SciPy, Pillow, tifffile) in
`tools/data/`. The demo video was made with `tools/video/` (see [docs/VIDEO_PROMPT.md](docs/VIDEO_PROMPT.md)).

## Team and folders

| Folder | Role | GitHub |
| --- | --- | --- |
| `src/sim/` | Simulation: suit physics, power, storms, point of no return | [@ZektoxFx](https://github.com/ZektoxFx) |
| `src/map/` | Map: layered map, routing, safe-return zone, 3D map world | [@mqnpaus](https://github.com/mqnpaus) |
| `src/ui/` | UI: 3D game, HUD, intro, story, sound | [@chikamir](https://github.com/chikamir) |
| `src/data/`, `public/data/` | Data: NASA data pack, sources, music and audio | [@adamdanishj30](https://github.com/adamdanishj30) |

The original design doc is [docs/PLANET_SURVIVAL_GAME_PROPOSAL.md](docs/PLANET_SURVIVAL_GAME_PROPOSAL.md), and the
story is in [docs/STORY.md](docs/STORY.md). The team's git workflow is in [CLAUDE.md](CLAUDE.md).

## AI use

As the Space Apps rules require, we disclose that AI assistants (Claude, and Antigravity for the first data pack)
helped write code, scripts and game text, find and check sources, compose two music tracks in code, and record and
edit the demo video. Commits they helped with carry a `Co-Authored-By` line. Every data value comes from the cited
sources, not from AI. The app shows no AI-generated images and no NASA logos. Details per area and per team member are
in the "Use of Super Intelligence" section of [docs/SUBMISSION.md](docs/SUBMISSION.md).

*AER is a NASA Space Apps Challenge 2026 entry. It is not endorsed by NASA.*
