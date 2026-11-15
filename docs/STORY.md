# AER: Story and Mission (draft for the team)

Draft by Map (Aiman), 15 Nov 2026, built on the team's story idea, with suggested changes. Every real fact below comes from the data pack (`public/data/*.json`) or the proposal. Items marked `[verify]` still need checking before anyone presents them as fact. Mission AER-1 and its crew are fiction.

**One line:** a prospecting ship is crippled by a meteoroid while swinging past Mars. Its astronaut crash-lands in Jezero Crater, scavenges to stay alive, reaches NASA's Perseverance rover to call Earth, and spends the wait learning how people could live there. They go home with the findings that shape the next Mars mission.

---

## What changes from the first idea, and why

| First idea | Suggested change | Why |
| --- | --- | --- |
| Scavenging trip **outside the solar system** | **Prospecting trip to the asteroid belt** (metals and ice), passing Mars on the way out for a gravity assist | Even the nearest star is 4.2 light-years away, and Voyager 1 needed about 35 years just to reach interstellar space `[verify]`, so judges would call it impossible. The asteroid belt lies just beyond Mars, so passing Mars makes sense: a Mars flyby that speeds a ship up is a real technique, and NASA's Psyche used one on its way to an asteroid `[verify date]`. It also keeps the "scavenging resources" theme. |
| Hit by an asteroid | Hit by a **meteoroid** (a small rock, about 1.6 m) during the Mars flyby | A small rock is what the intro shows, and it is the honest word for it. |
| "Make Mars habitable" | **Make a habitable outpost**: air, water, power, shelter | Terraforming a whole planet is not realistic. Keeping one person alive with local resources is real ISRU, and it is what our data can show. |
| Help arrives | Earth **diverts a cargo lander that is already flying**. The crew ship comes later. | Launch windows to Mars open only about every 26 months `[verify]`, so a fresh rescue would take years. A lander already in flight is plausible fiction and keeps the wait to sols. |
| (new) | The astronaut **carries Perseverance's sample tubes home** | It is a real thread. Perseverance left 10 tubes at the Three Forks depot for a future mission to bring back (`pois.json`). Bringing them home is a strong ending, and it is science the judges will recognise. |

**Removed for good:** wormholes, other galaxies, black holes (already out of the intro).

---

## The story in six acts

### Act 0: Launch and cruise (intro, built)
AER-1 launches from a coastal pad at dawn and drops its first stage. It then cruises for about 203 days: Perseverance's own cruise length, ~472 million km, with the 2 rpm cruise spin (`cabin.ts`). The plan is to swing past Mars and go on to the belt. The ship carries an **entry capsule as a lifeboat**, which is what saves the astronaut.

### Act 1: The strike and the crash (intro, built)
A meteoroid tears into the engine section. Control: *"You can't make it home. Divert to Mars, the nearest planet."* The astronaut rides the lifeboat capsule down. The parachute tears, the retro-rockets sputter, and the capsule crashes in **Jezero Crater**. Supplies are scattered and the lander radio is dead (proposal §1.1).

### Act 2: Survive and scavenge (Sols 1–3, the game)
The proposal's three scenarios stay as they are: **scrubber saturation, cooling and water, the dust storm** (proposal §6.2).
- **Scavenge from our own wreck:** dropped supplies, manual pages, scrap (`content.json`: supplies, rocketPieces, recipes).
- **Scavenge from real NASA hardware**, with a history card at each site (`content.json` historyCards):
  - the **sky crane crash site**, the **parachute and backshell**, the **heat shield**;
  - **Wright Brothers Field**, where Ingenuity made the first powered flight on another planet (sol 58, 19 Apr 2021).
- The real 2022 dust storm sets the storm's pace: tau 0.33 → 1.38 in 4 sols (`reference.json` storm2022).

### Act 3: Find the rover
**Why Perseverance is there (real, from `pois.json` and the proposal):**
- It landed at **Octavia E. Butler Landing** on 18 Feb 2021, sent to Jezero because the crater was once a lake fed by a river delta. Its job is to look for signs of ancient life and collect rock samples for return to Earth.
- It runs on a **nuclear MMRTG** (~110 W), so dust storms do not stop it, and it is a place to recharge.
- It can talk to Earth through orbiters (MRO, Odyssey, TGO; `relay.json`).

**In the fiction:** years later it still drives the delta front, at one of the seeded `rover_candidate` positions. The player tracks it with the last known position, wheel tracks, clue sites and a scrap-built direction finder (proposal §6.2).

