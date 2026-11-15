// Where the planets are on a given date, for the title screen's solar system (Map/Aiman). Simple and approximate:
// each planet moves at its mean rate on a circular orbit, from its mean longitude at J2000 (1 Jan 2000, 12:00 TT).
// Mean elements: JPL "Keplerian Elements for Approximate Positions of the Major Planets" (Standish), table 1.
// Good to several degrees (Mars' orbit is quite elliptical), which is plenty for a picture and a rough radio delay.

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;
/** Seconds light takes to cross one astronomical unit. */
export const LIGHT_S_PER_AU = 499.005;
export const KM_PER_AU = 149_597_871;

/** Semi-major axis (AU), mean longitude at J2000 (deg) and orbital period (days). */
export const ELEMENTS: Record<string, { a: number; L0: number; periodD: number }> = {
  Mercury: { a: 0.387, L0: 252.25, periodD: 87.97 },
  Venus: { a: 0.723, L0: 181.98, periodD: 224.70 },
  Earth: { a: 1.0, L0: 100.46, periodD: 365.256 },
  Mars: { a: 1.524, L0: 355.45, periodD: 686.98 },
  Jupiter: { a: 5.203, L0: 34.40, periodD: 4332.59 },
  Saturn: { a: 9.537, L0: 49.95, periodD: 10759.2 },
  Uranus: { a: 19.19, L0: 313.23, periodD: 30685.4 },
  Neptune: { a: 30.07, L0: 304.88, periodD: 60189 },
};

export const daysSinceJ2000 = (ms: number) => (ms - J2000_MS) / DAY_MS;

/** Heliocentric mean longitude in radians (0..2π) on day `d` after J2000. */
export function meanLongitude(name: string, d: number): number {
  const e = ELEMENTS[name];
  const deg = e.L0 + (360 / e.periodD) * d;
  const r = ((deg % 360) + 360) % 360;
  return (r * Math.PI) / 180;
}

/** Earth–Mars distance (AU) and one-way radio delay (minutes) on day `d` after J2000, circular orbits. */
export function earthMars(d: number): { au: number; km: number; lightMin: number } {
  const a1 = ELEMENTS.Earth.a, a2 = ELEMENTS.Mars.a;
  const dl = meanLongitude('Mars', d) - meanLongitude('Earth', d);
  const au = Math.sqrt(a1 * a1 + a2 * a2 - 2 * a1 * a2 * Math.cos(dl));
  return { au, km: au * KM_PER_AU, lightMin: (au * LIGHT_S_PER_AU) / 60 };
}
