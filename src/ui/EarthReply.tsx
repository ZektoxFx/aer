// Earth's reply after the light delay (Map/Aiman, story work with UI's OK). On the won end card: the distress call
// crosses to Earth at the speed of light, the Deep Space Network hears it, and Mission Control's reply crosses back.
// The delay is today's real Earth–Mars distance (heliocentric.ts, the same as the title screen), shown sped up.
// The reply's wording and the rescue are game fiction.
import { useEffect, useRef, useState } from 'react';
import { daysSinceJ2000, earthMars } from './heliocentric';

/** Real seconds per light-minute on screen (one way of ~9 min plays in about 4 s, so it ends before the credits). */
const S_PER_MIN = 0.45;

const mmss = (min: number) => `${Math.floor(min)}:${String(Math.floor((min % 1) * 60)).padStart(2, '0')}`;

export function EarthReply({ orbiter }: { orbiter: string }) {
  const [link] = useState(() => earthMars(daysSinceJ2000(Date.now())));
  const [stage, setStage] = useState<0 | 1 | 2>(0); // 0 going out, 1 heard on Earth (reply on its way), 2 reply received
  const dot = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const one = link.lightMin;
    let raf = 0, t0 = 0, shown = -1;
    const frame = (ms: number) => {
      if (!t0) t0 = ms;
      const min = Math.min(2 * one, (ms - t0) / 1000 / S_PER_MIN);
      // The dot runs Mars → Earth, then back with the reply.
      const f = min <= one ? min / one : 2 - min / one;
      if (dot.current) { dot.current.style.left = `${(f * 100).toFixed(2)}%`; dot.current.dataset.back = min > one ? '1' : '0'; }
      if (clock.current) clock.current.textContent = `T+${mmss(min)}`;
      const st = min >= 2 * one ? 2 : min >= one ? 1 : 0;
      if (st !== shown) { shown = st; setStage(st); }
      if (min < 2 * one) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [link]);

  return (
    <div className="earth-reply" aria-live="polite">
      <p className="earth-reply-head">
        RADIO LINK · MARS ↔ EARTH <span ref={clock}>T+0:00</span>
      </p>
      <div className="earth-reply-track">
        <i className="er-mars" />
        <span ref={dot} className="er-dot" />
        <i className="er-earth" />
      </div>
      <p className="earth-reply-dist">
        {link.lightMin.toFixed(1)} light-minutes apart today ({Math.round(link.km / 1e6)} million km) · shown sped up
      </p>
      <ol className="earth-reply-log">
        <li data-on="1"><b>T+0:00</b> Call sent from Perseverance through {orbiter}</li>
        <li data-on={stage >= 1 ? '1' : '0'}><b>T+{mmss(link.lightMin)}</b> Heard by NASA's Deep Space Network on Earth</li>
        <li data-on={stage >= 2 ? '1' : '0'} className="er-reply">
          <b>T+{mmss(2 * link.lightMin)}</b> Reply: "AER-1, Mission Control. We hear you. A cargo lander is being re-targeted to Jezero.
          Stay with Perseverance and save your oxygen." <em>(game fiction)</em>
        </li>
      </ol>
    </div>
  );
}
