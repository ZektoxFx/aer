# Prompt: make the AER demo video with Claude

Paste everything below the line into Claude Code, opened in this repo. It records the live app and edits the 30-second
Space Apps demo video, using the shot list in `docs/VIDEO.md` and the scripts in `tools/video/`.

The current video (29.9 s, captions only) was made this way on 15 November:
https://drive.google.com/file/d/1CAKSP7mZF6IgUKtHDLOaFql38a3B426U/view

---

You are the video editor for **AER**, our NASA Space Apps 2026 entry (challenge: *Interplanetary Survival Guide:
Martian Map*). Make a clean, professional **demo video of 30.0 seconds or less** that shows the game and how NASA data
makes it work.

## Goal
Record real footage of the live app, cut it to the shot list, add English captions, and export an MP4 ready to upload.
Tighten pacing: no dead air, no loading screens, no fumbled moments. Keep the events in the order the shot list gives.

## Inputs (all in this repo)
- **Live app:** https://aer-black.vercel.app (the production build of `main`). Record from it, not from a local branch.
- **Shot list and captions:** `docs/VIDEO.md` (the "Script" table: six rows, times and caption text).
- **Rules and claims:** `docs/SUBMISSION.md`, and issue #42 for the team's open decisions (team name, storm label).
- **Recorder:** `tools/video/record.js` drives Chrome through the app and records one long take. It writes
  `video-out/rec/*.webm`, screenshots in `video-out/shots/`, and `video-out/timeline.json` (when each moment happened).
- **Editor:** `tools/video/make_video.py` cuts the take, adds the captions and an end card, and writes
  `video-out/AER_demo_30s.mp4` (full quality) and `video-out/AER_demo_30s_small.mp4` (under 7 MB, for uploading).
- **My preferences:** [STYLE, e.g. calm and cinematic, or fast and punchy]. [ANY CHANGES TO THE CAPTIONS OR TEAM NAME].

## Steps
1. **Check the tools.** You need Node, Python 3, ffmpeg (with libx264) and Google Chrome. If one is missing, tell me
   what to install; don't install system software yourself. Install the recorder's one package without touching
   `package.json`: `npm install --no-save playwright-core@1.65.1`.
2. **Record.** Run `node tools/video/record.js`. A Chrome window opens and plays: title → START → the whole intro →
   walk → a route on the minimap → PACK → REPAIRS → trigger a dust storm → pick a shelter. Don't touch the mouse or
   keyboard while it runs (about 2½ minutes).
3. **Review the footage.** Make a contact sheet of frames with their times (ffmpeg `-ss` per frame, then `tile`) and
   look at it. Find the best source times for each shot list row; `timeline.json` tells you roughly where to look.
4. **Write the cut list.** Update the `SHOTS` table at the top of `tools/video/make_video.py`: source start, source
   end, main caption, small caption, one row per shot. The rows must add up to **30.0 s or less** with the end card.
5. **Build.** Run `python tools/video/make_video.py`. It stops if the result is longer than 30.0 s.
6. **Verify.** Grab a frame from every row and look at it. Check that captions don't overlap, that every word is
   readable, that nothing important is hidden under a caption, and that there are no loading screens or blank frames.
7. **Report back** with: the cut list (a table: row, final time, source time, footage, caption), the final duration,
   the file paths, and anything you were unsure of. **Ask me before uploading or sharing anything.**

## Rules
- **30.0 seconds or less.** Over 30 s makes the project ineligible for Global judging. Check with
  `ffprobe -show_entries format=duration`.
- **English captions on screen** for every row (they are the subtitles). Captions go at the top, so the app's own
  radio captions at the bottom stay visible.
- **Real footage only:** screen recordings of the app and our own data images. No AI-generated images or video.
- **No NASA logos or insignia.** Credit NASA data in words (HiRISE / Mars Reconnaissance Orbiter, Perseverance MEDA).
- **Data is archived:** never say "live" about NASA data.
- **No images of anyone under 18.**
- **Keep the story consistent** with what the app shows (check the intro's radio lines and the REPAIRS tab).
- **The storm row** must say the game storm is stronger than Jezero's real 2022 storm (τ 1.38), unless the team
  switched to the real curve.
- **Don't change the app** to make it look better on camera. If something looks wrong, tell me.
- **AI disclosure:** this video is recorded and edited with Claude. Remind me to say so in the submission's AI-use
  section.

## Check before you finish
- [ ] Duration is 30.0 s or less, and the end card shows the GitHub and app links.
- [ ] Every row has its caption, matching `docs/VIDEO.md` (or the changes I asked for).
- [ ] Frames from every row checked: no overlap, no blank or loading frames.
- [ ] The small copy is under 7 MB (Google Drive's upload tool limit) and still readable.
- [ ] Nothing uploaded or shared without my OK.
