"""Write public/data/content.json (items, scrap, recipes, history cards, science target) and replace the
field manual pages in jezero_pack.json with checked versions.

Game numbers marked "design" are tuning values, not data. Facts in history cards and manual pages carry
their source. Usage: python bake_content.py REPO_DIR
"""
import json
import sys
from pathlib import Path

DESIGN = "design value: tune in playtesting"

MATERIALS = [
    {"id": "metal", "name": "Metal", "note": "Aluminium and titanium hull and frame pieces"},
    {"id": "fabric", "name": "Fabric", "note": "Parachute nylon and strap webbing"},
    {"id": "insulation", "name": "Insulation", "note": "Multi-layer thermal blanket"},
    {"id": "wiring", "name": "Wiring", "note": "Cable harness, connectors"},
    {"id": "electronics", "name": "Electronics", "note": "Circuit boards, radios, sensors"},
    {"id": "solarCells", "name": "Solar cells", "note": "Intact cells from a broken array"},
    {"id": "tankParts", "name": "Tank parts", "note": "Valves, lines, regulators, pressure vessels"},
]

# Essential supplies (§4.1): work as soon as found. Amounts are design values sized against the
# proposal's consumption rates (O2 ~35 g/h at 137 W average, ~100 g/h at 400 W; reference.json).
SUPPLIES = [
    {"id": "o2_bottle", "name": "O₂ bottle", "massKg": 2.0, "gives": {"o2Kg": 0.3},
     "note": "About 8.5 h of breathing at the daily-average work rate, 3 h at a hard walk", "values": DESIGN},
    {"id": "lioh_canister", "name": "LiOH canister", "massKg": 1.4, "gives": {"liohKg": 1.0},
     "note": "1 kg LiOH absorbs ~0.92 kg CO2 (2 LiOH + CO2 -> Li2CO3 + H2O): about 22 h at the daily-average work rate",
     "values": DESIGN},
    {"id": "water_pack", "name": "Water pack", "massKg": 2.1, "gives": {"waterKg": 2.0},
     "note": "Drinking and evaporator cooling water. Cooling a 400 W walk uses ~0.59 kg/h (proposal §4)", "values": DESIGN},
    {"id": "battery_pack", "name": "Battery pack", "massKg": 3.0, "gives": {"batteryWh": 500},
     "note": "~170 Wh/kg, typical of lithium-ion cells", "values": DESIGN},
    {"id": "repair_kit", "name": "Repair kit", "massKg": 1.0, "gives": {"repairs": 1},
     "note": "Fixes one suit or equipment fault", "values": DESIGN},
]

# Rocket pieces (§4.1): every piece breaks down into scrap. Masses are design values.
ROCKET_PIECES = [
    {"id": "hull_panel", "name": "Hull or fairing panel", "breakdownMin": 10, "yields": {"metal": 6}},
    {"id": "parachute_straps", "name": "Parachute and straps", "breakdownMin": 15, "yields": {"fabric": 5}},
    {"id": "thermal_blanket", "name": "Thermal blanket", "breakdownMin": 5, "yields": {"insulation": 3}},
    {"id": "wiring_harness", "name": "Wiring harness", "breakdownMin": 10, "yields": {"wiring": 2}},
    {"id": "avionics_box", "name": "Avionics box or antenna", "breakdownMin": 15, "yields": {"electronics": 2, "wiring": 0.5}},
    {"id": "solar_segment", "name": "Solar array segment", "breakdownMin": 10, "yields": {"solarCells": 2, "wiring": 0.5}},
    {"id": "tank_valves", "name": "Tank and valves", "breakdownMin": 20, "yields": {"tankParts": 4},
     "mayContain": {"o2Kg": [0, 0.5], "waterKg": [0, 1.0]}, "note": "Leftover gas or water inside is random within the range"},
]
for p in ROCKET_PIECES:
    p["values"] = DESIGN
    p["massKg"] = round(sum(p["yields"].values()), 1)

