export interface Orbit {
  /** Semi-axes of the orbit ellipse, in vmin. */
  rx: number;
  ry: number;
  /** Tilt of the orbit, degrees. */
  tiltDeg: number;
  /** Seconds per orbit. */
  periodS: number;
  /** Starting angle, 0–1 of a turn. */
  phase: number;
}

/** Points around a tilted ellipse, with depth: near side above Earth (z 3), far side behind it (z 0) and dimmer. */
export function orbitKeyframes(o: Orbit, vminPx: number, steps = 48): Keyframe[] {
  const tilt = (o.tiltDeg * Math.PI) / 180;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = 2 * Math.PI * (o.phase + i / steps);
    const x0 = Math.cos(a) * o.rx * vminPx;
    const y0 = Math.sin(a) * o.ry * vminPx;
    const x = x0 * Math.cos(tilt) - y0 * Math.sin(tilt);
    const y = x0 * Math.sin(tilt) + y0 * Math.cos(tilt);
    const near = Math.sin(a) >= 0; // lower half of the ellipse faces the viewer
    const scale = 0.75 + 0.25 * Math.sin(a); // farther = smaller
    frames.push({
      offset: i / steps,
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`,
      zIndex: near ? 3 : 0,
      opacity: near ? 1 : 0.55,
    });
  }
  return frames;
}
