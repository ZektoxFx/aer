export interface StripChartProps {
  title: string;
  unit: string;
  /** [minute, value] samples, oldest first. */
  data: [number, number][];
  /** Fixed y range so the trace doesn't rescale as it moves. */
  min: number;
  max: number;
  /** Values past this line draw in the warning color. */
  warnAt?: number;
  /** true when low values are bad (O₂, battery), false when high values are (CO₂). */
  warnBelow?: boolean;
  digits?: number;
  /** Mission, instrument and sol, shown under every chart (team rule). */
  caption: string;
}

const W = 300;
const H = 90;

/** A scrolling telemetry trace drawn as SVG, in the console style. */
export function StripChart({ title, unit, data, min, max, warnAt, warnBelow = true, digits = 0, caption }: StripChartProps) {
  const t0 = data[0]?.[0] ?? 0;
  const t1 = data[data.length - 1]?.[0] ?? 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * H;
  const points = data.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const last = data[data.length - 1]?.[1];
  const bad = last !== undefined && warnAt !== undefined && (warnBelow ? last <= warnAt : last >= warnAt);

  return (
    <figure className="strip">
      <figcaption className="strip-head">
        <span>{title}</span>
        <span className={bad ? 'warning' : undefined}>
          {last === undefined ? '--' : last.toFixed(digits)} {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title} over time`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="strip-grid" x1={0} x2={W} y1={H * f} y2={H * f} />
        ))}
        {warnAt !== undefined && <line className="strip-limit" x1={0} x2={W} y1={y(warnAt)} y2={y(warnAt)} />}
        <polyline className={bad ? 'strip-trace warning' : 'strip-trace'} points={points} />
      </svg>
      <div className="strip-axis">
        <span>T+{t0} min</span>
        <span>T+{t1} min</span>
      </div>
      <p className="strip-caption">{caption}</p>
    </figure>
  );
}
