# Demo video: shot list and script

Owner: UI and Submission. Built from what is in `main` today. Text captions only, no voiceover, so the captions are the English subtitles.

**Hard rules (Space Apps 2026):** 30 seconds or less (over 30 s makes the project ineligible for Global judging), English subtitles, no images of anyone under 18, and it must show how NASA data made the project possible. Data is archived: never say "live".

**App link** on the last card: https://aer-black.vercel.app (test it in a private window).

**This is the team's only video script** (the shorter draft in `SUBMISSION.md` was removed, issue #34). Re-planned on November 14 for the 3D view (#27), the intro (#38) and scavenging and repairs (#41). **Before recording:** fix the on-camera bugs in #40 (points 1, 2 and 4 at least), then record from the deployed build after the freeze, not a local branch.

---

## Script (30.0 s)

| # | Time | Clip | Caption on screen |
| --- | --- | --- | --- |
| 1 | 0:00–0:04 | Recording A: title screen (Earth, satellites), then START | **PerformativeLarper** · NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map |
| 2 | 0:04–0:09 | Recording A: meteor strike, master alarm, Control's mayday (the app's own radio caption shows) | **AER: plan a Marswalk you can survive.** |
| 3 | 0:09–0:15 | Recording B: the hatch opens on Jezero, then the astronaut walks the 3D terrain with the minimap and a route | Real NASA data: HiRISE terrain and Perseverance weather (MEDA, sol 312) set what every step costs.<br>Small: *Hatch view: Perseverance Mastcam-Z, sol 4* |
| 4 | 0:15–0:21 | Recording C: press F at a supply cache, open PACK → REPAIRS | Scavenge, salvage NASA hardware, repair your lander. Every kilogram you carry costs oxygen. |
| 5 | 0:21–0:26 | Recording D: storm countdown and shelter cards | Dust storm in 5:00. Pick your shelter.<br>Small: *Game storm is stronger than Jezero's real 2022 storm (τ 1.38).* |
| 6 | 0:26–0:30 | Black, or the Jezero still dimmed | From one walk today to the first human missions.<br>github.com/ZektoxFx/aer · aer-black.vercel.app |

Keep each caption on screen for its whole clip; the shortest is 4 seconds. Keep the video captions at the top of the frame so they don't cover the app's radio caption at the bottom. The intro sound is optional: the app's radio captions are already in English.

---

## How to record

**Setup**
1. Open the app in Chrome (the Vercel link) in a fresh private window, so the intro and the how-to card show as for a new player.
2. Make the browser window about 1280 × 720 (16:9) and hide bookmarks and other tabs.
3. Press **⌘⇧5** → **Record Selected Portion** → drag the box over the page area only (not the address bar) → **Record**. Stop with the ■ in the menu bar. Each recording lands on the Desktop.

Record each clip a little long; you will trim in iMovie.

**Recording A: title and crash (rows 1–2)**
1. Start recording on the title screen. Wait 2 s, click **START**.
2. Let it run through the meteor strike and the first lines of Control's call (about 10 s). Don't click: a click skips the intro.

**Recording B: hatch and walk (row 3)**
1. Keep the intro running after Recording A (or start a new private window and click START again). Start recording when the cabin goes dark, just before the hatch opens.
2. When the game appears, click **LET'S GO** on the how-to card. Click the view, then walk with **W** and look around with the mouse for a few seconds.
3. Click a point on the minimap to plan a route so the line shows. Stop.

**Recording C: scavenge and repair (row 4)**
1. Walk toward the light beams north-west of the lander (the supply cache, about 110 m) until **F PICK UP …** appears. Start recording.
2. Press **F**, then **I** to open the pack. Click the **REPAIRS** tab and hold 2 s on the list. Stop.

**Recording D: storm (row 5)**
1. Walk at least 30 m away from the lander first: the shelter cards don't appear while you are in the cabin.
2. Open **☰ MENU** → **TRIGGER DUST STORM**, and start recording as you click it: "▲ DUST STORM IN 5:00" and the shelter cards appear.
3. Let the countdown run 3 s, click **REACH THE WRECK**, and let "EN ROUTE: WRECK" show for 2 s. Stop.

---

## How to edit in iMovie

1. **File → New Movie**. Import the four recordings and `public/data/jezero_base_2m.jpg`.
2. Drag in order: Recording A (split into 4 s + 5 s for rows 1–2), Recording B, Recording C, Recording D, then `public/data/jezero_base_2m.jpg` (or a black background from **Backgrounds**) for row 6.
3. Trim each clip to the row's length. In the image clip, use **Crop → Ken Burns** for a slow zoom.
4. Add captions with **Titles → Lower Third** (or **Standard** for rows 1, 2 and 6). Type the caption text exactly as in the script.
5. Check the total duration under the timeline: **30.0 s or less**.
6. **File → Share → File**, 1080p, then upload as a **public** (or unlisted) YouTube video, or to Google Drive with "Anyone with the link".
7. Open the link in a private window to check it plays without logging in. Paste it into `SUBMISSION.md` under *Link to Project Demo*.

---

## Checklist before upload

- [ ] 30.0 s or less
- [ ] Every caption in English and readable
- [ ] App link on the last card opens in a private window
- [ ] Row 5 says the game storm is stronger than the real one
- [ ] Row 3 credits the hatch view (Perseverance Mastcam-Z, sol 4)
- [ ] No people, no NASA logos or insignia on the title cards
- [ ] The word "live" appears nowhere
- [ ] Link opens in a private window

This shot list was drafted with Claude Code (log it in the AI use notes).
