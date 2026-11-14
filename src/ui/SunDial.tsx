import { compassPoint, dialPoint, type SunPosition } from './sun';

/**
 * The Sun's turn through the sol, as a dial beside the clock: the horizon across the middle (facing south, so it
 * rises on the left in the east and sets on the right in the west), day above, night below. The marker goes round
 * once per sol (24 h 39.6 min). Under it: the Sun's height and compass direction.
 */
export function SunDial({ sun, tau }: { sun: SunPosition; tau: number }) {
  const R = 19, C = 24;
  const p = dialPoint(sun.hour);
  const x = C + p.x * R, y = C - p.y * R;
  const up = sun.elevationDeg > 0;
  const hazy = tau > 3;
  const label = up ? `${Math.round(sun.elevationDeg)}° ${compassPoint(sun.azimuthDeg)}` : 'NIGHT';
  return (
    <figure className={up ? 'sun-dial' : 'sun-dial night'} aria-label={`Sun ${up ? `${Math.round(sun.elevationDeg)} degrees up in the ${compassPoint(sun.azimuthDeg)}` : 'below the horizon'}`}>
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <path className="sd-day" d={`M ${C - R} ${C} A ${R} ${R} 0 0 1 ${C + R} ${C} Z`} />
        <path className="sd-night" d={`M ${C - R} ${C} A ${R} ${R} 0 0 0 ${C + R} ${C} Z`} />
        <circle className="sd-ring" cx={C} cy={C} r={R} />
        <line className="sd-horizon" x1={C - R - 3} y1={C} x2={C + R + 3} y2={C} />
        <line className="sd-hand" x1={C} y1={C} x2={x} y2={y} />
        <circle className={hazy ? 'sd-sun hazy' : 'sd-sun'} cx={x} cy={y} r={up ? 4 : 3} />
        <text className="sd-cardinal" x={2} y={C - 3}>E</text>
        <text className="sd-cardinal" x={41} y={C - 3}>W</text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
