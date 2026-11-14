# Space Apps 2026 submission draft

Each `##` section below matches a field on the Space Apps project page. Paste them in as written. Lines marked **TODO** still need a teammate before we submit, and lines marked **CHECK** describe something not built yet: delete or update them at the hour-40 feature freeze, so the page only claims what judges can open.

Deadline: **Sunday, November 15, 11:59 p.m.** local time. Everything must be in English.

---

## Project Name

AER: Atmospheric Equilibrium & Recovery

## High-Level Project Summary

AER is a Marswalk planner for the first astronauts on Mars, with a survival game inside it. It layers real NASA data over Jezero Crater, where Perseverance landed: HiRISE images and elevation, THEMIS thermal inertia, MEDA weather and Mastcam-Z dust measurements. An astronaut can plan a walk there and see what it will cost in oxygen, CO₂ scrubber capacity, cooling water and battery, and the latest moment they can turn back and still reach shelter.

The game shows why each layer matters. A lone astronaut crash-lands in Jezero with a dead radio and must reach Perseverance to call Earth for help, before their own exhaled CO₂, the cold or a dust storm stops them. Every number in the suit comes from NASA physiology and spacesuit data. The challenge asks for a hyperlocal map that keeps an explorer safe while they do science; AER turns that map into decisions the player can feel.

## Link to Project Demo

**TODO:** a 30-second video with English subtitles, uploaded somewhere public (YouTube or Google Drive), and tested in a private window. Script at the end of this file.

## Link to Final Project

- Code: https://github.com/ZektoxFx/aer
- Live app: **TODO** (the Vercel production link for `main`). Test it in a private window before submitting.

## Detailed Project Description

### What it does

AER helps a Mars astronaut answer one question before every surface walk: *can I get there and back alive, and what will it cost?*

- **A hyperlocal layered map** of a 6.4 × 4 km area of Jezero Crater, from the Octavia E. Butler landing site to the western delta front, at walking scale. The layers:
  - a HiRISE photo mosaic
  - shaded relief and slope from the HiRISE elevation model
  - a THEMIS thermal-inertia layer that flags likely soft sand
  - real Perseverance hardware, sample sites and the rover's traverse
- **Route costing.** **CHECK** (Map): the player places waypoints, and the route shows its oxygen, scrubber, water and battery cost. It turns red past its **point of no return**, the last moment the astronaut can turn back and still reach shelter with an oxygen reserve.
- **Live suit telemetry.** Strip charts of oxygen, inhaled CO₂, battery and core temperature on five archived MEDA sols (chosen from the 118 sols in the data pack, including the January 2022 dust storm), with warnings as limits approach.
- **Survival scenarios.** Each one teaches a real hazard:
  - **Scrubber saturation:** on Mars, the danger is your own breath. Mars air is 95% CO₂ but too thin to poison you; in a sealed suit, every exhalation adds CO₂, and only the scrubber removes it.
  - **Work hot, rest cold:** walking overheats the suit even at −55 °C, while resting at night brings on hypothermia.
  - **A dust storm:** a five-minute countdown to shelter, then collapsing solar power and lost tracks.

### How it works

- **Suit simulation (TypeScript, checked by automated tests: TODO update the count at freeze, 75 project-wide when drafted).** Oxygen use, CO₂ production and scrubber use all come from one metabolic rate set by speed, slope and load.
  - Rates follow NASA's ISS-era averages (0.84 kg O₂ and 1.0 kg CO₂ per person per day). A 300 W walk matches the Apollo moonwalk average.
  - Starting supplies match Apollo and ISS spacesuit figures: 0.6 kg O₂, 3.9 kg cooling water, an 80 W electronics load.
  - Body heat is balanced against the cold and the suit's evaporative cooler.