# Builds (§4.1). knowledge: "training" = astronaut can always build; "manual" = needs the page or improvising.
RECIPES = [
    {"id": "storm_shelter", "name": "Storm shelter", "needs": {"metal": 12, "fabric": 5}, "buildMin": 90,
     "knowledge": "training", "does": "Shelter anywhere: keeps gear out of the dust and cuts heat loss",
     "catch": "Heavy to carry (the materials weigh 17 kg) and slow to put up"},
    {"id": "insulation_wrap", "name": "Insulation wrap", "needs": {"insulation": 3, "fabric": 1}, "buildMin": 20,
     "knowledge": "training", "does": "Less heat loss at rest and at night",
     "catch": "Raises overheating risk while walking"},
    {"id": "cargo_sled", "name": "Cargo sled", "needs": {"metal": 6, "fabric": 2}, "buildMin": 40,
     "knowledge": "training", "does": "Carries more scrap",
     "catch": "Slopes cost more, and it bogs down in soft sand (terrainClass 2 in layers_20m.json)"},
    {"id": "solar_patch", "name": "Solar patch", "needs": {"solarCells": 2, "wiring": 1}, "buildMin": 30,
     "knowledge": "manual", "manualPage": 1, "does": "Extra charging at a site",
     "catch": "Weak in a storm and loses output as dust settles; clear it to restore power"},
    {"id": "oxygen_tap", "name": "Oxygen tap", "needs": {"tankParts": 2, "wiring": 1}, "buildMin": 45,
     "knowledge": "manual", "manualPage": 2, "does": "Recovers leftover liquid oxygen from a damaged tank as breathing O2",
     "catch": "Takes time, and only the oxygen left in that tank is recoverable"},
    {"id": "direction_finder", "name": "Direction finder", "needs": {"electronics": 1, "wiring": 1}, "buildMin": 30,
     "knowledge": "manual", "manualPage": 3, "does": "Gives a bearing to the rover's beacon",
     "catch": "Each ping costs battery (design: 5 Wh)"},
    {"id": "rover_comms_link", "name": "Rover comms link", "needs": {"electronics": 2, "wiring": 2}, "buildMin": 60,
     "knowledge": "manual_required", "manualPage": 4, "does": "Connects to the rover's radio to send the distress call",
     "catch": "Needed to win. Cannot be improvised without its manual page"},
]
for r in RECIPES:
    r["values"] = DESIGN
IMPROVISE = {"materialsMultiplier": 2, "timeMultiplier": 2, "failChance": 0.3,
             "rule": "Any manual build except the rover comms link can be improvised without its page. A success "
                     "counts as learned, so repeat builds use normal cost and time.", "values": DESIGN}

