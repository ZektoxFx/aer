# Demo video: shot list and script

Owner: UI and Submission. Built from what is in `main` today. Text captions only, no voiceover, so the captions are the English subtitles.

**Hard rules (Space Apps 2026):** 30 seconds or less (over 30 s makes the project ineligible for Global judging), English subtitles, no images of anyone under 18, and it must show how NASA data made the project possible. Data is archived: never say "live".

**Placeholders to fill before export:** `[TEAM NAME]`, and the app link on the last card (the Vercel production link, see `SUBMISSION.md`).

---

## Script (30.0 s)

| # | Time | Clip | Caption on screen |
| --- | --- | --- | --- |
| 1 | 0:00–0:03 | Still: `public/data/jezero_base_2m.jpg`, slow zoom in | **[TEAM NAME]** · NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map |
| 2 | 0:03–0:07 | Same still, keep zooming | **AER: plan a Marswalk you can survive.**<br>Small credit: *HiRISE, Jezero Crater (NASA/JPL/UArizona, USGS)* |
| 3 | 0:07–0:13 | Recording A: HUD running Sol 1 | Real Perseverance weather (MEDA, sol 312) sets what every step costs. |
| 4 | 0:13–0:20 | Recording B: Sol 1 scrubber alarm → diagnose | On Mars, the danger is your own breath. Your CO₂ scrubber is running out. |
| 5 | 0:20–0:26 | Recording C: storm countdown and shelter cards | Dust storm in 5:00. Pick your shelter.<br>Small: *Game storm is stronger than Jezero's real 2022 storm (τ 1.38).* |
| 6 | 0:26–0:30 | Black, or the Jezero still dimmed | From one walk today to the first human missions.<br>github.com/ZektoxFx/aer · [APP LINK] |

Keep each caption on screen for its whole clip; the shortest is 3 seconds. Captions are short enough to read at that pace.

**Map shot (swap later):** if Map lands before the freeze, record a route on Jezero turning red past its point of no return and use it for row 3 (keep the row 3 caption). Nothing else changes.

---

## How to record

**Setup**
1. Open the app in Chrome or Safari: the Vercel link, or `npm run dev` and http://localhost:5173.
2. Make the browser window about 1280 × 720 (16:9) and hide bookmarks and other tabs.
3. Press **⌘⇧5** → **Record Selected Portion** → drag the box over the page area only (not the address bar) → **Record**. Stop with the ■ in the menu bar. Each recording lands on the Desktop.

Record each clip a little long (10–20 s); you will trim in iMovie.

**Recording A: HUD running Sol 1 (row 3)**
1. Click **HUD** (top left), then **START SOL 1** (bottom row).
2. Start recording. Wait 1 s on the briefing card, click **BEGIN SALVAGE**.
3. Let it run 8–10 s: the clock ticks, the O₂, scrubber and battery gauges fall, and the status line shows "WALKING TO DEBRIS FIELD". Stop.

**Recording B: scrubber alarm (row 4)**
1. Click **RESTART SOL 1**, then **BEGIN SALVAGE**.
2. Press **SKIP +1 H** until the orange **CO₂ SCRUBBER ALARM** card appears (2–3 presses). Do not record the skipping.
3. Start recording on the alarm card. Wait 2 s so the telemetry is readable, click **SATURATED CANISTER**, wait 2 s on the recovery card, click **SWAP CANISTER**. Stop.

**Recording C: storm (row 5)**
1. Click **RESTART** (not RESTART SOL 1). This ends Sol 1 and unlocks the test buttons.
2. Click **WALK**.
3. Start recording. Click **TRIGGER STORM**: "DUST STORM APPROACHING 5:00" and the four shelter cards appear. Let the countdown run 3 s, click **REACH THE WRECK**, let "EN ROUTE: WRECK" show for 2 s. Stop.

---

## How to edit in iMovie

1. **File → New Movie**. Import the three recordings and `public/data/jezero_base_2m.jpg`.
2. Drag in order: the image (7 s total, split into 3 s + 4 s for rows 1–2), Recording A, Recording B, Recording C, then the image again (or a black background from **Backgrounds**) for row 6.
3. Trim each clip to the row's length. In the image clip, use **Crop → Ken Burns** for the slow zoom.
4. Add captions with **Titles → Lower Third** (or **Standard** for rows 1, 2 and 6). Type the caption text exactly as in the script.
5. Check the total duration under the timeline: **30.0 s or less**.
6. **File → Share → File**, 1080p, then upload as a **public** (or unlisted) YouTube video, or to Google Drive with "Anyone with the link".
7. Open the link in a private window to check it plays without logging in. Paste it into `SUBMISSION.md` under *Link to Project Demo*.

---

## Checklist before upload

- [ ] 30.0 s or less
- [ ] Every caption in English and readable
- [ ] `[TEAM NAME]` and `[APP LINK]` replaced
- [ ] Row 5 says the game storm is stronger than the real one
- [ ] No people, no NASA logos or insignia on the title cards
- [ ] The word "live" appears nowhere
- [ ] Link opens in a private window

This shot list was drafted with Claude Code (log it in the AI use notes).
