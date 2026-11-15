// LOCAL DRAFT (Aiman): numbers for the intro's cabin scene (CabinCruise.tsx), kept pure so they can be tested.
// The cruise is a time-lapse of a real Earth→Mars transfer: Perseverance flew 203 days (30 Jul 2020 – 18 Feb 2021)
// and about 472 million km; at landing a radio signal took about 11 min 22 s to reach Earth (≈204 million km).
// Its cruise stage spun at about 2 rpm to stay stable. AER-1 itself is fictional.

export const CRUISE = { days: 203, pathKm: 472e6, earthKmAtArrival: 204e6, rpm: 2, entryKm: 15_000 };
const C_KM_S = 299_792.458;

/** Seconds of the scene: the time-lapse, then the alarm. */
export const CABIN_S = { lapse: 8.0, alarm: 2.0 };
export const CABIN_MS = Math.round((CABIN_S.lapse + CABIN_S.alarm) * 1000);

export interface CruiseState {
  /** Mission day, 1 → 203. */
  day: number;
  travelledKm: number;
  /** Distance left to Mars' centre (km). */
  marsKm: number;
  /** One-way radio delay to Earth (minutes). */
  signalMin: number;
  /** 0 → 1 as the master alarm comes on. */
  alarm: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const remainingAt = (day: number) => ((CRUISE.days - day) / CRUISE.days) * CRUISE.pathKm;

/**
 * State `T` seconds into the scene. The first 60% of the time-lapse runs the days at an even pace (Mars is still a
 * dot); the last 40% is the final approach on a log scale of distance, so Mars visibly grows in the window, ending
 * 15,000 km out, just before atmospheric entry.
 */
export function cruiseAt(T: number): CruiseState {
  const u = clamp01(T / CABIN_S.lapse);
  let day: number, marsKm: number;
  if (u < 0.6) {
    const e = u / 0.6;
    day = 1 + 199 * e;
    marsKm = remainingAt(day);
  } else {
    const f = (u - 0.6) / 0.4, r0 = remainingAt(200);
    marsKm = Math.exp(Math.log(r0) + (Math.log(CRUISE.entryKm) - Math.log(r0)) * f);
    day = CRUISE.days - (marsKm / CRUISE.pathKm) * CRUISE.days;
  }
  const earthKm = (CRUISE.earthKmAtArrival * day) / CRUISE.days;
  return {
    day, marsKm, travelledKm: CRUISE.pathKm - marsKm,
    signalMin: earthKm / C_KM_S / 60,
    alarm: clamp01((T - CABIN_S.lapse) / 0.15),
  };
}

/** Mars' apparent radius (radians) from `km` away from its centre. */
export function marsAngularRadius(km: number): number {
  return Math.asin(Math.min(1, 3_389.5 / Math.max(km, 3_389.5)));
}
