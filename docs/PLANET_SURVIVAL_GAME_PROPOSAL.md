# 🚀 Project Concept: *AER* (Atmospheric Equilibrium & Recovery) / *ExoSurvive*
## A Survival-Driven Marswalk Planner for NASA Space Apps Challenge 2026

> **Target Hackathon:** NASA Space Apps Challenge 2026, November 14–15, 2026  
> **Target Challenge (one only):** *Interplanetary Survival Guide: Martian Map*  
> **Working Directory:** `G:\My Drive\competition\planet_survival_game\`  
> **Document Status:** Revision 4, adding the crash-landing story, scattered supplies, and field manual pages. The original is kept as `PLANET_SURVIVAL_GAME_PROPOSAL_v1.md`.  
> **Marker:** `[verify]` means the value came from memory or is a working assumption. Each one is listed in §9 and must be checked before it reaches the build.

> ⚠️ **Hackathon rules to respect**
> - The Participant FAQ says teams may not begin working on challenges before the hackathon. Write no project code before November 14, and ask the Local Lead whether this concept document counts as early work.
> - Teams may work on only one challenge.
> - Checked November 14 against the 2026 guides: the demo is a video of 30 seconds or less, or up to 7 slides, in English. Exceeding either limit makes the project ineligible for Global judging. Judging criteria: Impact, Creativity, Validity, Relevance (NASA data must be core) and Presentation.
> - SI rules: SI must not be used to come up with the idea itself. Code and data made with SI must be acknowledged in text and metadata. SI-generated images need a visible watermark. No NASA logos or branding in generated content.
> - The submission must describe how AI ("Super Intelligence") tools were used, including for this document and its review.

---

## 🧭 1. Executive Summary & Vision

### 1.1 The Core Idea
*AER* is a Marswalk planning tool with a survival simulation inside it. The player is an astronaut whose rocket went wrong during descent and crash-landed in Jezero Crater instead of landing safely. Essential supplies fell out along the way, and rocket pieces lie scattered across the terrain. The immediate mission is to stay alive. **The lander's radio died in the crash. The ultimate goal is to reach the Perseverance rover and use its radio to call Earth for help.**

To get there, the player plans surface excursions on a layered map built from real NASA data, recovers scattered supplies and field manual pages, salvages rocket pieces as scrap, and builds what they need to survive. Astronauts can learn and adapt, but complex electronics still need a manual. Each route has a cost in oxygen, CO₂ scrubber capacity, cooling water, and battery, calculated from thermodynamic, stoichiometric, and physiological models. Things then go wrong during the walk, and the player has to diagnose and recover. When a dust storm is detected, a five-minute countdown starts and the player must reach shelter.

The tool leads and the game is its run-through: the planner must stand on its own as something a Mars astronaut could use, and the survival scenarios prove why each layer matters.

### 1.2 The Distinctive Hook: "The Air You Cannot Exhale"
Mars's atmosphere is 95% CO₂, yet at this pressure its CO₂ partial pressure is only about 0.6–0.85 kPa, far below the roughly 5.3 kPa in human lungs. The Martian air cannot poison you this way. **The killer is your own breath.** In a sealed suit, every exhalation adds CO₂, and only the scrubber removes it.

- **When the scrubber saturates**, inspired $p\text{CO}_2$ climbs. Ventilation can never pull alveolar CO₂ below the level in the gas being inhaled, so breathing harder stops helping, and hard exertion makes CO₂ production worse. Once inspired $p\text{CO}_2$ passes mixed-venous blood (about 6 kPa), the lungs stop clearing CO₂ and the body retains it until blood levels rise above the inhaled gas.
- **When suit pressure drops**, oxygen fails long before boiling does. In a pure-O₂ suit, blackout comes at about 14–16 kPa, more than double the Armstrong Limit (6.3 kPa) where body-temperature water boils and ebullism begins.
- **Work hot, rest cold.** Thin air carries little heat away, so hard walking can overheat a suited astronaut at $-60^\circ\text{C}$. Stop to rest and the same environment turns into a cold problem. The player manages both.

### 1.3 Scavenging & In-Situ Resource Utilization (ISRU)
Survival depends on what is within reach. Dropped supplies keep the player alive, field manual pages unlock electronics builds, and every piece of the crashed rocket can be salvaged as scrap (§4.1). Real NASA hardware around Jezero provides clues on the way to the rover. Short mission-history cards on each real site explain what it was and the science it made possible.

---

## 🎯 2. Strategic Alignment with NASA Space Apps 2026

### 2.1 Target: *Interplanetary Survival Guide: Martian Map* (Intermediate)
The official statement asks for a map, tool, or interface a Mars astronaut could use on a surface excursion, layering data from multiple NASA missions around a location or route, and supporting both safety and science. *(Paraphrased; read the official statement before building.)*

| Challenge element | How *AER* meets it |
| :--- | :--- |
| Hyperlocal view, not global | One Jezero traverse area at walking scale |
| At least three kinds of data | Topographic, thermal, atmospheric, optical, and spectral layers where available (§5) |
| A science objective | The whole journey is a science goal: reach the rover's radio, with science stops along the route (§6.2) |
| Astronaut safety | Live consumable margins and a calculated point of no return |
| Updates on current conditions | Dust, temperature, and storm warnings that change route costs |
| Suit mobility and carried equipment | Slope, pace, and load set metabolic rate along the route |
| Route that avoids obstacles | Waypoint routing with slope and rock hazard overlays |
| Suggested formats | Planning display plus an in-suit HUD mode |
| Point-of-view imagery | Rover surface images attached to waypoints |

### 2.2 Challenges Considered and Rejected

| Challenge | Why not |
| :--- | :--- |
| Build a Junior Astronaut Mission Trainer | Closest theme, but it targets ages 7–12 with two or three core resources. Raw telemetry would have to go. A simplified version is a possible post-hackathon spin-off. |
| Space Mission Design Game | Wants a complete mission from concept, including instruments, launch, orbit, budget, and comms. |
| Abandoned but not Forgotten | A storytelling challenge for school-age audiences. The history cards keep the spirit of the idea, but it is not the entry. |
| Create Health Monitoring Software | Focuses on long-duration risks such as radiation, bone loss, and behavioral health, not acute blood gases. |

---

## 🔬 3. The Hard Science Architecture

The simulation models Mars only. Thresholds below are driven by partial pressures, never by percentages, because percentages only map to kPa at 1 atm.

### 3.1 Gas Exchange Engine
**Alveolar CO₂** (with $\dot{V}\text{CO}_2$ in mL/min STPD, $\dot{V}_A$ in L/min BTPS, pressures in kPa):

$$P_A\text{CO}_2 = P_I\text{CO}_2 + 0.115 \cdot \frac{\dot{V}\text{CO}_2}{\dot{V}_A}$$

Check: 200 mL/min at 4.3 L/min with clean inspired gas gives 5.35 kPa, the normal resting value. The $P_I\text{CO}_2$ term is the hook, because no amount of ventilation removes it.

**Alveolar O₂** (the alveolar gas equation, with water vapor at 6.3 kPa):

$$P_A\text{O}_2 = F_I\text{O}_2\,(P_B - 6.3) - P_a\text{CO}_2\left[F_I\text{O}_2 + \frac{1 - F_I\text{O}_2}{R}\right]$$

For a pure-O₂ suit this reduces to $P_A\text{O}_2 = P_B - 6.3 - P_a\text{CO}_2$.

**Diffusion** across the alveolar membrane (area $A$, diffusivity $D$, thickness $x$):

$$\dot{V}_{\text{CO}_2} = \frac{A \cdot D}{x} \cdot (P_{\bar{v}}\text{CO}_2 - P_A\text{CO}_2)$$

```
NORMAL (scrubber working)            SCRUBBER SATURATED (inspired pCO2 rising)
+----------------------------+       +----------------------------+
| Alveolus pCO2:   5.3 kPa   |       | Alveolus pCO2:   above 6   |
|        ^  CO2 leaves       |       |        x  clearance stops  |
| Venous blood:    6.0 kPa   |       | Venous blood:    6.0, rising
+----------------------------+       +----------------------------+
```

**CO₂ symptom tiers (suit $P_I\text{CO}_2$):**

| Inspired pCO₂ | Effect | Game effect |
| :--- | :--- | :--- |
| > 1.0 kPa | Mild headache, shortness of breath | Warning only |
| > 3.0 kPa | Visual disturbance, cognitive slowdown | Input latency |
| > 5.0 kPa | Panic, blurred vision, rapid pulse | Blurred HUD, heart rate spike |
| ~ 6 kPa | Lungs stop clearing CO₂ | Blood pCO₂ strip chart climbs regardless of pace |
| > 8.0 kPa | Unconsciousness within about 10 minutes | Countdown to failure |

**Suit pressure tiers (pure O₂):**

| Suit pressure | $P_A\text{O}_2$ at $P_a\text{CO}_2$ = 5.3 kPa | Outcome |
| :--- | :--- | :--- |
| 29.6 kPa | 18.0 kPa | Nominal |
| 20.7 kPa | 9.1 kPa | Low end of operating range |
| 18 kPa | 6.4 kPa | Impaired |
| 16 kPa | 4.4 kPa | Blackout zone (14 kPa if hyperventilating to $P_a\text{CO}_2$ = 3.3 kPa) |
| 6.3 kPa | None | Armstrong Limit: ebullism |

Rapid total decompression gives 9–14 seconds of useful consciousness. Pulmonary barotrauma is modeled as a risk of rapid decompression, not of crossing the Armstrong Limit.

### 3.2 Martian Environment
- **Gravity:** 3.71 m/s², about 38% of Earth's, which applies to carried loads.
- **Pressure** comes from MEDA data for the selected sol, not a constant. The global average is about 0.61 kPa. Jezero's daily mean ranged 587–797 Pa across the 118 MEDA sols in our data (see `docs/DATA_SOURCES.md`); the five scenario sols read 0.625–0.655 kPa.
- **Water** boils at about $0$–$5^\circ\text{C}$ across that range.
- **Suit:** 20.7–29.6 kPa pure O₂, or about 56 kPa N₂/O₂.
- **Dust** optical depth ($\tau$) from rover data sets solar power and storm conditions.

### 3.3 Heat Balance

$$\dot{Q}_{\text{net}} = \dot{Q}_{\text{met}} + \dot{Q}_{\text{avionics}} + \dot{Q}_{\text{solar}} - \dot{Q}_{\text{rad}} - \dot{Q}_{\text{conv}} - \dot{Q}_{\text{evap}}$$

- $\dot{Q}_{\text{met}}$: 100 W at rest, 400 W on a heavy traverse.
- $\dot{Q}_{\text{avionics}}$: 80 W, the Apollo PLSS power requirement.
- $\dot{Q}_{\text{solar}}$: from time of day and $\tau$.
- $\dot{Q}_{\text{rad}} = \varepsilon\sigma A\left[T_s^4 - F_{\text{sky}}T_{\text{sky}}^4 - F_{\text{gnd}}T_{\text{gnd}}^4\right]$. The suit mostly sees ground and sky, not deep space. For a bare 2 m² surface at $20^\circ\text{C}$ with $\varepsilon$ = 0.85, that is about 334–556 W for sink temperatures of 250–200 K. Real suit insulation lowers this `[verify]`.
- $\dot{Q}_{\text{conv}}$: small, not zero. Rough estimate for the same surface: about 33 W in still air and 120 W in a 5 m/s wind, using wind data from MEDA.
- $\dot{Q}_{\text{evap}}$: from the membrane evaporator, at about 2.45 MJ/kg of water.

### 3.4 Metabolic Link
All consumables derive from one metabolic rate, so pace and terrain drive everything:

- **O₂:** about 0.255 g/h per watt, which gives about 35 g/h at the daily average (137 W) and about 100 g/h at 400 W.
- **CO₂:** about 1.19 kg per kg of O₂ (from the 1.0 and 0.84 kg/day baselines, RQ about 0.87).
- **LiOH:** 1.09 kg per kg of CO₂ at stoichiometric limit.
- **Route metabolic rate:** a simple function of slope, speed, and carried load `[verify]`.

**Worked example,** 4-hour walk at 300 W metabolic plus 80 W avionics: about 0.31 kg O₂, 0.36 kg CO₂, 0.40 kg LiOH, and up to 2.2 kg of water if the evaporator carries the whole 380 W.

### 3.5 Power Model

$$P_{\text{solar}} = S \cdot A \cdot \eta \cdot f(\tau, \text{sun angle}) \cdot (1 - \text{soiling})$$

- $f(\tau, \text{sun angle})$ is precomputed from PSG and includes diffuse light.
- Batteries track state of charge and depth of discharge.
- Loads compete for one power budget: suit recharge, MOXIE, regolith baking, sorbent regeneration, and shelter heating.

### 3.6 Mars Hazards

**Core hazards (in the MVP)**

| Hazard | Real basis | Game effect |
| :--- | :--- | :--- |
| **Dust storm** | Dust blocks sunlight: Opportunity's last reading in 2018 was $\tau$ = 10.8, against a usual 0.5, and it never recovered. | Solar power collapses, visibility drops, and tracks are erased. Triggers the shelter countdown (§6.3). |
| **Cold nights** | At Jezero, air runs from about $-83^\circ\text{C}$ to $-23^\circ\text{C}$, with an average near $-55^\circ\text{C}$. | Night travel costs more battery. Being caught outside without shelter is dangerous. |
| **Constant dryness** | No rain and no surface water. Dust is slightly electrostatic, so it clings to surfaces. | Water exists only in tanks, scrap containers, or baked regolith. Dust steadily soils panels, visors, and seals. |
| **Soft sand** | Loose sand can trap vehicles, and low thermal inertia generally indicates loose material `[verify]`. | The THEMIS layer reveals likely soft ground, which slows walking and raises metabolic rate. |
| **Dust devils** | MEDA recorded nearly 5 vortices per sol at Jezero, peaking around 12:00–13:00 local time. | A midday risk that dusts solar panels, or sometimes clears them `[verify]`. |

**Wind does not knock you down.** Mars's air is about 1% as dense as Earth's, so a 100 km/h Martian wind pushes like an 11–13 km/h breeze on Earth. NASA has said a Martian storm would feel like a breeze and is unlikely to strand an astronaut through force. Storms in this game are dangerous because of darkness, lost power, lost navigation, and dust, not force.

**Stretch hazards and atmosphere (only if time allows)**

| Feature | Real basis | Game effect |
| :--- | :--- | :--- |
| **Real Mars audio** | NASA publishes Perseverance microphone recordings, and Mars is mostly deeply quiet. | Real wind audio in the suit. Cheap to add, and it makes the storm feel authentic. |
| **Storm sparks** | Perseverance detected tiny electrical discharges in dust devils and storms, reported in 2025. They carried only 0.1–150 nanojoules. | Crackling audio as a warning cue only, because the energy is too small to cause damage. |
| **Green aurora** | Perseverance saw the first visible aurora from Mars's surface in March 2024, caused by solar energetic particles. | A beautiful green sky that also warns of raised radiation, so the player takes cover. Could use DONKI data. |
| **Message delay** | Earth–Mars signals take about 3–22 minutes one way, depending on where the planets are in their orbits. | Core to the ending: the distress call's reply arrives only after the round trip, so the player must survive the wait. |
| **Blue sunset** | Martian dust makes sunsets blue `[verify]`. | A visual cue that night is coming. |

---

## 🛠️ 4. Realistic In-Situ Crafting & Chemistry Loop

The player assigns hardware and power. The simulation does the chemistry.

```
[Martian Atmosphere: 95% CO2]
            │
            ▼
    [MOXIE Solid Oxide Cell] ──(warm-up to 800°C, ~300 W)──► [2 CO2 ➔ 2 CO + O2]
            │                                                       │
            ├─► Toxic Carbon Monoxide [VENTED OUTSIDE]              ▼
            └─► O2 at 6-12 g/h ─────────────────────────────► [O2 Reserve Tank]

