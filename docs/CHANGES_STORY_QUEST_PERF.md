# Changes in PR #55: story findings, quest guide, performance

Map role (Aiman), 15 Nov 2026. This note is written for the team and for each teammate's Claude. Read it before
editing any file listed below, so you build on these changes instead of undoing them.

**Permission:** the edits in `src/ui/` were made with chik's go-ahead (UI owner), given because UI had nothing
waiting to be pushed. No shared contract changed: `src/data/types.ts` and `src/sim/types.ts` are untouched.

**Related open PRs (all by Map):**
- #53 `map/intro-cinematic`: the cinematic intro and `docs/STORY.md`, the story this PR builds on.
- #54 `map/mars-gear-storm`: gear models, pick-up and drop animation, the Three Forks tube models and the storm wall.

All three merge cleanly with each other (checked with `git merge-tree`).

---

## 1. What the player gets

| Feature | What it does | Where |
| --- | --- | --- |
| **Quest guide** | The mission card always shows a **NOW** line: one next action, the place to go, and its distance and compass direction. The open card adds *why* and a checklist of what the current job needs. | `src/ui/quest.ts`, `Hud.tsx` |
| **Quest beacon** | In 3D, a light pillar, a pulsing ring and a chevron mark the target. An on-screen label shows its name and live distance, and sticks to the screen edge with an arrow when the target is out of view. | `src/map/questBeacon.ts` + `.css`, `World3D.tsx` |
| **Field journal** | Six habitability findings (Act 5 of `docs/STORY.md`), each unlocked by doing something and each citing its data. Button: `FIELD JOURNAL n/6`, or the **J** key in 3D. | `src/ui/findings.ts`, `Hud.tsx`, `game3d.css` |
| **Sample tubes** | Three Forks is now a salvage site: press **F** there to take "Three Forks sample tubes (10)", 2 kg. The mass is a design value. | `src/ui/inventory.ts` (`SALVAGE`) |
| **Take-home report** | On the win card: distance walked, suit O₂ breathed, NASA sites salvaged, sample tubes and findings. The cargo-lander rescue is labelled game fiction. | `Hud.tsx` (end card), `findings.ts` (`takeHome`) |
| **No freezes** | The minimap's safe-return area is computed in a Web Worker. It used to freeze the game for 0.7–0.9 s every time the astronaut stopped. | `src/map/rangeWorker.ts`, `rangeAsync.ts`, `HudMap.tsx` |
| **Lighter 3D** | Low-poly pebbles, sand ripples and zone rocks: 1.04M → 520k triangles a frame, with the same 86 draw calls and the same look. If the game is still under 45 fps at the lowest resolution, shadows switch off. | `src/map/world3d.ts`, `World3D.tsx` |

---

## 2. File by file

### New files
- **`src/ui/findings.ts`** + `findings.test.ts`. Pure, no React.
  - `FINDINGS`: id, title, `how` (shown while locked), `text`, `source`.
  - `newFindings(have, signals)`: the findings these signals unlock.
  - `takeHome(stats, found, salvaged)`: the numbers for the report.
  - Unlock rules:

    | Finding | Unlocked by |
    | --- | --- |
    | `air` | Suit O₂ goes up (bottle, ship or rover) |
    | `build` | Standing under a cover rock (3D) |
    | `storm` | A dust storm ends |
    | `cold` | Air ≤ −70 °C |
    | `lake` | Within 30 m of the science target (`sample_12`, Wildcat Ridge) |
    | `cache` | `three_forks_depot` salvaged |

  - Numbers come from `reference.json`, `content.json`, `pois.json` and the proposal. Keep the `source` strings if you edit the text.
