# Map → UI notes

> **15 Nov 2026, PR #55:** Map edited some `src/ui/` files with chik's go-ahead (quest guide, field journal, sample tubes,
> take-home report, beacon, performance). Everything that changed and why: [`docs/CHANGES_STORY_QUEST_PERF.md`](../../docs/CHANGES_STORY_QUEST_PERF.md).

Notes from the Map role (Aiman) for the UI designer. The Map role does not edit `src/ui/`; these are ideas and
hook-ups for you to use when you are ready.

## Idea: close-up view of the base (for later)

When the player **clicks the base (the lander cabin) on the map**, open a **close-up view of the base**: a bigger
picture or scene of the cabin that the UI designer makes (inside or outside of the lander, what is stored there,
what can be built there). The same idea can work later for other spots, e.g. clicking a NASA site to open its
history card and photo.

How the two sides would split it:

- **UI:** designs and builds the close-up view (art, layout, what it shows, how to close it).
- **Map:** tells the UI when the base was clicked. Right now a click on the map places a route waypoint. When you
  want this, ask the Map role to add an `onItemClick(item)` prop to `HudMap` / `MapView`: clicking a marker (the base,
  or any found item) would call it with that item (`item.kind === 'base'`), instead of placing a waypoint there.

Nothing is built for this yet. It is only the idea, so the UI designer knows.

## Putting the map in the HUD

`HudMap` (in `src/map/HudMap.tsx`) is the map for the HUD's `[ map / surface photo view ]` spot. It only shows the
map and plans routes. It does **not** move the player or change the suit; movement stays with whoever owns it.

```tsx
import { HudMap } from '../map';

<HudMap pack={pack} suit={s.suit} env={frame.env} storm={stormActive} sol={s.weather.sol} />
```

Optional props, when you want them:

| Prop | What it does |
| --- | --- |
| `night` | Shrinks the sight radius at night. Suggest `sunElevationDeg(s.clockMin, s.sky) < 0` (Sim's seasonal sun) rather than a fixed hour. |
| `astronaut` | The player's position in map metres, once movement exists. Default: the cabin. |
| `onRoute(route)` | The route the player clicked. `route.simLegs` is Sim's leg list; `route.turnBackByMin` is the point of no return (back to the cabin). |
| `onFound(items)` | Hidden items that just came into sight. |
| `envAt` | Conditions over game time (Sim's `EnvAt`), so night or a storm during the walk counts in the turn-back time. |
| `resetKey` | Change it to start a new game (back to the cabin, fog reset). |

The map has a **BIG MAP** button (whole window, with a suit-level strip; Esc goes back). Preview it without the
HUD at `/map.html?hud`.