- **Point of no return.** The planner simulates the walk out, minute by minute. At each minute it also simulates the walk back along the same path, with uphill and downhill swapped. The last minute that still gets the astronaut home safely is the point of no return. On a long flat walk it is about 3½ hours with a fresh suit. With the partly used scrubber the crash leaves behind, it is about 2 hours: then the scrubber, not the oxygen, sets the limit.
- **Weather and light.** Temperature, pressure and wind come from Perseverance MEDA data for the chosen sol, shaped over the day. The sun's position follows Jezero's latitude and the season. Sunlight under dust comes from NASA's Mars solar radiation model (TM-103623), which includes light scattered by dust.
- **Dust storms.** Dust optical depth drives solar power and how fast dust coats the panels: 0.2% per sol in clear weather, capped at the 2% per sol highest ever observed. The game's storm is deliberately stronger than Jezero's real January 2022 storm (τ 1.38 at its peak, which the data pack includes). Its peak is based on the global storm that ended Opportunity in 2018 (τ 10.8). **CHECK:** say so on screen, or switch to the real Jezero curve.
- **The data pipeline.** Python scripts read only the needed parts of multi-gigabyte USGS HiRISE files and bake everything into static files. Nothing depends on a live service, and the app runs anywhere.

### Benefits

- **For mission planning:** NASA's existing Mars maps are regional or global. AER works at the scale of a single walk, and turns the data into the numbers a crew needs: cost, margin and when to turn back.
- **For learning:** the scenarios make invisible risks concrete. Players learn why breathing harder does not help when the scrubber fails, and why a dust storm is dangerous for darkness and lost power, not wind. Mars air is so thin that a 100 km/h wind pushes like an 11–13 km/h breeze on Earth.
- **Honest about its limits:** every chart names its mission, instrument and sol. Game fiction (the AER-1 lander, the supplies, the radio relay) is labelled as fiction.

### What we hope to achieve

A tool that could grow into a real crew planning aid: one where any Mars site with NASA data can become a walkable, costed map, and where the same simulation helps people understand what the first Mars walks will demand.

### Tools and languages

TypeScript, React and Vite for the app; Vitest for tests; Python (NumPy, SciPy, Pillow, tifffile) for the data pipeline; GitHub for collaboration; Vercel for hosting.

## Use of Super Intelligence (SI)

**TODO (team):** each member adds their own AI-use log here. Judges don't see this field, but they do see the AI labels inside the project. The rules say SI may help build the project, but must not come up with the idea.

Draft:

- **The idea:** the concept came from team members, both the original crash-survival game and the Marswalk planner proposal that refined it. **TODO (team):** one story detail was suggested by Claude while reviewing the proposal: the rover as the radio to call home, instead of a source of data to download. The team chose it. Decide together how to describe this honestly.
- **Code:** Claude (Anthropic) helped write and test the simulation, the data pipeline and parts of the interface. Commits it helped with carry a `Co-Authored-By: Claude` line, and the README says so.
- **Data:** Claude helped write the data-processing scripts. Another AI agent (Antigravity) drafted the original pack and the story content, including rock chemistry and field manual pages. We replaced its unsourced numbers: the Máaz and Séítah rock values now come from published SuperCam measurements (Wiens et al. 2022), the manual pages cite real sources, and the delta and regolith entries carry no unchecked numbers. Every data value comes from the sources listed below, not from AI.
- **Images:** the AER-1 lander image is AI-generated and carries a visible "AI GENERATED ASSET" watermark. No NASA logos or insignia are used.
- **Fact-checking:** AI was used to look up spacesuit and Mars values. Each one is cited in the code and in this document.

## NASA Data

