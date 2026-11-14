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
| `layers_20m.json` | Slope, roughness, thermal inertia and terrain class for each 20 m cell | HiRISE DTM; THEMIS thermal inertia (Edwards & Buz 2021, [Zenodo 4931348](https://zenodo.org/record/4931348), CC-BY-4.0) |
| `overlay_terrain_20m.png`, `overlay_thermal_inertia_20m.png` | Colour overlays of the two layers above | Same |
| `pois.json` | Landing site, Ingenuity's airfield, descent stage, parachute and backshell, heat shield, 18 sample sites, Three Forks depot, 3 rover hiding spots (real positions on sols 420, 464 and 686, 2.4–2.8 km from landing), and the traverse up to sol 700 | NASA/JPL Mars 2020 waypoints and traverse (`mars.nasa.gov/mmgis-maps/M20`); [sample list](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/); [HiRISE ESP_068294_1985](https://www.uahirise.org/ESP_068294_1985) for the hardware |
| `weather.json` | 118 sols: hourly pressure, air, ground and sky temperature, wind and long-wave flux | Perseverance MEDA, [PDS Atmospheres Node](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) (DER_PS, CAL_ATS, DER_WS, DER_TIRS) |
| `dust.json` | Daily dust optical depth for 1358 sols, plus every measurement of the January 2022 Jezero storm | Mastcam-Z solar imaging, M. Lemmon ([Mendeley 10.17632/gktjp9jptb.2](https://data.mendeley.com/datasets/gktjp9jptb/2), preliminary) |
| `sunlight.json` | Sunlight on flat ground (W/m²) by dust τ and sun elevation, including diffuse light | NASA TM-103623, Appelbaum & Flood 1990 ([NTRS](https://ntrs.nasa.gov/citations/19910005804)) |
| `reference.json` | Measured Jezero ranges and cited constants for the simulation | Computed from the files above, plus the proposal (flagged `verify`) |
| `photos/` | 17 rover photos for points of interest and 5 HiRISE hardware images; `photos/photos.json` lists the credits | NASA Mars 2020 raw images (NASA/JPL-Caltech, ASU for Mastcam-Z); HiRISE (NASA/JPL-Caltech/University of Arizona) |
| `crashed_lander_aer1.jpg` | The fictional AER-1 lander | **AI-generated**, with a visible watermark |
| `fake.json` | The original team placeholder, restored | Not data |

## How things were measured

- **Sampling:** the elevation and photo mosaics were read straight from the USGS S3 bucket with HTTP range requests (`tools/data/remote_tiff.py`), then box-averaged onto the ground grid. The 1.8 GB and 7.4 GB source files were never downloaded whole.
- **Hardware positions:** read off the annotated HiRISE release image, then matched to the map using two craters as fixed points. Checked against the rover's own position, the error is about 20 m. Use ±40 m as the accuracy. The base photo predates landing (2013–2017 images), so the hardware itself is not visible in it.
- **Sample sites:** the rover's last localisation on or before each sample's sealing sol, so within tens of metres of the real spot.
- **Weather:** hourly means by Local True Solar Time. Air temperature is the mean of the five ATS sensors. Ground and sky temperatures are TIRS brightness temperatures, with ground emissivity 0.98 assumed. The 118 sols are sols 300–330 (the storm) plus one sol every 20 from sol 15 to 1755.
- **Dust:** the 630 nm channel, as the daily median. When a sol has no measurement, `tauFromSol` names the sol used instead.
- **Sunlight:** the NASA polynomial f(z, τ, albedo) matches the report's own Table I with 0.4% average error (4% worst case). The albedo is set to 0.17 for Jezero `[verify]`.
- **Terrain class:** design thresholds, to tune in playtesting:
  - Loose sand likely where thermal inertia < 200 `[verify]`.
  - Rocky where roughness is in the top 15%.
  - Steep above 25°, cliff above 35°.

## Caveats the team should know

1. **Wind:** the MEDA wind sensor was damaged during the sol 313 storm, so there is no wind after sol 313. In `jezero_pack.json`, `windMS: 0` on those sols means *no data*, not calm air.
2. **Real Jezero storms are weaker than the game's:** the January 2022 regional storm peaked at τ = 1.38 (sol 316). The storm sim's default `peakTau = 8` comes from Opportunity's 2018 global storm (τ 10.8). Use the real Jezero curve, or say on screen that the storm is a stronger, fictional one.
3. **Pressure:** Jezero's daily mean pressure in the sample was 587–797 Pa. The proposal's guess of 0.7–0.9 kPa was too high, so use MEDA values.
4. **Rock chemistry:** the oxide percentages in `rockFormations` came from another AI agent and have not been checked against PIXL papers. Each description starts with `[verify]`.
5. **Fiction:** `crashedLander`, `scatteredSupplies` and `fieldManualPages` are game fiction, and the game should label them so they are not mistaken for NASA data.
6. **Not used yet:**
   - PSG: replaced by the NASA TM-103623 sunlight model, which includes diffuse light.
   - CRISM mineral maps, DONKI space weather and Mars audio: stretch goals.

## Rebuilding

The scripts are in `tools/data/`. They expect a separate workspace with `raw/`, `work/` and a Python venv (numpy, scipy, pillow, tifffile, imagecodecs, requests). The raw downloads (~250 MB) are kept out of git. The order:

1. `bake_terrain.py`
2. `fetch_meda.py`
3. `fetch_photos.py`
4. `bake_pack.py`
5. `bake_final.py`

Parts of the data pipeline were written with help from Claude (an AI assistant). The original pack, story content and lander image were made with Antigravity (another AI agent).