- **`src/ui/quest.ts`** + `quest.test.ts`. Pure.
  - `currentQuest(input)` takes the first unfinished step from `missionSteps()` and turns it into `{ title, why, task, target, needs }`.
  - For a repair or build job it walks `repairNeeds()` in this order: jobs that must come first, repair kit, manual page, blueprint, NASA part, materials. Missing materials send the player to the **nearest** item that yields them; carried scrap means "store it at the lander". With everything ready it says "PACK → REPAIRS → start".
  - Rover call stages come from `callStage()`.
  - After the call, unfinished findings become side quests.
  - `bearing(me, at)` gives metres and N/NE/… Map points are x east, **y south**.
- **`src/map/questBeacon.ts`** + `questBeacon.css`. `buildQuestBeacon({W2, H2, surfaceY, host})` returns `{group, update(target, me, camera, t, w, h), dispose}`. It fades out within 5 m of the target.
- **`src/map/rangeWorker.ts`** + **`rangeAsync.ts`**.
  - `rangeFieldAsync(grid, model, at, base, suit)` returns a Promise of the same `RangeField` as `rangeField()`.
  - It uses one module worker and sends the grid only when it changes.
  - It falls back to computing on the main thread where `Worker` is missing (Vitest) or the worker errors.
  - Vite builds it as its own file (`dist/assets/rangeWorker-*.js`).

### Changed files
- **`src/ui/Hud.tsx`** (UI, with permission):
  - New state: `found` / `foundRef` (journal), `journalOpen`, `statsRef` (O₂ breathed, metres walked).
  - `unlockFindings(signals)` is called from `step()` every frame and from `applyFrom()`. A bottle refills the suit outside `step()`, so `step()` never sees the rise.
  - The quest is computed in the 3D render next to `missionSteps()`; its target goes to `<World3D questTarget=…>`.
  - The mission card gets the NOW line, the why and the needs list.
  - The end card's `stats` are snapshotted into `endCard` when the call is sent, so render never reads a ref.
  - **J** toggles the journal in 3D.
  - The tubes get their own toast and backpack label.
  - `restart()` clears the journal and the stats.
- **`src/ui/World3D.tsx`** (UI, with permission):
  - New optional prop `questTarget`.
  - Builds the beacon; calls `camera.updateMatrixWorld()` and `questBeacon.update(...)` just before `renderer.render`.
  - The auto-quality step now also turns shadows off after the pixel ratio floor.
- **`src/ui/inventory.ts`** (UI, with permission): `three_forks_depot` added to `SALVAGE`.
- **`src/ui/game3d.css`** (UI, with permission): `.v-journal`, `.end-takehome`, `.v-quest*`. Colours use only the `:root` variables.
- **`src/map/pathfind.ts`** (Map): faster `costField`:
  - a typed-array `Heap` (`pop()` returns the value; the key is in `heap.topKey`);
  - a flat-array rate cache;
  - index arithmetic in the hot loop.

  Output is identical: a checksum over all 256k cells is unchanged, and it's 2.2× faster.
- **`src/map/HudMap.tsx`** (Map): `range` is now state filled by `rangeFieldAsync`, not a synchronous `useMemo`. It starts `null` for a moment; `returnStatus` already handles null.
- **`src/map/world3d.ts`** (Map):
  - pebbles: `OctahedronGeometry`, 7000 of them (was an icosahedron, 9000);
  - ripples: `SphereGeometry(1, 6, 3)`;
  - zone rocks: `rockGeometry(29, 0)`.
- **`src/map/index.ts`**: exports `buildQuestBeacon` and the `QuestBeacon` type.

---

### Added on 15 Nov (morning): ending route replay + Survival Guide PNG

- `src/map/replayPath.ts` (pure, tested in `replayPath.test.ts`): `trailAdd` keeps a breadcrumb every 8 m
  (thinned past 3000 points), `trailCut` cuts the trail by distance, `replayView` is the pull-back view
  (starts 260 m wide over where the game ended, eases out to the whole map). Named differently from the
  component on purpose: Windows ignores case, so `routeReplay.ts` and `RouteReplay.tsx` would collide.
