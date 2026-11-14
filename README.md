# AER: Atmospheric Equilibrium & Recovery

A Marswalk planner with a survival game inside it, for the NASA Space Apps Challenge 2026: **Interplanetary Survival Guide: Martian Map**.

A lone astronaut crash-lands in Jezero Crater. Their lander's radio is dead. Using a layered map built from real NASA data, they plan walks across the crater, recover supplies, and reach the Perseverance rover to call Earth for help.

The design doc is [docs/PLANET_SURVIVAL_GAME_PROPOSAL.md](docs/PLANET_SURVIVAL_GAME_PROPOSAL.md).

## Run it

```bash
npm install
npm run dev     # local app at http://localhost:5173
npm test        # simulation tests
npm run build   # production build
```

## Who owns what

Each role mostly edits its own folder, so merges stay painless.

| Folder | Owner | What lives there |
| --- | --- | --- |
| `src/sim/` | Simulation | Suit physics, consumables, warnings. `simulate()` is pure TypeScript with tests. |
| `src/map/` | Map | Layered map, waypoints, route cost, sight radius |
| `src/ui/` | UI | HUD, charts, inventory, storm countdown |
| `src/data/` | Data | Data pack loading |
| `public/data/` | Data | Baked NASA data (JSON, image tiles) |

**Shared contracts:** `src/data/types.ts` and `src/sim/types.ts`. Change them only after telling the whole team. Until the real data pack is ready, build against `public/data/fake.json`.

## Git rules

- Work on your own branch, then merge small changes to `main` often through pull requests.
- `main` must always build and pass `npm test`. It is the public demo.
- The full step-by-step workflow is in [CLAUDE.md](CLAUDE.md). Claude Code reads it automatically, and it works as a checklist for humans too.

## Data and AI use

- NASA data sources are listed in the proposal §5. Every chart must name its mission, instrument and sol.
- Parts of this code were written with help from Claude (an AI assistant), as the Space Apps rules require us to disclose. Each team member keeps a short log of their AI use for the submission.