MANUAL_PAGES = [
    {
        "pageNumber": 1, "title": "Solar power in dust", "category": "Power", "unlocksRecipe": "solar_patch",
        "sciencePrinciple": "Dust in the air dims the direct beam of sunlight, but it scatters some light back down as "
        "a glowing sky, so panels still work under a dusty sky. At Jezero, overhead sun gives about 540 W/m² on flat "
        "ground at a normal dust level (tau 0.5) and about 430 W/m² at tau 1.5, close to the real January 2022 storm "
        "peak (tau 1.38). The bigger enemy is dust settling on the panel itself: output falls as a layer builds up. The "
        "Spirit and Opportunity rovers sometimes got their power back when wind gusts blew their panels clean.",
        "source": "NASA TM-103623, Appelbaum & Flood, 'Solar radiation on Mars: Update 1990'; Perseverance Mastcam-Z "
                  "dust record (Lemmon). Values in public/data/sunlight.json and dust.json.",
        "diagram": "Sun ─► dust layer ─► direct beam (dims fast) + scattered sky light (stays) ─► panel ─► battery",
    },
    {
        "pageNumber": 2, "title": "Oxygen from a broken tank", "category": "Life support", "unlocksRecipe": "oxygen_tap",
        "sciencePrinciple": "The AER-1 lander burned liquid oxygen (fiction). Liquid oxygen boils at -183 °C at Earth "
        "sea-level pressure, and one litre of it becomes roughly 800-860 litres of gas at room temperature and 1 atm. "
        "Even a little liquid left in a cracked tank is a lot of breathing gas. Warm it slowly through a coil, then let "
        "a regulator drop it to suit pressure (about 30 kPa of pure oxygen). Warming too fast builds dangerous pressure "
        "in a closed line.",
        "source": "Physical properties of oxygen (NIST Chemistry WebBook). The AER-1 lander and its oxygen tank are "
                  "game fiction.",
        "diagram": "[Tank: liquid O2] ─► [Valve] ─► [Warming coil] ─► [Regulator ~30 kPa] ─► [Suit O2 port]",
    },
    {
        "pageNumber": 3, "title": "Finding a radio beacon", "category": "Navigation", "unlocksRecipe": "direction_finder",
        "sciencePrinciple": "Mars has no global magnetic field today, only patches of magnetised crust, so a compass "
        "will not point north. A loop antenna instead picks up a radio signal most weakly when its face points straight "
        "at the transmitter. Turn the loop until the signal fades to its quietest (the 'null'), and the beacon lies "
        "along that line. Take two bearings from different spots and the lines cross at the transmitter.",
        "source": "Mars Global Surveyor magnetometer results (Acuña et al., Science, 1999) for Mars' missing global "
                  "field. Radio direction finding is standard radio practice. The rover beacon is game fiction.",
        "diagram": "Bearing A ─╲      ╱─ Bearing B\n             ╲    ╱\n              [rover]",
    },
    {
        "pageNumber": 4, "title": "Calling Earth through Perseverance", "category": "Communications",
        "unlocksRecipe": "rover_comms_link",
        "sciencePrinciple": "Perseverance has three antennas. A UHF antenna (about 400 MHz) sends most of its data to "
        "orbiters passing overhead, at up to 2 megabits per second. Today these are NASA's Mars Reconnaissance Orbiter "
        "and Mars Odyssey and ESA's Trace Gas Orbiter (MAVEN, used early in the mission, was lost in 2025). Each pass "
        "lasts only about 10 to 17 minutes, so the rover can call out a few times a sol. The orbiters relay the data "
        "to NASA's Deep Space Network. A small X-band high-gain antenna can talk directly to "
        "Earth, but slowly, and is mostly used to receive each morning's commands. A low-gain antenna is the backup. "
        "The rover runs on a nuclear power source (about 110 W at the start of the mission), so it keeps working "
        "through dust storms. Radio takes about 3 to 22 minutes to cross between Mars and Earth, depending on where "
        "the planets are, so any reply comes back after a long wait.",
        "source": "NASA/JPL Mars 2020 landing press kit, Telecommunications "
                  "(jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/spacecraft/telecommunications); NASA Mars Relay "
                  "Network (science.nasa.gov/mars/mars-relay-network); Mars Relay Network Handbook, JPL D-71874 Release 4 (2026). Connecting a survivor's radio to the rover is game fiction.",
        "diagram": "[Your radio] ─UHF─► [Perseverance] ─UHF─► [Orbiter: MRO / Odyssey / TGO] ─X-band─► [Deep Space Network, Earth]",
    },
    {
        "pageNumber": 5, "title": "Why your own breath is the danger", "category": "Life support", "unlocksRecipe": "",
        "sciencePrinciple": "Every breath out adds carbon dioxide to the suit, and only the scrubber removes it. Lithium "
        "hydroxide grabs CO2 in the reaction 2 LiOH + CO2 -> Li2CO3 + H2O, using about 1.09 kg of LiOH for every kg of "
        "CO2. When the canister is used up, CO2 in the suit air rises. Breathing harder cannot fix that, because your "
        "lungs cannot push CO2 below the level in the air you breathe in. Slow down to make less CO2, and swap the "
        "canister. Reference page: unlocks no build.",
        "source": "Reaction stoichiometry (molar masses LiOH 23.95 g/mol, CO2 44.01 g/mol); proposal §1.2 and §3.1.",
        "diagram": "Breath out ─► CO2 ─► [LiOH canister] ─► clean gas ─► breath in",
    },
]

