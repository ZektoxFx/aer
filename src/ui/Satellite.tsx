import { useEffect, useRef } from 'react';
import { orbitKeyframes, type Orbit } from './orbit';

/** A small satellite drawn in SVG: gold-foil bus, blue solar wings, antenna. */
function SatelliteArt({ big }: { big?: boolean }) {
  const panel = (x: number) => (
    <g>
      <rect x={x} y="6" width="18" height="8" style={{ fill: 'var(--sat-panel)', stroke: 'var(--metal-dark)', strokeWidth: 0.4 }} />
      <path d={`M${x + 4.5} 6 V14 M${x + 9} 6 V14 M${x + 13.5} 6 V14 M${x} 10 H${x + 18}`} style={{ stroke: 'var(--metal-dark)', strokeWidth: 0.3 }} />
    </g>
  );
  if (big) {
    // A long-truss station silhouette: several wing pairs on a beam.
    return (
      <svg viewBox="0 0 80 20" width="124" height="31" aria-hidden="true">
        <rect x="2" y="9.4" width="76" height="1.2" style={{ fill: 'var(--metal)' }} />
        {panel(2)}{panel(20)}{panel(42)}{panel(60)}
        <rect x="34" y="5" width="12" height="10" rx="2" style={{ fill: 'var(--metal)', stroke: 'var(--metal-dark)', strokeWidth: 0.5 }} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 58 20" width="72" height="25" aria-hidden="true">
      <rect x="2" y="9.5" width="54" height="1" style={{ fill: 'var(--metal-dark)' }} />
      {panel(2)}{panel(38)}
      <rect x="22" y="4" width="14" height="12" style={{ fill: 'var(--mars-sky)', stroke: 'var(--mars-sand)', strokeWidth: 0.6 }} />
      <path d="M24 6 L34 14 M34 6 L24 14" style={{ stroke: 'var(--mars-sand)', strokeWidth: 0.4 }} />
      <path d="M29 4 V0 M26 0 Q29 3 32 0" style={{ stroke: 'var(--metal)', strokeWidth: 0.6, fill: 'none' }} />
    </svg>
  );
}

/** One satellite circling Earth's centre (its parent is positioned at that centre). */
export function Satellite({ orbit, big, still }: { orbit: Orbit; big?: boolean; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || still || typeof el.animate !== 'function') return;
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const anim = el.animate(orbitKeyframes(orbit, vmin), { duration: orbit.periodS * 1000, iterations: Infinity });
    return () => anim.cancel();
  }, [orbit, still]);
  return <div ref={ref} className={big ? 'satellite big' : 'satellite'}><SatelliteArt big={big} /></div>;
}