- `src/map/RouteReplay.tsx`: canvas replay on the HiRISE photo. Glowing route, markers (crash site, NASA
  sites salvaged, findings where they were made, Perseverance), scale bar, equivalent camera height. On a
  won game, "SAVE SURVIVAL GUIDE (PNG)" saves a 1200 px image: map + take-home lines + findings + credits.
- `Hud.tsx`: `statsRef` now also holds `trail` and `foundAt` (`EndStats`, `freshStats`, `snapStats`);
  the step loop calls `trailAdd`; `unlockFindings` records where each finding was made; both end cards
  (won and lost) open with the replay. Chik's credits still roll by themselves after 12 s; the replay
  finishes in about 7 s.
- `game3d.css`: `.route-replay`, and the end card widens to 760 px when it holds the replay.

The Three Forks tubes also leave the 3D world once taken (`gone()` in Hud.tsx); other salvage sites stay.

### Added on 15 Nov (morning): Earth's reply, then-and-now photos

- `src/ui/EarthReply.tsx` + `src/ui/heliocentric.ts` (pure, tested): on the won end card the call crosses to
  Earth at light speed, the DSN hears it, and the reply crosses back, with a running T+ clock. The delay is
  today's real Earth-Mars distance (mean circular orbits, JPL approximate elements), shown sped up so it ends
  before Chik's credits roll. `heliocentric.ts` is an identical copy of the file on `map/intro-cinematic`
  (the title screen uses it too), so the two branches merge cleanly. Reply wording and rescue = game fiction.
- `src/ui/sitePhotos.ts` (pure, tested): within 25 m of a photographed NASA site, a card on the left shows the
  site's archived Perseverance photo (sol, date, camera, credit from `public/data/photos/photos.json`, matched
  to sites by the file names in `pois.json`), labelled archived, not live, with "NOW: you are standing at ...".
  Closable per site. No data files were changed.

## 3. How it was tested

- `npm test`: 264 passed. `npm run build`: OK. `npm run lint`: no new warnings.
- **The whole game was played start to finish in the browser** with a temporary auto-walk hook. The hook used the real movement code (slopes, sand, O₂) and only did what the quest said. It reached **EARTH HEARD YOU** at mission 7/7.
  - About 18 game hours, 11.4 km walked, 850 g O₂ used.
  - O₂ never fell below 0.27 of 0.6 kg; life support refills it at the lander.
  - The hook was removed before commit.
- Found and fixed during that run:
  - the quest sent the player home before collecting every material;
  - an O₂ bottle did not unlock "Air from the air";
  - the tubes were labelled "NASA part for ship repairs".
- **Lag:** walking with stops had 680–880 ms freezes; after the worker, there are no long tasks and the worst frame is 21 ms.

**Not verified:**
- **Storm and cold findings:** these never unlocked in the run. The storm hadn't ended by the win and the night stayed warmer than −70 °C. Unit tests cover them.
- **Automatic shadow switch-off:** it never triggered, because the test machine runs at ~100 fps.
- **A real person steering around hills:** they will walk farther than the straight-line auto-walk did.

## 4. Known gaps and ideas (not done)

- With #54 merged, the 3D tubes at Three Forks keep showing after they are taken. #54's `itemModel` draws them for `poiId === 'three_forks_depot'`. Fix: hide them once `bag.salvaged` includes it.
- The first repair kit is ~900 m out on the crash trail. That comes from the layout in `realData.ts`, so the opening walk is long, but the beacon shows the way.
- The quest points at hidden items too (pages, the rover), on purpose, so nobody wanders. Hide the target until spotted if the team wants more exploration.
- The rover wait is ~4 game hours. The quest now says "press F at Perseverance to wait for it", which skips the wait with a button the rover panel already had.

## 5. Rules for whoever edits next

- Keep game fiction labelled (rescue lander, tube mass, salvaging NASA hardware) and keep every finding's `source`.
- Don't move `rangeField` back onto the main thread. Use `rangeFieldAsync`.
- `src/data/types.ts` and `src/sim/types.ts` stay untouched unless the team agrees.
- Never commit API keys.
