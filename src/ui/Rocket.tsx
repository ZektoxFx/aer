import { useId } from 'react';

/** A two-stage rocket with shaded metal, an engine bell and a glowing exhaust plume. Points up; 40 × 140 units. */
export function Rocket({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const metal = `metal-${id}`, cone = `cone-${id}`, bell = `bell-${id}`, plume = `plume-${id}`, glow = `glow-${id}`;
  return (
    <svg className={className} viewBox="0 0 40 140" aria-hidden="true">
      <defs>
        {/* Cylinder shading: dark edges, bright highlight left of centre. */}
        <linearGradient id={metal} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--metal-dark)' }} />
          <stop offset="0.35" style={{ stopColor: 'var(--metal)' }} />
          <stop offset="0.6" style={{ stopColor: 'var(--metal)' }} />
          <stop offset="1" style={{ stopColor: 'var(--metal-dark)' }} />
        </linearGradient>
        <linearGradient id={cone} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--mars-rust)' }} />
          <stop offset="0.4" style={{ stopColor: 'var(--mars-sand)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mars-shadow)' }} />
        </linearGradient>
        <linearGradient id={bell} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--space)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--metal-dark)' }} />
          <stop offset="1" style={{ stopColor: 'var(--space)' }} />
        </linearGradient>
        <linearGradient id={plume} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mars-dust)' }} />
          <stop offset="0.3" style={{ stopColor: 'var(--mars-sky)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mars-sand)', stopOpacity: 0 }} />
        </linearGradient>
        <filter id={glow} x="-100%" y="-20%" width="300%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* Exhaust: a soft glow under a bright core. */}
      <g className="rocket-flame">
        <path d="M13 104 Q20 150 27 104 Z" fill={`url(#${plume})`} filter={`url(#${glow})`} />
        <path d="M16 104 Q20 128 24 104 Z" fill={`url(#${plume})`} />
      </g>

      {/* Fins */}
      <path d="M11 80 L3 100 L3 104 L11 98 Z" style={{ fill: 'var(--mars-rust)' }} />
      <path d="M29 80 L37 100 L37 104 L29 98 Z" style={{ fill: 'var(--mars-shadow)' }} />

      {/* First stage */}
      <rect x="11" y="62" width="18" height="38" fill={`url(#${metal})`} />
      {/* Engine bell */}
      <path d="M14 100 L26 100 L28 106 L12 106 Z" fill={`url(#${bell})`} />
      {/* Interstage band */}
      <rect x="11" y="58" width="18" height="5" style={{ fill: 'var(--mars-shadow)' }} />
      {/* Second stage */}
      <rect x="12" y="30" width="16" height="28" fill={`url(#${metal})`} />
      <rect x="12" y="44" width="16" height="2" style={{ fill: 'var(--mars-sand)' }} />
      {/* Nose fairing */}
      <path d="M12 30 Q12 12 20 2 Q28 12 28 30 Z" fill={`url(#${cone})`} />
      {/* Window and panel lines */}
      <circle cx="20" cy="36" r="2.4" style={{ fill: 'var(--space)', stroke: 'var(--mars-sky)', strokeWidth: 0.8 }} />
      <path d="M11 75 H29 M11 88 H29" style={{ stroke: 'var(--metal-dark)', strokeWidth: 0.5 }} />

      {/* Smoke puffs (shown when the engine fails) */}
      <g className="rocket-smoke">
        <circle cx="20" cy="118" r="5" /><circle cx="14" cy="130" r="6" /><circle cx="25" cy="138" r="7" />
      </g>
    </svg>
  );
}