### Act 4: Call Earth and wait (the win condition, already designed)
- **Real relay windows:** the rover can only send while an orbiter is overhead. MRO passes about twice a sol for 10–11 minutes (`relay.json`). The player has to be at the rover, with power, during a pass.
- **Real signal delay:** each message also takes the one-way light time (`reference.json` mars.lightTimeOneWayMin).
- **Earth's reply:** a cargo lander already flying to Mars will be retargeted to Jezero, arriving in N sols (fiction; N sets the length of Act 5).

### Act 5: Make it habitable while waiting (research and findings)
Each finding is a short card the player unlocks by doing something. Each is grounded in our data:

| Finding | What the player does | Real basis |
| --- | --- | --- |
| **Air from the air** | Runs a MOXIE-type unit on rover power | MOXIE on Perseverance made 122 g of O₂ from CO₂, at 6–12 g/h for about 300 W. One unit covers only 17–34% of a person's need (proposal §4, `reference.json` moxieO2GramsPerHour). |
| **Where to build** | Compares ground on the thermal-inertia overlay | Bedrock (605) holds heat far better than dune sand (180); MEDA, Martinez et al. 2023 (`reference.json`). |
| **Power through a storm** | Logs solar output across the storm | Real tau record (`dust.json`), sunlight model (`sunlight.json`). Shows why the rover's nuclear power matters. |
| **The cold** | Survives a night | Median night −75 °C, coldest −84 °C (`reference.json` jezeroMeasured). |
| **Signs of an old lake** | Visits the science target | **Wildcat Ridge**: organic molecules in lake mudstone (`content.json` scienceTarget). Optionally also Skinner Ridge, the first delta sample. |
| **The sample cache** | Reaches Three Forks and secures the tubes | 10 tubes dropped sol 653–690 (`pois.json`). |

### Act 6: Rescue and home
The cargo lander arrives. The astronaut flies home with the findings and the sample tubes. **Ending card / debrief:** the player's route, the O₂ used, the findings collected and the samples recovered, drawn on the real HiRISE map. This is the **survival guide the next mission takes back to Mars**, which ties straight back to the challenge title: *Interplanetary Survival Guide: Martian Map*.

---

## Ideas list, updated for this story

| # | Idea | Keep / change | Owner |
| --- | --- | --- | --- |
| 1 | Breath-linked O₂: visor fog, heartbeat, red pulse below 20% | **Keep:** it is the proposal's hook | UI + Sim |
| 2 | Pickups that look like gear (O₂ bottle, LiOH canister, battery) with glow, bob and "+12 min O₂" | **Keep** | Map (`world3d.ts`) |
| 3 | Footprints and slow dust under Mars gravity | **Keep** (small) | Map |
| 4 | Sky that changes with the time of sol, Phobos | **Later:** nice, not story-critical | Map |
| 5 | Dust storm wall on the horizon | **Keep:** Act 2's climax | Map + UI |
| 6 | Slope raises O₂ cost on the route | **Keep:** this is the planner itself | Sim + Map |
| 7 | Perseverance beacon that strengthens as you near it | **Keep:** Act 3 | Map + Data |
| 8 | Scan real rocks for photo cards | **Change:** becomes the Act 5 **findings journal** | UI + Data |
| 9 | End-of-run debrief | **Change:** becomes the Act 6 **"take home" report** | UI |
| 10 | Trailer from the intro | **Keep** for the video | all |
| 11 | **New:** relay pass windows for the call (`relay.json`) | **Add:** real data, real tension | Sim + UI |
| 12 | **New:** Three Forks sample tubes to recover | **Add:** the ending's payoff | Data + Map |

---

## Small text changes this needs in the intro (later, with UI's OK)
- Cabin captions: "MARS APPROACH · PREPARING FOR ENTRY" → "MARS FLYBY · GRAVITY ASSIST TO THE BELT".
- Checklist card title: "ENTRY CHECKLIST" → "FLYBY CHECKLIST".
- The mayday line already fits ("Divert to Mars, the nearest planet").
- The title screen or the first radio line could add the mission: "AER-1 · asteroid-belt prospecting".

## Rules this story keeps
- No NASA logos, flags or insignia. AER-1 is fictional. Archived data is never called "live".
- Every chart names its mission, instrument and sol.
- `[verify]` items stay marked until checked.