HISTORY = [
    {"poiId": "landing_site", "title": "Octavia E. Butler Landing",
     "text": "Perseverance touched down here on February 18, 2021, lowered on cables by its rocket-powered sky crane. "
             "NASA named the spot after Octavia E. Butler, the science-fiction author who grew up in Pasadena, home of "
             "JPL. The rover's first drives studied the Máaz crater-floor rocks around this point.",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/", "NASA/JPL Mars 2020 waypoints"]},
    {"poiId": "wright_brothers_field", "title": "Wright Brothers Field",
     "text": "On April 19, 2021 (sol 58), the Ingenuity helicopter lifted off here: the first powered, controlled "
             "flight on another planet. Under its solar panel it carried a stamp-sized piece of fabric from the Wright "
             "brothers' 1903 Flyer. Ingenuity went on to fly 72 times before rotor damage on its last flight, on "
             "January 18, 2024, grounded it.",
     "sources": ["https://www.nasa.gov/podcasts/on-a-mission/flying-with-ingenuity-the-mars-helicopter-s4e7/",
                 "https://www.space.com/ingenuity-mars-helicopter-final-resting-place-lord-of-the-rings-tolkein"]},
    {"poiId": "descent_stage", "title": "Sky crane crash site",
     "text": "After lowering Perseverance to the ground on nylon cords, the rocket-powered descent stage cut the "
             "cords and flew away so its crash would not hit the rover. It came down about 700 m to the north-west. "
             "The HiRISE camera on Mars Reconnaissance Orbiter photographed the V-shaped debris pattern days later.",
     "sources": ["https://www.uahirise.org/ESP_068294_1985"]},
    {"poiId": "parachute_backshell", "title": "Parachute and backshell",
     "text": "Perseverance's 21.5 m parachute opened at supersonic speed. Its red-and-white pattern hides two "
             "messages in binary code: 'Dare Mighty Things' and the GPS coordinates of JPL. Parachute and backshell "
             "landed together about 1.1 km west-north-west of the rover. Ingenuity photographed them from the air on "
             "its 26th flight, in April 2022.",
     "sources": ["https://www.nasa.gov/stem-content/mars-perseverance-parachute-coding-activity/",
                 "https://www.uahirise.org/ESP_068294_1985"]},
    {"poiId": "heat_shield", "title": "Heat shield impact",
     "text": "The heat shield took the heat of entry into the Martian atmosphere, then dropped away during descent. "
             "It struck the ground about 1.5 km east-north-east of the landing site, where HiRISE spotted its impact.",
     "sources": ["https://www.uahirise.org/ESP_068294_1985"]},
    {"poiId": "three_forks_depot", "title": "Three Forks Sample Depot",
     "text": "Between December 21, 2022 and January 28, 2023 (sols 653-690), Perseverance set down 10 sealed sample "
             "tubes on this flat ground near the base of the delta: the first sample depot on another planet. It is a "
             "backup cache, in case the samples the rover carries cannot be collected later.",
     "sources": ["https://www.jpl.nasa.gov/news/nasas-perseverance-rover-completes-mars-sample-depot/"]},
    {"poiId": "sample_01", "title": "Roubion: the sample that crumbled",
     "text": "Perseverance's first coring attempt, in August 2021, ground the rock to powder, and the tube sealed "
             "nothing but Martian air. The team learned the crater floor here is softer and more weathered than expected.",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"]},
    {"poiId": "sample_02", "title": "Rochette: the first rock core",
     "text": "Two weeks after Roubion, the rover cored the harder rock Rochette and sealed Montdenier, its first "
             "rock sample, on sol 194 (September 2021). It is volcanic rock that water later altered.",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"]},
    {"poiId": "sample_06", "title": "Séítah: rock from a cooling magma",
     "text": "Séítah's rocks are rich in olivine crystals that settled out of a thick, slowly cooling body of magma. "
             "The rover cored the rock Issole here (samples Robine and Malay).",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"]},
    {"poiId": "sample_10", "title": "Skinner Ridge: the first delta sample",
     "text": "At the foot of the ancient river delta, Perseverance cored its first sedimentary rock, Swift Run, in "
             "July 2022: rock laid down by water flowing into the lake that once filled Jezero.",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"]},
    {"poiId": "sample_12", "title": "Wildcat Ridge: organic molecules",
     "text": "Wildcat Ridge is mudstone laid down as a salty lake dried out. The rover's SHERLOC instrument found "
             "organic molecules called aromatics in it. These are not proof of life, since chemistry alone can make "
             "them, but this is the kind of place where life could once have been preserved. Sample Hazeltop was "
             "sealed in July 2022.",
     "sources": ["https://www.jpl.nasa.gov/news/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/"]},
    {"poiId": "sample_17", "title": "Observation Mountain: the first soil samples",
     "text": "In December 2022 the rover collected its first regolith (loose soil) samples here, Atmo Mountain and "
             "Crosswind Lake. Soil samples help future astronauts understand the dust and grit they will live in.",
     "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"]},
]

WIENS = ("SuperCam unit means, Wiens et al. 2022, 'Compositionally and density stratified igneous terrain in "
         "Jezero crater, Mars', Science Advances 8, eabo3399, Table 1 (open access, PMC9410274). Totals are below 100% "
         "because water and other light elements are not measured.")

# Rock units. Oxides only where a published table gives them; everything else is description.
ROCKS = [
    {
        "id": "formation-maaz", "name": "Máaz formation (crater-floor lava)", "type": "Igneous: basaltic to andesitic lava",
        "associatedTarget": "Roubion, Rochette (Guillaumes and Bellegarde abrasion patches)",
        "mineralogy": "Pyroxene and plagioclase feldspar with iron-titanium oxides, altered in places by water.",
        "elementsOxidesWtPercent": {"SiO2": 49.6, "TiO2": 0.57, "Al2O3": 9.4, "FeO": 18.4, "MgO": 2.7, "CaO": 5.1,
                                    "Na2O": 2.9, "K2O": 1.07},
        "description": "Iron-rich lava flows that cover the crater floor around the landing site, later altered by "
                       "water. Source: " + WIENS,
        "survivalApplication": "Hard, stable ground for walking (design note).",
    },
    {
        "id": "formation-seitah", "name": "Séítah formation (olivine cumulate)", "type": "Igneous: olivine cumulate",
        "associatedTarget": "Brac, Issole (Garde and Dourbes abrasion patches)",
        "mineralogy": "Mostly olivine crystals (about 40% in the published norm) with pyroxene; olivine about Fo55-63.",
        "elementsOxidesWtPercent": {"SiO2": 45.1, "TiO2": 0.24, "Al2O3": 4.1, "FeO": 23.0, "MgO": 21.4, "CaO": 3.8,
                                    "Na2O": 1.3, "K2O": 0.21},
        "description": "Olivine crystals that settled to the bottom of a thick, slowly cooling body of magma. Much "
                       "richer in magnesium than Máaz. Source: " + WIENS,
        "survivalApplication": "Rough, ridged ground with sand between the ridges: slow going (design note).",
    },
    {
        "id": "formation-delta", "name": "Western delta front", "type": "Sedimentary: lake and river deposits",
        "associatedTarget": "Skinner Ridge, Wildcat Ridge, Amalik, Hidden Harbor",
        "mineralogy": "Fine-grained sandstone and mudstone with salts. SHERLOC found aromatic organic molecules in "
                      "Wildcat Ridge.",
        "elementsOxidesWtPercent": {},
        "description": "Sediment carried by the river that once flowed into Lake Jezero. No bulk oxide values are "
                       "given here: none were checked against a publication. Source for the organics: NASA/JPL, Sept "
                       "2022 (jpl.nasa.gov/news/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain).",
        "survivalApplication": "The science target: see content.json scienceTarget.",
    },
    {
        "id": "formation-regolith", "name": "Regolith (loose soil and dust)", "type": "Wind-blown sand and dust",
        "associatedTarget": "Observation Mountain regolith samples (Atmo Mountain, Crosswind Lake)",
        "mineralogy": "Basaltic sand with fine iron-oxide dust and salts, including perchlorates.",
        "elementsOxidesWtPercent": {},
        "isruYields": {"extractableWaterWtPercent": 2.0, "bakingTempRequiredC": 350, "perchlorateContentWtPercent": 0.5,
                       "hazardWarning": "Heating perchlorate-bearing soil releases oxygen, HCl and chlorinated "
                                        "compounds that can contaminate the water. On Curiosity, chloromethanes "
                                        "came off mostly below 300 °C, together with the oxygen release that ended "
                                        "near 460 °C, so a 350 °C bake is already in this range (Leshin et al. 2013; "
                                        "Glavin et al. 2013, JGR Planets 118, 1955-1973). The 0.5 wt% "
                                        "perchlorate is the level Phoenix measured in polar soil (0.4-0.6 wt%, Hecht "
                                        "et al. 2009, Science 325, 64-67); Curiosity's Rocknest soil was comparable."},
        "description": "Loose soil that covers much of the crater floor. ISRU sources: Curiosity's SAM heated Gale "
                       "soil (Rocknest, < 150 um) to ~835 °C and it released 1.5-3 wt% water in a broad peak centred "
                       "near 300 °C (Leshin et al. 2013, Science 341, 1238937); the game uses 2 wt%, and 350 °C is a "
                       "game value just past that peak. These are Gale and Phoenix measurements, not Jezero ones; "
                       "Jezero's soil is similar wind-blown basaltic sand. No bulk oxide values are given.",
    },
]

CREDITS = {
    "heading": "Data and credits",
    "intro": "AER is built on archived NASA mission data. Nothing is live: all data was downloaded before the "
             "hackathon and bundled with the app.",
    "dataSources": [
        {"what": "Base map photo and terrain (elevation, slope, shaded relief)",
         "mission": "Mars Reconnaissance Orbiter", "instrument": "HiRISE",
         "product": "Mars 2020 Terrain Relative Navigation HiRISE DTM and orthomosaic",
         "provider": "USGS Astrogeology Science Center", "citation": "DOI 10.5066/P9REJ9JN",
         "credit": "NASA/JPL-Caltech/University of Arizona/USGS"},
        {"what": "Soft-ground layer (thermal inertia)", "mission": "Mars Odyssey", "instrument": "THEMIS",
         "product": "THEMIS-derived thermal inertia of Jezero crater", "provider": "Edwards & Buz 2021",
         "citation": "Zenodo, DOI 10.5281/zenodo.4931348, CC BY 4.0", "credit": "C. S. Edwards and J. Buz"},
        {"what": "Weather: pressure, air and ground temperature, wind", "mission": "Mars 2020 Perseverance",
         "instrument": "MEDA", "product": "mars2020_meda bundle (derived and calibrated)",
         "provider": "NASA Planetary Data System, Atmospheres Node", "citation": "pds-atmospheres.nmsu.edu",
         "credit": "NASA/JPL-Caltech/CAB(CSIC-INTA)"},
        {"what": "Dust in the air (optical depth)", "mission": "Mars 2020 Perseverance", "instrument": "Mastcam-Z",
         "product": "Mastcam-Z visible aerosol optical depth record (preliminary)", "provider": "M. T. Lemmon",
         "citation": "Mendeley Data, DOI 10.17632/gktjp9jptb.2", "credit": "NASA/JPL-Caltech/ASU/M. Lemmon"},
        {"what": "Sunlight reaching the ground", "mission": "-", "instrument": "-",
         "product": "Solar radiation on Mars: Update 1990 (NASA TM-103623)", "provider": "J. Appelbaum and D. J. Flood",
         "citation": "NASA Technical Reports Server 19910005804", "credit": "NASA"},
        {"what": "Rover route, waypoints and sample sites", "mission": "Mars 2020 Perseverance", "instrument": "-",
         "product": "Mars 2020 waypoints and traverse; Mars rock samples list", "provider": "NASA/JPL-Caltech",
         "citation": "mars.nasa.gov/mmgis-maps/M20; science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples",
         "credit": "NASA/JPL-Caltech"},
        {"what": "Rock compositions", "mission": "Mars 2020 Perseverance", "instrument": "SuperCam",
         "product": "Unit-average compositions", "provider": "Wiens et al. 2022",
         "citation": "Science Advances 8, eabo3399", "credit": "R. C. Wiens et al."},
        {"what": "Landing hardware positions", "mission": "Mars Reconnaissance Orbiter", "instrument": "HiRISE",
         "product": "ESP_068294_1985 annotated release", "provider": "University of Arizona HiRISE team",
         "citation": "uahirise.org/ESP_068294_1985", "credit": "NASA/JPL-Caltech/University of Arizona"},
        {"what": "Dust devils: how often and when", "mission": "Mars 2020 Perseverance", "instrument": "MEDA",
         "product": "Vortex encounters, sols 15-89 (309 events) and 415-sol rates",
         "provider": "B. Jackson 2022; R. Hueso et al. 2023",
         "citation": "Planetary Science Journal 3, 20; JGR Planets 128, e2022JE007516",
         "credit": "NASA/JPL-Caltech; MEDA team (CAB, Spain)"},
        {"what": "When the rover can reach an orbiter (relay passes)", "mission": "Mars Relay Network",
         "instrument": "UHF relay", "product": "Mars Relay Network Handbook, Release 4 (2026)",
         "provider": "NASA Mars Exploration Program / JPL", "citation": "JPL D-71874",
         "credit": "NASA/JPL-Caltech; ESA (Trace Gas Orbiter, Mars Express)"},
    ],
    "imageCredits": [
        "Rover photos (Navcam, Hazcam): NASA/JPL-Caltech",
        "Rover photos (Mastcam-Z): NASA/JPL-Caltech/ASU",
        "Orbital photos (HiRISE): NASA/JPL-Caltech/University of Arizona",
        "Earth on the title screen: NASA, Apollo 17 crew, photo AS17-148-22727 (December 7, 1972)",
        "Per-photo details: /data/photos/photos.json",
    ],
    # Sources and licences: tools/audio/bake_audio.py and public/audio/audio.json.
    "audioCredits": [
        "Mars wind: recorded by Perseverance's SuperCam microphone on sol 4 (22 February 2021), NASA/JPL-Caltech/LANL/CNES/CNRS/ISAE-Supaero. Levelled and looped for the game.",
        "Title and storm music (“Jezero” and “Haboob”): original, composed and synthesized in code for AER (tools/audio/compose.py, written with help from Claude). Voice, throat singing, drums and brass are all synthesized; no samples.",
        "Other music (CC0, OpenGameArt.org): Space Music: Out There by yd · Transmission (Dark Sci-Fi Audio Pack) by SRG774 · Ending Scene (orchestral version) by nene",
        "Other sound effects are synthesized in the browser; the radio voice is the browser's built-in speech.",
    ],
    "fiction": "The AER-1 lander, its crew, its supplies and tank, the rover's beacon and the radio bridge are game "
               "fiction. Perseverance, Ingenuity, the landing hardware, the sample sites and all data layers are real.",
    "aiDisclosure": [
        "The AER-1 lander image was generated with AI and carries a visible watermark.",
        "Parts of the code, the data pipeline and the game text were written with help from AI assistants "
        "(Claude and Antigravity). All data values come from the sources above, not from AI.",
    ],
    "noAffiliation": "AER is a NASA Space Apps Challenge 2026 entry. It is not endorsed by NASA and uses no NASA logos.",
    "chartLabels": {
        "pressure": "Perseverance MEDA · surface pressure · sol {sol} (archived)",
        "airTemp": "Perseverance MEDA · air temperature · sol {sol} (archived)",
        "groundTemp": "Perseverance MEDA/TIRS · ground temperature · sol {sol} (archived)",
        "wind": "Perseverance MEDA · wind speed · sol {sol} (archived)",
        "dust": "Perseverance Mastcam-Z · dust optical depth · sol {sol} (archived)",
        "sunlight": "Sunlight model: NASA TM-103623 · dust from Mastcam-Z, sol {sol}",
        "map": "Base map: MRO HiRISE (USGS Mars 2020 TRN mosaic)",
    },
}

SCIENCE_TARGET = {
    "poiId": "sample_12",
    "name": "Wildcat Ridge",
    "why": "Organic molecules found by SHERLOC in lake mudstone: the strongest science stop inside the map, and on "
           "the way from the crash site to the delta-front rover positions.",
    "alternatives": ["three_forks_depot", "sample_02"],
}


OLD_WIND_NOTE = " windMS=0 means no data (sensor damaged), not calm air."


def set_pack_ls(pack, weather):
    """Copy each scenario sol's Ls (Mars season) from weather.json, so the game needs only the pack for the sun.
    Placed right after `sol`. Asked for in issue #16."""
    ls = {x["sol"]: x["ls"] for x in weather["sols"]}
    for i, s in enumerate(pack["sols"]):
        rest = {k: v for k, v in s.items() if k not in ("sol", "ls")}
        pack["sols"][i] = {"sol": s["sol"], "ls": ls[s["sol"]], **rest}


def fill_missing_wind(pack, weather):
    """Scenario sols after the sol 313 storm have no wind data. A 0 would read as calm air in the UI and
    the suit sim, so fill with the median daily mean wind of the measured sols and say so in the note."""
    import statistics

    measured = [s for s in weather["sols"] if s.get("windMS")]
    median = round(statistics.median(s["windMS"][0] for s in measured), 1)
    first, last = min(s["sol"] for s in measured), max(s["sol"] for s in measured)
    for s in pack["sols"]:
        w = next((x for x in weather["sols"] if x["sol"] == s["sol"]), None)
        if w and not w.get("windMS"):
            s["windMS"] = median
            note = s.get("notes", "").replace(OLD_WIND_NOTE, "")
            fill = (f" No wind data this sol (MEDA wind sensor damaged on sol 313): windMS is the median daily mean "
                    f"wind of the {len(measured)} measured sols {first}-{last} ({median} m/s), not a measurement.")
            if "No wind data this sol" not in note:
                note += fill
            s["notes"] = note


def main(repo):
    out = Path(repo) / "public" / "data"
    pois = {p["id"]: p for p in json.loads((out / "pois.json").read_text(encoding="utf-8"))["pois"]}
    for h in HISTORY:
        assert h["poiId"] in pois, h["poiId"]
        h["photos"] = pois[h["poiId"]].get("photos", [])
    content = {
        "about": "Game content for AER. Supplies, scrap and recipes are design values (marked 'values'). History cards "
                 "and manual pages are factual except where they say 'game fiction'. Positions: pois.json.",
        "materials": MATERIALS,
        "supplies": SUPPLIES,
        "rocketPieces": ROCKET_PIECES,
        "recipes": RECIPES,
        "improvise": IMPROVISE,
        "historyCards": HISTORY,
        "scienceTarget": SCIENCE_TARGET,
    }
    (out / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=1), encoding="utf-8")

    (out / "credits.json").write_text(json.dumps(CREDITS, ensure_ascii=False, indent=1), encoding="utf-8")

    pack_path = out / "jezero_pack.json"
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    pack["fieldManualPages"] = MANUAL_PAGES
    pack["rockFormations"] = ROCKS
    weather = json.loads((out / "weather.json").read_text(encoding="utf-8"))
    fill_missing_wind(pack, weather)
    set_pack_ls(pack, weather)
    pack_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("content.json:", len(SUPPLIES), "supplies,", len(ROCKET_PIECES), "pieces,", len(RECIPES), "recipes,",
          len(HISTORY), "history cards; manual pages:", len(MANUAL_PAGES))


if __name__ == "__main__":
    main(sys.argv[1])