[Jezero Regolith: hydrated minerals, ~2 wt% water]
            │
            ▼
    [Regolith Bake Oven] ──► Drives off water as vapor; salts stay in the spent soil
            │                (Overheating risks chlorine contamination from perchlorates)
            ▼
    [Condenser Unit] ──────► Water for drinking and evaporator cooling
```

### Hardware Modules

| Module | Real performance | Game role |
| :--- | :--- | :--- |
| **MOXIE electrolyzer** | 6–12 g/h O₂ at about 300 W `[verify power]`; 122 g across its whole mission | Stretches reserves but cannot sustain a person. One unit gives 144–288 g/day, or 17–34% of the 840 g/day need, for 7.2 kWh/day (25–50 kWh per kg O₂). |
| **LiOH canisters** | Consumable, 1.09 kg per kg CO₂ | Simple and limited. Saturation triggers Scenario 1. |
| **Regenerable sorbent bed** | Mars's CO₂ pressure is close to the suit's 1 kPa limit, so venting alone gives almost no gradient. Regeneration needs heat. | Not infinite: costs power and time. Moisture degrades the bed `[verify]`. Station-derived hardware, so it comes from the player's rocket. |
| **Membrane evaporator** | Designed to reject heat at Mars pressures. Sublimators cannot work there. | Up to 0.37 kg/h at 250 W, 0.59 kg/h at 400 W, and 0.81 kg/h at 550 W if it carries the whole load. Water is the price of working hard. |
| **Regolith bake oven** | About 50 kg of regolith and at least 3.3 kWh of sensible heat per kg of water, at 2 wt% and a 300 K rise `[verify]` | Slow, power-hungry water recovery. 2.5 L/day would take about 125 kg/day. |

**Out of the MVP:** the Sabatier reactor. It needs a hydrogen source, which means a full water electrolysis chain.

### 4.1 Scattered Supplies, Scrap, and Manuals

The player's rocket is a fictional crewed lander. It failed during descent, dropped cargo along its path, and crash-landed. Its surviving cabin is the starting base. Supplies, rocket pieces, and manual pages lie at hand-placed positions, mostly along the crash path, which forms a trail across the map.

**Essential supplies** work as soon as they are found:

| Supply | Effect |
| :--- | :--- |
| O₂ bottle | Adds to the oxygen reserve |
| LiOH canister | Restores CO₂ scrubbing |
| Water pack | Drinking and cooling water |
| Battery pack | Suit and tool power |
| Repair kit | Fixes one suit or equipment fault |

**Every rocket piece is usable.** Each one breaks down into scrap materials, and recipes spend materials rather than specific parts. Carried scrap has mass, and mass raises metabolic rate through §3.4, so hauling everything is never free.

| Rocket piece | Scrap yield |
| :--- | :--- |
| Hull and fairing panels | Metal |
| Parachute and straps | Fabric |
| Thermal blankets | Insulation |
| Wiring harnesses | Wiring |
| Avionics boxes and antenna | Electronics |
| Solar array segments | Solar cells, wiring |
| Tanks and valves | Tank parts, plus any leftover gas or water inside |

| Build | Materials | Knowledge | What it does | The catch |
| :--- | :--- | :--- | :--- | :--- |
| **Storm shelter** | Metal, fabric | Astronaut training | Shelter anywhere, keeping gear clear of dust and cutting heat loss | Heavy to carry, and slow to assemble |
| **Insulation wrap** | Insulation, fabric | Astronaut training | Less heat loss at rest and at night | Raises overheating risk while walking |
| **Cargo sled** | Metal, fabric | Astronaut training | Carries more scrap | Slopes cost more, and it bogs down in soft sand |
| **Solar patch** | Solar cells, wiring | Manual page | Extra charging at a site | Near useless in a storm, and needs dust cleared |
| **Oxygen tap** | Tank parts, wiring | Manual page | Recovers leftover oxidizer from a damaged tank as breathing O₂ | Takes time, and the amount left is limited |
| **Direction finder** | Electronics, wiring | Manual page | Gives a bearing to the rover's beacon | Each ping costs battery |
| **Rover comms link** | Electronics, wiring | Manual page, required | Connects to the rover's radio to send a distress call to Earth | Needed to win, and cannot be improvised |

**Field manual pages.** Pages from the rocket's field manual are scattered with the supplies. Each page unlocks one electronics build and appears in a field manual screen. Pages are short and in plain language, and each explains one real principle, such as how a solar cell or CO₂ scrubber works, with its source.

**Learn and adapt.** The astronaut can improvise any manual build except the rover comms link without its page, at double the materials and time, with a chance of failure. A successful build counts as learned, so repeat builds go faster.

The oxygen tap assumes the fictional lander used liquid oxygen. The rover beacon and comms link are also game fiction. The game labels all three as fictional so they are not mistaken for NASA data.

---

## 📡 5. Open NASA Data Integration Plan

All data is fetched before the demo and baked into a static data pack. Nothing depends on a live API at runtime. Charts label data as archived, with mission, instrument, and sol, and never present static data as live.

| NASA Data Asset | Source | Layer type | Function |
| :--- | :--- | :--- | :--- |
| **HiRISE imagery and elevation models** | USGS Astrogeology / NASA Mars Trek | Optical, topographic | Base map, slope, hazards `[verify coverage of chosen area]` |
| **THEMIS thermal inertia** | USGS Astrogeology / NASA Mars Trek | Thermal | Surface temperature behavior, terrain type |
| **Perseverance MEDA** | PDS Atmospheres Node | Atmospheric | Sol-by-sol pressure, temperature, wind, dust |
| **Planetary Spectrum Generator** | `psg.gsfc.nasa.gov/api.php` | Atmospheric | Precomputed solar flux against $\tau$ and sun angle. The public limit is 100 calls per day. |
| **Perseverance surface images** | NASA / PDS | Optical | Point-of-view images at waypoints |
| **Orbital mineral data (e.g. CRISM)** | PDS | Spectral | Science target context `[verify]` |
| **Life Support BVAD Rev 2 (2022)** | NASA/TP-2015-218570 Rev 2 | Reference | Metabolic baselines. This document uses 0.84 kg O₂, 1.0 kg CO₂, and 2.5 L water per day `[verify against Rev 2]`. |

Two stretch sources are worth adding if time allows: space weather data (such as DONKI), since the challenge notes radiation as a consideration, and NASA's published Perseverance microphone recordings for real Mars audio.

---

## 🎮 6. Gameplay Loop & UI Architecture

### 6.1 The Loop
1. **Plan:** choose where to search next, place waypoints on the layered map, and set pace and load. The route shows its cost and point of no return.
2. **Commit:** the walk runs in time warp, with the forecast updating as conditions change. The player collects supplies, scrap, manual pages, and clues along the way.
3. **Triage:** an alarm drops time to 1× and the HUD shows the anomaly.
4. **Diagnose:** telemetry supports two or three plausible causes, and the player picks one. Rising pCO₂ could mean a saturated canister, a failed fan, or simple overexertion.
5. **Recover:** the player changes pace, reroutes, builds or swaps a part, or reallocates power, then continues the search with the best margin they can.

**Design rules**
- Players never solve an equation. They make a decision and watch a forecast change, such as "O₂ out in 2:14."
- Symptoms degrade the interface itself: input lag, blurred HUD, narrowed vision.
- No choice is free. Every recovery costs oxygen, water, power, or science.
- Failures explain why they happened, so a rerun teaches something.

### 6.2 Setting, Scenarios, and Outcomes
- **Site:** Jezero Crater, chosen for MEDA data and the variety of real hardware nearby. Candidates for clue sites include Ingenuity, the descent stage, the backshell, and the parachute. Confirm positions and walkable distances on Mars Trek `[verify]`.
- **Time frame:** a fictional future crewed mission, using real archived Mars conditions.
- **Science objective:** science stops along the route, starting with one rock or outcrop target from Perseverance's traverse, selected once the map area is fixed `[verify]`.

**The rover: why it matters.** The lander's relay radio was destroyed in the crash, and suit radios only reach the lander. Perseverance can still talk to Earth, directly through its high-gain antenna and through orbiters such as MRO `[verify]`, so it is the astronaut's only way to call for help. The rover runs on a nuclear MMRTG, not solar panels, so dust storms do not stop it. NASA gives about 110 W at the start of the mission, declining a few percent a year, with a design life of at least 14 years. That steady power also makes it a place to recharge while waiting for Earth's reply.

**The rover: why it is lost.** The cabin's maps are old archives, and the rover kept driving after they were made. In the fiction, it has since gone quiet. A seed picks one of three to five hand-placed positions along its real traverse, so each run differs.

**How the player finds it**
1. **Last known position:** a wide search circle on the map.
2. **Wheel tracks:** found on the ground, they narrow the search. A storm erases any tracks not yet followed.
3. **Clue sites:** real hardware sites along the way give a clue and a history card.
4. **Direction finder:** built from scrap, it gives a bearing to the rover's beacon.
5. **Rover comms link:** built from scrap using its manual page, it lets the player send the distress call on arrival.

| Scenario | Failure | Real data used | What it teaches |
| :--- | :--- | :--- | :--- |
| **Sol 1: Scrubber Saturation** | LiOH capacity runs out while salvaging the debris field | Terrain cost | The hook: your own breath, and why slowing down beats breathing harder |
| **Sol 2: Cooling and Water** | Evaporator fault or water shortfall on the long walk | MEDA temperature, wind, pressure | Work hot, rest cold, and water as a heat budget |
| **Sol 3: Dust Storm** | Storm countdown, then solar power collapses | Real $\tau$ record from a dust event | The power trade, then the final search for the rover |

The rover always sits at the end of the last scenario that gets built, so the game still has an ending if a scenario is cut.

- **Win:** reach the rover alive, connect the comms link, send the distress call, and survive until Earth's reply arrives after the round-trip signal delay (§3.6).
- **Lose:** physiological failure, or reserves that cannot reach any shelter or the rover.
- **Score:** science value, remaining margin, and diagnosis accuracy.

### 6.3 The Storm Countdown
A warning appears: **"DUST STORM APPROACHING: 05:00."** The player has five real minutes to get under cover, and the map highlights every shelter within reach.

| Choice | Benefit | Cost |
| :--- | :--- | :--- |
| **Run for the cabin** | Best shelter, with stored supplies | Lose progress, and a hard run burns O₂ and builds heat |
| **Reach a large wreck piece** | Closer, with scrap on site | Weaker shelter |
| **Build a storm shelter on the spot** | Works anywhere | Needs carried metal and fabric, plus build time |
| **Keep searching** | Might reach the rover first | Risky: near-blind navigation, tracks erased, and no charging |

Once the storm hits, visibility collapses, tracks disappear, solar output falls, and the sky goes dark. Shelter quality sets how much heat, battery, and gear condition the player keeps. The player can wait it out, but waiting burns O₂ and battery, so the storm cannot simply be ignored.

Real regional storms usually build over much longer than five minutes `[verify]`, so the countdown is a design choice for pacing. In the fiction, it is the time left before the dust front reaches the player.

### 6.4 Time Model
Three sols last 266,325 seconds, so a 5-minute playthrough would need about 890× speed and the 9–14 second consciousness window would pass in a single frame. The simulation therefore uses four speeds:

- **Planning and crafting:** paused, except for build time charged to the clock.
- **Traverse:** high time warp, with a fixed simulation timestep and substeps.
- **Storm countdown:** fixed at about 24×, so five real minutes is about two Mars hours.
- **Emergency:** alarms drop to 1×.

### 6.5 The UI/UX Concept
- **Form Factor:** Web-based, with no install and no account.
- **Aesthetic:** High-density aerospace telemetry console (retro-futuristic green/amber monochrome).
- **Main views:** planning map, in-suit HUD, and a simple inventory screen for builds and the field manual.
- **Interactive Gauges:** Strip charts of blood gas partial pressures, suit pressure, core temperature, solar wattage, and battery depth of discharge.
- **Traverse view:** 2D top-down on real orbital imagery, with plan-and-commit waypoints. No 3D.

### 6.6 Map and Visibility
**Decision: one fixed map with limited visibility, not a 3D open world.** A free-roaming 3D world would need terrain, character movement, animation, and art that do not fit in 48 hours. It would also replace the planner, which is the challenge deliverable.

- **The map:** one fixed Jezero area a few kilometers across, sized to the chosen elevation tile.
- **Always visible:** orbital imagery and data layers, because the astronaut has those archives. These stay in view so route planning always works.
- **Hidden until seen:** supplies, rocket pieces, manual pages, tracks, and the rover. They appear only inside the astronaut's sight radius.
- **Remembered:** explored ground stays marked, and found items stay on the map. Tracks can still be erased by a storm.
- **Conditions change sight:** the radius is widest on a clear day, shorter at night, and tiny in a storm. Starting values are 300 m, 50 m, and 20 m, as design values to tune in playtesting.
- **Being there:** real rover surface images appear at waypoints, giving a first-person feel without building a 3D world.
- **Visual depth:** terrain is shaded from the real elevation data, so hills and craters stand out on the 2D map.
- **Item art:** simple icons in the telemetry style, so no 3D modeling is needed.

---

## ⏱️ 7. 48-Hour Hackathon Implementation Scope (MVP)

### Team Roles (4 people)

Put your strongest data or mapping person on Data, because it is the biggest risk. All four use Claude. The UI and Submission owner also uses ChatGPT for the writeup and an independent fact-check.

| Role | Owns |
| :--- | :--- |
| **Data** | HiRISE tiles, elevation, THEMIS, MEDA, and PSG, baked into static JSON. Attribution text. |
| **Simulation** | Physics models, metabolic link, hazards, storm model, unit tests, forecast, time model, and the `[verify]` values in §9 |
| **Map** | Layered map, waypoints, slope cost, point of no return, hazard overlays, placement of supplies, debris, manual pages, and the rover, track clues |
| **UI and Submission** | HUD, strip charts, interface effects, inventory, build, and manual screens, scenario flow, storm countdown, video, submission page |

Data also owns the item and recipe tables, the manual page text, and the writeup draft once the data pack is done.

### Hour-by-Hour Plan

Hour 0 is the start of your Local Event. If your event ends before hour 48, move the freeze and submission gates earlier by the same amount.

| Hours | Data | Simulation | Map | UI and Submission |
| :--- | :--- | :--- | :--- | :--- |
| **0–1** | **All four:** lock the data pack format and simulation inputs and outputs, set up the repo, shortlist map areas, read the November 13 guides | | | |
| **1–4** | Check elevation coverage, lock the map area | Gas exchange models and tests | Map shell on a placeholder tile | UI shell and strip charts on fake data |
| **4–12** | Bake imagery, elevation, and MEDA for chosen sols | Heat, power, metabolic link, carried mass | Waypoints, slope cost, layer toggles | HUD and Sol 1 script on fake data |
| **12–24** | PSG, thermal layer, surface images, real data into the app | Forecast, point of no return, time model | Route costing wired to the engine, sight radius, item pickups, rover placement | Sol 1 end to end, with a basic inventory |
| **24–36** | Storm dust record, item and recipe tables, manual page text, attribution text | Storm model, cold nights, soft sand, tuning | Track clues, direction finder, hazard overlays | Build and manual screens, storm countdown and shelter flow, interface effects, diagnosis screens |
| **36–40** | Real audio, history cards, writeup draft | Sol 2 model and tuning, if the gate passes | Playtesting, bug fixes | Sol 2 flow if the gate passes, video script |
| **40–44** | **All four:** feature freeze, playtest, and fix bugs only. Deploy the public build. | | | Record and edit the video |
| **44–46** | **All four:** finish the submission, including data sources and the AI use description | | | |
| **46–48** | Buffer only. No new features. | | | |

### Gates

| Hour | Must be true | If not |
| :--- | :--- | :--- |
| **3** | Map area locked with confirmed elevation coverage | Switch area, or fall back to Mars Trek layers |
| **12** | Engine passes the §3 checks, and a real tile shows on the map | Stop adding features until both work |
| **24** | Sol 1 playable end to end on real data, with item pickups and a reachable rover | Drop Sol 2, and all four finish Sol 1 |
| **36** | Storm countdown, shelter, crafting, and manual pages solid and playable | Cut Sol 2 and polish what exists |
| **40** | Feature freeze | No exceptions |
| **44** | Submission draft saved with a working public link | Cut anything still unfinished and submit |

### Working Rules
- **Sleep:** everyone sleeps at least once, in staggered pairs, so someone is always available and usage limits do not all run out together. Avoid sleeping through a gate.
- **Git:** merge small changes often, and keep each person inside their own area.
- **AI use log:** each person keeps a short running note for the submission.

**Build order:** Sol 1, then the storm, then Sol 2. The storm comes first because it uses real dust data and makes the strongest demo.

**Cut order if time runs short:**
1. Stretch hazards
2. Sol 2
3. Improvised builds
4. Recipes, down to the storm shelter, direction finder, and rover comms link
5. The storm countdown

The minimum viable entry is a working map with route costing, supply and scrap pickup, the comms link manual page, Sol 1, and a rover to find.

### Recommended Tech Stack
- **Frontend:** React with TypeScript on Vite, built as a static site.
- **Map and charts:** 2D HTML5 Canvas or SVG.
- **Simulation Engine:** Pure TypeScript deterministic model, with unit tests for the checks in §3.
- **Data:** Static JSON and image tiles bundled with the site.
- **Hosting:** Vercel or any static host.

### Demo Plan (first 15 seconds)
Open on a real HiRISE tile with a route drawn on it. Change the sol, and the MEDA temperature, pressure, and dust curves update while the route turns red. Then the storm countdown starts, and the demo ends on the race to shelter and the rover. Every chart carries its mission, instrument, and sol.

The 2026 rules (confirmed November 14) allow a video of 30 seconds or less or up to seven slides, with English subtitles on any non-English video, and the demo must show how NASA and space agency data made the project possible.

---

## 🧩 8. Design Decisions Resolved in Review

1. **Rigor vs. fun:** physics is the consequence, not the quiz. Players decide, and the forecast and interface respond (§6.1).
2. **Scavenge pacing:** 2D plan-and-commit traverse on real imagery, which doubles as the challenge deliverable (§6.5).
3. **Judge appeal:** real imagery and sol-labeled curves that visibly change the route (§7).
4. **Planet scope:** Mars only.
5. **Ultimate goal:** survive the crash, reach Perseverance, and use its radio to call Earth (§6.2). Decided November 14, replacing "download its data".
6. **Storms:** the danger is dust, darkness, and lost power, not wind force (§3.6, §6.3).
7. **Crafting:** every rocket piece becomes scrap materials, carried mass has a metabolic cost, and electronics builds need manual pages (§4.1).
8. **Challenge fit:** the planner stays at the center. Scrap, shelter, and the search are all route decisions, so the entry still reads as a tool an astronaut could use.
9. **World type:** one fixed 2D map with limited visibility, not a 3D open world (§6.6).
10. **3D and Blender:** not used, because no one on the team knows Blender. Visual depth comes from shaded elevation and real NASA images (§6.6).

**Out of scope, kept for later:** Venus, Titan, Europa, and an exoplanet mode. Of the solar system bodies listed, Venus is the only one where outside air could cause the CO₂ reversal directly. Note for that work: about $20^\circ\text{C}$ on Venus occurs near 56 km at about 0.56 bar, while 1 bar sits near 50 km and is hotter.

---

## ✅ 9. Verification Checklist

Check these before relying on them in the build:

- [x] Jezero pressure range from MEDA: 587–797 Pa daily mean across 118 sols; 0.625–0.655 kPa on the five scenario sols
- [x] MOXIE power draw: rated 300 W for 6–12 g/h (NASA)
- [x] Suit consumables checked against Apollo and EMU figures (November 14): 80 W avionics, 0.6 kg O₂, 3.9 kg water, 640 Wh battery, LiOH sized to outlast the O₂
- [x] Panel dust: 0.2%/sol typical, 2%/sol highest observed (Lorenz et al. 2021)
- [ ] Water content of Jezero regolith (2 wt% assumption) and the absence of accessible shallow ice
- [ ] Chlorine release when overheating perchlorate-bearing regolith
- [ ] Suit insulation effect on radiative and convective loss at Mars pressure
- [ ] Moisture degradation of the sorbent bed
- [ ] Suited metabolic rate against slope, speed, and load
- [x] O₂ and CO₂ baselines: 0.84 and 1.0 kg/person-day match NASA's ISS-era averages (BVAD Rev 2 table itself not checked)
- [ ] CO₂ per O₂ at hard work: NASA uses 1.87 g/min CO₂ at 300 W; the sim gives 1.52 with the daily-average ratio
- [ ] HiRISE elevation model coverage for the chosen area
- [ ] Orbital spectral coverage for the science target
- [ ] Positions, distances, and current status of Jezero hardware and debris
- [ ] Science target selection
- [ ] Perseverance's real traverse, for rover candidate positions
- [x] Rover goal decided: the rover is the radio home (November 14)
- [ ] Perseverance's links to Earth: direct high-gain antenna and UHF relay through orbiters
- [ ] Which sols of Jezero dust data to use for the storm
- [ ] How quickly real regional storms build
- [ ] Thermal inertia as an indicator of loose sand
- [ ] Dust devils clearing solar panels
- [x] Earth–Mars signal delay: about 3–22 minutes one way
- [ ] Blue sunsets (stretch feature)
- [x] 2026 Project Submission and Judging guides, plus the challenge Resources tab (checked November 14)
- [ ] Local Lead's view on pre-hackathon concept work
