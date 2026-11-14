# AER data pack: sources, files and caveats

Everything in `public/data/` was fetched before the hackathon demo and baked into static files. Nothing calls a live API at runtime. Label every chart as archived data with its mission, instrument and sol.

## The map area

- **Where:** Jezero Crater, from the Octavia E. Butler landing site west to the delta front. It covers the landing hardware, Séítah, the first 18 sample sites and the Three Forks sample depot.
- **Size:** 6.4 km east–west by 4.0 km north–south. The landing site is 3700 m from the west edge and 2400 m from the north edge.
- **Grid:** north-up, in true ground metres. Row 0 is the north edge. `xM` runs east and `yM` runs south from the north-west corner.
- **Landing site:** 18.44462715° N, 77.45088572° E, at −2569.9 m. This is Perseverance's first localisation (sol 13). The baked elevation at this point matches to 0.01 m (checked in `src/data/data.test.ts`).

## Files

| File | What it holds | Source |
| --- | --- | --- |
| `jezero_pack.json` | The `DataPack` (shared contract): 10 m elevation grid (640 × 400), 5 scenario sols, landing hardware, rover waypoints, and the story content | See the rows below |
| `jezero_base_1m.jpg`, `jezero_base_2m.jpg` | Base map photo, contrast-stretched | HiRISE 25 cm orthomosaic, USGS Mars 2020 TRN products ([DOI 10.5066/P9REJ9JN](https://doi.org/10.5066/P9REJ9JN)) |
| `hillshade_2m.png` | Shaded relief, lit from the north-west | HiRISE 1 m DTM mosaic, same USGS release |
| `overlay_slope_2m.png` | Slope bands: yellow ≥ 10°, orange ≥ 15°, red ≥ 25°, dark red ≥ 35° | HiRISE DTM |
| `terrain_patch_2m.bin` + `terrain_patch_2m.json` | 2 m height tile, 1.6 × 1.6 km (800 × 800), centred on the AER-1 cabin, for the 3D walking view. Covers the cabin, descent stage, parachute, landing site and Ingenuity's airfield. True heights; matches the 10 m grid to 5 cm. Load with `src/data/terrainPatch.ts` (`loadTerrainPatch`, `patchHeightAt`) | HiRISE 1 m DTM mosaic, same USGS release; built by `tools/data/bake_patch.py` |
| `layers_20m.json` | Slope, roughness, thermal inertia and terrain class for each 20 m cell | HiRISE DTM; THEMIS thermal inertia (Edwards & Buz 2021, [Zenodo 4931348](https://zenodo.org/record/4931348), CC-BY-4.0) |
| `overlay_terrain_20m.png`, `overlay_thermal_inertia_20m.png` | Colour overlays of the two layers above | Same |
| `pois.json` | Landing site, Ingenuity's airfield, descent stage, parachute and backshell, heat shield, 18 sample sites, Three Forks depot, 3 rover hiding spots (real positions on sols 420, 464 and 686, 2.4–2.8 km from landing), and the traverse up to sol 700 | NASA/JPL Mars 2020 waypoints and traverse (`mars.nasa.gov/mmgis-maps/M20`); [sample list](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/); [HiRISE ESP_068294_1985](https://www.uahirise.org/ESP_068294_1985) for the hardware |
| `weather.json` | 118 sols: hourly pressure, air, ground and sky temperature, wind and long-wave flux | Perseverance MEDA, [PDS Atmospheres Node](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) (DER_PS, CAL_ATS, DER_WS, DER_TIRS) |
| `dust.json` | Daily dust optical depth for 1358 sols, plus every measurement of the January 2022 Jezero storm | Mastcam-Z solar imaging, M. Lemmon ([Mendeley 10.17632/gktjp9jptb.2](https://data.mendeley.com/datasets/gktjp9jptb/2), preliminary) |
| `sunlight.json` | Sunlight on flat ground (W/m²) by dust τ and sun elevation, including diffuse light | NASA TM-103623, Appelbaum & Flood 1990 ([NTRS](https://ntrs.nasa.gov/citations/19910005804)) |
| `relay.json` | When Perseverance can reach a relay orbiter: MRO, Odyssey, ESA's Trace Gas Orbiter and Mars Express, with node times, passes per sol and pass length, plus a simple daily window schedule for the game. MAVEN was lost in 2025 | NASA Mars Relay Network Handbook, [JPL D-71874 Release 4](https://assets.science.nasa.gov/content/dam/science/psd/mars/files/mars-relay-network/MRN%20Handbook_v4_final_URS_cleared.pdf) (April 2026); built by `tools/data/bake_extra.py` |
| `dustdevils.json` | Dust devils at Jezero: 4.9 per sol, expected number per LTST hour (peak 1.4/h at noon), share that carry dust, sizes, strongest event | All 309 MEDA vortex encounters in sols 15–89 (Jackson 2022, *PSJ* 3, 20, Table 1), scaled to the 415-sol rate of Hueso et al. 2023 (*JGR Planets* 128, e2022JE007516); built by `tools/data/bake_extra.py` |
| `reference.json` | Measured Jezero ranges and cited constants for the simulation | Computed from the files above, plus cited constants (NASA BVAD Rev 2, MEDA albedo and thermal inertia). Anything still `verify: true` is a working assumption |
| `photos/` | 17 rover photos for points of interest and 5 HiRISE hardware images; `photos/photos.json` lists the credits | NASA Mars 2020 raw images (NASA/JPL-Caltech, ASU for Mastcam-Z); HiRISE (NASA/JPL-Caltech/University of Arizona) |
| `content.json` | Supplies, rocket pieces and their scrap, the 7 builds (§4.1), the improvising rule, 12 history cards with sources, and the science target (Wildcat Ridge) | Amounts are design values to tune. History cards cite NASA/JPL pages. Built by `tools/data/bake_content.py` |
| `credits.json` | Credits screen text: 10 data sources with citations, image credits, fiction and AI notes, and chart label templates such as `Perseverance MEDA · air temperature · sol {sol} (archived)` | Built by `tools/data/bake_content.py` |
| `fieldManualPages` in `jezero_pack.json` | 5 field manual pages: the 4 manual builds plus a CO2 reference page | Rewritten with real sources; the AER-1 tank, rover beacon and radio bridge are labelled game fiction |
| `earth_apollo17.jpg` | Earth on the title screen (added by UI in PR #23) | NASA photo AS17-148-22727, taken by the Apollo 17 crew on December 7, 1972; credited in `credits.json` |
| `crashed_lander_aer1.jpg` | The fictional AER-1 lander | **AI-generated**, with a visible watermark. No longer shown in the app (the intro switched to real Perseverance photos in #38) |
| `fake.json` | The original team placeholder, restored | Not data |

## How things were measured

- **Sampling:** the elevation and photo mosaics were read straight from the USGS S3 bucket with HTTP range requests (`tools/data/remote_tiff.py`), then box-averaged onto the ground grid. The 1.8 GB and 7.4 GB source files were never downloaded whole.
- **Hardware positions:** read off the annotated HiRISE release image, then matched to the map using two craters as fixed points. Checked against the rover's own position, the error is about 20 m. Use ±40 m as the accuracy. The base photo predates landing (2013–2017 images), so the hardware itself is not visible in it.
- **Sample sites:** the rover's last localisation on or before each sample's sealing sol, so within tens of metres of the real spot.
- **Weather:** the hourly arrays are hourly means by Local True Solar Time. The daily summaries differ by quantity:
  - `pressurePa` is the lowest, mean and highest of all 1-second readings. On sol 313 the lowest reading is 583.5 Pa; the lowest hourly mean is 584.7 Pa. `pressureKPa` in `jezero_pack.json` is that all-readings mean.
  - `airTempC` is the min, mean and max of the hourly means. Air temperature is the mean of the five ATS sensors.
  - `windMS` is the mean and 99th percentile of all readings. Ground and sky temperatures are TIRS brightness temperatures, with ground emissivity 0.98 assumed. The 118 sols are sols 300–330 (the storm) plus one sol every 20 from sol 15 to 1755.
- **Dust:** the 630 nm channel, as the daily median. When a sol has no measurement, `tauFromSol` names the sol used instead.
- **Season (Ls):** every sol has its own Ls: from the Mastcam-Z record where that sol was measured, otherwise computed with Allison & McEwen 2000 (`tools/data/mars_ls.py`, within 0.2° of the record over 1359 sols). Before November 14, sols with borrowed dust also borrowed the other sol's Ls (up to 23° off on sol 1755). The five scenario sols in `jezero_pack.json` carry `ls` too, so the game needs only the pack for the sun.
- **Sunlight:** the NASA polynomial f(z, τ, albedo) matches the report's own Table I with 0.4% average error (4% worst case). The ground albedo is 0.12, Perseverance MEDA's mean along the traverse (Martínez et al. 2023, *JGR Planets* 128, e2022JE007537; noon values 0.10–0.16, orbital TES ~0.15). It replaced a 0.17 working value; the change lowers sunlight by under 1% at normal dust levels.
- **Terrain class:** design thresholds, to tune in playtesting:
  - Loose sand likely where thermal inertia < 200. Loose particulate material is below ~350, and Gale's active dunes measure 200–310 from orbit (Edwards et al. 2018, *JGR Planets*, doi:10.1029/2017JE005501). MEDA measured 180 on a Jezero sand dune and 605 on bedrock (Martínez et al. 2023). So 200 picks the loosest material. About a third of the map's 20 m cells fall below it; THEMIS pixels are 100 m, so each value mixes sand and rock.
  - Rocky where roughness is in the top 15%.
  - Steep above 25°, cliff above 35°.

## Caveats the team should know

1. **Wind:** during the January 2022 dust storm, a dust devil passed close to the rover on sol 313 at 13:42 LTST, and its gust damaged one wind sensor boom (WS2). The other boom (WS1) was damaged on sol 315; camera images suggest lifted dust hit the sensor wires (Viúdez-Moreiras et al. 2022, *JGR Planets*, [doi:10.1029/2022JE007522](https://doi.org/10.1029/2022JE007522); Lemmon et al. 2022, *GRL* 49, e2022GL100126; Hueso et al. 2023). So the storm and the dust devil are the same event, not two explanations. Valid wind ends at 13:42 LTST on sol 313; before that, single readings reached 22.5 m/s (the 99th percentile in `weather.json` is 12.5 m/s; Lemmon et al. report winds up to 20 m/s). There is no wind after sol 313. In `jezero_pack.json`, the scenario sols after that (316, 319, 1695) use 3.3 m/s, the median daily mean wind of the 27 measured sols (55–313), and each sol's `notes` says so. In `weather.json`, `windMS` stays `null` on those sols.
2. **Real Jezero storms are weaker than the game's:** the January 2022 regional storm peaked at τ = 1.38 (sol 316). The storm sim's default `peakTau = 8` comes from Opportunity's 2018 global storm (τ 10.8). Use the real Jezero curve, or say on screen that the storm is a stronger, fictional one.
3. **Pressure:** Jezero's daily mean pressure in the sample was 587–797 Pa. The proposal's guess of 0.7–0.9 kPa was too high, so use MEDA values.
4. **Rock chemistry:** the Máaz and Séítah oxide values in `rockFormations` are SuperCam unit means from Wiens et al. 2022 (*Science Advances* 8, eabo3399, Table 1). The delta and regolith entries carry no oxide values, because none were checked against a publication. The regolith ISRU numbers come from other landing sites, not Jezero:
   - **Water, 2 wt%:** Curiosity's SAM measured 1.5–3 wt% in heated Gale soil, released in a broad peak near 300 °C (Leshin et al. 2013, *Science* 341, 1238937). The 350 °C bake temperature is a game value just past that peak.
   - **Perchlorate, 0.5 wt%:** Phoenix measured 0.4–0.6 wt% (Hecht et al. 2009, *Science* 325, 64–67); Curiosity's Rocknest soil was comparable.
   - **Chlorine hazard:** heating released chlorinated compounds and HCl along with oxygen (Leshin et al. 2013; Glavin et al. 2013, *JGR Planets* 118, 1955–1973).
5. **Fiction:** `crashedLander`, `scatteredSupplies` and `fieldManualPages` are game fiction, and the game should label them so they are not mistaken for NASA data.
6. **Relay windows are simplified:** the node times and pass lengths are from the handbook, but the game's one-pass-per-window schedule is a design choice. Node times are LMST; the game clock is LTST, up to about 50 minutes different over the year. TGO's pass times drift, so it is listed without a fixed time.
7. **Dust devil hours** are counts of real encounters by hour. They are not divided by how long MEDA recorded in each hour, but the scaled noon rate (1.43/h) matches the paper's normalised 1.5 ± 0.2.
8. **Not used yet:**
   - PSG: replaced by the NASA TM-103623 sunlight model, which includes diffuse light.
   - CRISM mineral maps, DONKI space weather and Mars audio: stretch goals.
9. **Life support rates** in `reference.json` are checked against NASA's BVAD Rev 2 (NASA/TP-2015-218570/REV2, 2022): 0.84 kg O₂ and 1.01 kg CO₂ per day (Table 3-23), and 2.0 kg drinking water plus 0.5 kg for food preparation (Tables 3-31 and 4-20).

## Rebuilding

The scripts are in `tools/data/`. They expect a separate workspace with `raw/`, `work/` and a Python venv (numpy, scipy, pillow, tifffile, imagecodecs, requests). The raw downloads (~250 MB) are kept out of git. The order:

1. `bake_terrain.py`
2. `fetch_meda.py`
3. `fetch_photos.py`
4. `bake_pack.py`
5. `bake_final.py`
6. `bake_content.py` (content, credits, manual pages, rock formations)
7. `bake_patch.py WORK REPO` (2 m tile; needs `work/terrain/elevation_2m.npy` from step 1)
8. `bake_extra.py VORTEX_PDF REPO` (relay and dust devils; the PDF is arXiv 2109.04601)

Parts of the data pipeline were written with help from Claude (an AI assistant). The original pack, story content and lander image were made with Antigravity (another AI agent).
