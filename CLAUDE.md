# AER: notes for Claude

A 4-person team is building this for the NASA Space Apps Challenge 2026 (challenge: *Interplanetary Survival Guide: Martian Map*). **Submission deadline: Sunday, November 15, 11:59 p.m. local time.** Favor small, working changes over ambitious ones.

The design doc is `docs/PLANET_SURVIVAL_GAME_PROPOSAL.md`. Read the section for the area you are working on before making design decisions.

## Roles and folders

Each person mostly edits their own folder. Ask the human before editing another role's folder.

| Folder | Role |
| --- | --- |
| `src/sim/` | Simulation: pure TypeScript suit physics with Vitest tests |
| `src/map/` | Map: layered map, waypoints, route cost, sight radius |
| `src/ui/` | UI: HUD, charts, inventory, storm countdown |
| `src/data/`, `public/data/` | Data: data pack loading and baked NASA data |

**Shared contracts:** `src/data/types.ts` and `src/sim/types.ts`. Don't change them unless the human confirms the team agreed. When a change is needed, prefer adding an optional field over changing or removing one. Until real data exists, build against `public/data/fake.json`.

## Commands

```bash
npm install      # once after cloning, and after package.json changes
npm run dev      # app at http://localhost:5173
npm test         # Vitest
npm run build    # type-check + production build
npm run lint
```

## Git workflow: follow it every time

1. **Start each task from fresh `main`:** `git checkout main`, `git pull origin main`, then `git checkout -b <role>/<task>` (for example `ui/hud` or `map/waypoints`).
2. **Never commit directly to `main`, never force-push, and never rewrite history on `main`.**
3. **Before every commit,** run `npm test` and `npm run build`. Both must pass. If you can't fix a failure, stop and tell the human.
4. **Commit small and often,** with messages like `UI: add O2 gauge`. Add a `Co-Authored-By` trailer for AI-written code (Space Apps requires disclosing AI use).
5. **Push the branch** with `git push -u origin <branch>`, then open a pull request with `gh pr create --fill`. If `gh` isn't available, tell the human to click "Compare & pull request" on GitHub.
6. **Merge only when the human says so:** `gh pr merge --merge --delete-branch`. Afterwards, remind the human to tell the team chat so others pull.
7. **On a merge conflict,** stop and explain it to the human. Never resolve a conflict by deleting a teammate's work.
8. Pull `main` into a long-running branch every few hours (`git pull origin main`) to keep conflicts small.

## Space Apps rules that affect code and content

- AI may help build the project, but must not come up with the idea itself. The human keeps a log of AI use for the submission.
- Generated content must not use NASA logos, flags or mission insignia. AI-generated images need a visible watermark.
- Every chart names its mission, instrument and sol. Data is archived and bundled, so never label it "live".
- No images, video or audio of anyone under 18.
- Values marked `[verify]` in the code or the proposal are placeholders. Don't present them as fact.

## Code conventions

- Import types with `import type` (the tsconfig uses `verbatimModuleSyntax`).
- Simulation code stays pure (no React, no DOM) and every behavior gets a Vitest test.
- Colors live only in the `:root` variables in `src/index.css`. The team has the palette on hold, so don't change it unless asked.