- **HiRISE** (Mars Reconnaissance Orbiter): 25 cm orthomosaic and 1 m elevation model of Jezero, from the USGS Mars 2020 terrain-relative-navigation products ([DOI 10.5066/P9REJ9JN](https://doi.org/10.5066/P9REJ9JN)). Used for the base map, shaded relief, slope and route cost.
- **THEMIS** (Mars Odyssey): thermal inertia (Edwards & Buz 2021, [Zenodo 4931348](https://zenodo.org/record/4931348)). Used for the soft-sand hazard layer.
- **Perseverance MEDA** ([PDS Atmospheres Node](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html)): 118 sols of pressure, air and ground temperature, wind, and long-wave (heat) radiation. Used for the weather in every scenario.
- **Perseverance Mastcam-Z** dust optical depth for 1358 sols, including the January 2022 Jezero dust storm (M. Lemmon, [Mendeley 10.17632/gktjp9jptb.2](https://data.mendeley.com/datasets/gktjp9jptb/2)). Used for dust and solar power.
- **Mars 2020 waypoints, traverse and sample list** (NASA/JPL [MMGIS](https://mars.nasa.gov/mmgis-maps/M20), [sample list](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/)), and **HiRISE ESP_068294_1985** for the landing hardware. Used for points of interest and the rover's hiding spots.
- **Mars 2020 raw images** (NASA/JPL-Caltech, ASU): point-of-view photos at waypoints.
- **Perseverance SuperCam** rock compositions for the Máaz and Séítah formations (Wiens et al. 2022, *Science Advances* 8, eabo3399, [open access](https://www.science.org/doi/10.1126/sciadv.abo3399)). Used for the rock and terrain descriptions.
- **NASA TM-103623**, Appelbaum & Flood, *Solar Radiation on Mars: Update 1990* ([NTRS](https://ntrs.nasa.gov/citations/19910005804)). Used for surface sunlight under dust.
- **NASA life-support and spacesuit references:**
  - Apollo PLSS documents ([ALSJ](https://history.nasa.gov/alsj/ALSJ-FlightPLSS.pdf)) and Apollo metabolic rates ([TN D-7883](https://www.nasa.gov/wp-content/uploads/static/history/alsj/tnD7883Metabolic.pdf)).
  - NASA ISS life-support baselines ([NTRS 20120015343](https://ntrs.nasa.gov/api/citations/20120015343/downloads/20120015343.pdf)) and a CO₂-system requirements document ([NTRS 20170010189](https://ntrs.nasa.gov/api/citations/20170010189/downloads/20170010189.pdf)).
  - MOXIE results ([NASA](https://science.nasa.gov/blog/a-day-full-of-moxie/)).

## Space Agency Partner Data and Other References

- **Space Agency Partner data:** none used yet. **TODO (optional):** the challenge encourages partner data. A quick, honest option would be to mention ESA's Mars Express and Trace Gas Orbiter as relays in the radio story. **CHECK:** cite an ESA or NASA source that they relay Perseverance's data before adding this. The NASA Mars 2020 pages we checked only name MRO and MAVEN, and the field manual page names those two. Only add it if it goes into the project itself.
- Lorenz et al. 2021, *Lander and rover histories of dust accumulation on and removal from solar arrays on Mars*, Planetary and Space Science ([HAL](https://hal.sorbonne-universite.fr/hal-03369920)). Used for panel dust rates.
- Sánchez-Lavega et al. 2023, Jezero MEDA pressure ([arXiv 2401.12931](https://arxiv.org/abs/2401.12931)).
- Open-source software: React, Vite, Vitest, TypeScript, NumPy, SciPy, Pillow, tifffile, imagecodecs.
- Full data provenance and caveats: `docs/DATA_SOURCES.md` in the repository.

---

## Demo video script (30 seconds, follows the guide's timeline)

| Time | On screen | Voice / subtitle |
| --- | --- | --- |
| 0:00 | Team name over the HiRISE map | "We're team **TODO**." |
| 0:02 | Challenge title | "Our challenge: Interplanetary Survival Guide, the Martian Map." |
| 0:05 | AER title, crashed lander image (watermarked) | "AER: plan a Marswalk you can survive." |
| 0:10 | A route drawn on Jezero, turning red past the point of no return; CO₂ chart climbing | "Real NASA data, HiRISE terrain and Perseverance weather, sets what every step costs. On Mars, the danger is your own breath." |
| 0:20 | Storm countdown, then the race to Perseverance | "From one walk today to the first human missions: maps that keep explorers alive." |
| 0:28 | GitHub and app links | — |

The guide's rules: 30 seconds or less, English subtitles if spoken in another language, and no images of anyone under 18. Exceeding 30 seconds makes the project ineligible for Global judging.

## Before we press "Submit for Judging"

- [ ] All four of us are confirmed participants at the same Local Event
- [ ] Every TODO and CHECK above is resolved
- [ ] The demo link and the app link open in a private window, with no login
- [ ] Everything is in English; the video has English subtitles
- [ ] No NASA logos in anything AI-generated; the AI image watermark is visible
- [ ] The storm intensity is either the real Jezero curve or labelled as stronger than reality
- [ ] Submitted before Sunday 11:59 p.m. local time
