// What the player learns on finding Perseverance: real facts about the rover, and two real NASA images that are
// already bundled (public/data/photos, credited in photos.json and credits.json). Facts are from NASA's Mars 2020
// mission pages and the MOXIE results page cited in docs/SUBMISSION.md.

export interface RoverPhoto {
  src: string;
  caption: string;
  credit: string;
}

export const ROVER_PHOTOS: RoverPhoto[] = [
  {
    src: '/data/photos/percy-full-res.jpg',
    caption: 'Perseverance seen from orbit, three days after landing: the bright dot, with the blast marks of its landing around it.',
    credit: 'NASA/JPL-Caltech/University of Arizona · MRO HiRISE ESP_068294_1985, Feb 22 2021',
  },
  {
    src: '/data/photos/rochette_1.jpg',
    caption: "Seen by Perseverance: its own robotic arm and coring drill at the rock Rochette, where it took one of its first rock cores (sol 190).",
    credit: 'NASA/JPL-Caltech/ASU · Mastcam-Z, sol 190',
  },
];

export const ROVER_FACTS: string[] = [
  'Perseverance landed in Jezero Crater on 18 February 2021. It is about 3 m long and weighs about 1,025 kg, as much as a small car.',
  'It runs on an MMRTG: heat from decaying plutonium-238 makes about 110 W of electricity, day and night, dust storm or not. That is why it can keep your suit charged.',
  'It talks to Earth mostly through orbiters such as NASA\'s Mars Reconnaissance Orbiter, sending data up by UHF radio in short passes overhead.',
  'Its MOXIE experiment made 122 g of oxygen out of the Martian air between 2021 and 2023: a first test of making breathable oxygen on Mars.',
];

export const ROVER_SOURCES = 'Sources: NASA Mars 2020 Perseverance mission pages (science.nasa.gov); NASA MOXIE results.';
