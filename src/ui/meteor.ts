// Timing for the meteor-strike shot, kept apart from MeteorStrike.tsx so the title screen can read it without
// loading three.js (#40: three.js stays out of the first download).

/** Seconds into the shot when the rock hits (the intro sound's bang is at 1.1 s into the meteor phase). */
export const IMPACT_S = 1.1;
/** Length of the shot. */
export const METEOR_MS = 3200;
