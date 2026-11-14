import type { Forecast, SuitState } from '../sim/types';
import { formatMinutes } from './hudFormat';
import {
  BREATHE_HARDER_WHY, CAUSES, PIECES, SLOW_PACE, SOL1_START_LIOH_KG, canSwap, phaseMinLeft,
  type ActionId, type CauseId, type Sol1State,
} from './sol1';

interface Props {
  mission: Sol1State;
  suit: SuitState;
  fc: Forecast;
  metabolicW: number;
  clockMin: number;
  onBegin: () => void;
  onDiagnose: (c: CauseId) => void;
  onAct: (a: ActionId) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** The Sol 1 scenario's cards in the visor centre: briefing, alarm, diagnosis, recovery and outcome. */
export function Sol1Panel({ mission: m, suit, fc, metabolicW, clockMin, onBegin, onDiagnose, onAct, onRetry, onClose }: Props) {
  if (m.phase === 'briefing') {
    return (
      <section className="mission-card" aria-label="Sol 1 briefing">
        <h2>SOL 1 · SCRUBBER SATURATION</h2>
        <p>The crash left your CO₂ scrubber canister partly used: about {SOL1_START_LIOH_KG * 1000} g of LiOH, roughly 2 hours of walking.</p>
        <p><strong>Goal:</strong> salvage 3 pieces from the debris field ({PIECES.map((p) => p.name.toLowerCase()).join(', ')}), then get back to the cabin alive.</p>
        <p className="dim">Watch the SCRUBBER gauge. On Mars the danger is your own breath.</p>
        <button className="choice-btn" onClick={onBegin}>BEGIN SALVAGE</button>
      </section>
    );
  }

  if (m.phase === 'won' || m.phase === 'survived' || m.phase === 'lost') {
    const cause = CAUSES.find((c) => c.id === m.diagnosis);
    const title = m.phase === 'won' ? 'MISSION COMPLETE' : m.phase === 'survived' ? 'BACK ALIVE' : 'MISSION FAILED';
    return (
      <section className="mission-card" aria-label="Sol 1 outcome">
        <h2 className={m.phase === 'lost' ? 'critical' : undefined}>{title}</h2>
        {m.lostReason && <p className="critical">{m.lostReason}</p>}
        <dl>
          <dt>Salvaged</dt><dd>{m.piecesSalvaged} / {PIECES.length}</dd>
          <dt>Time out</dt><dd>{formatMinutes(clockMin - m.startClockMin)}</dd>
          <dt>Diagnosis</dt><dd>{cause ? (cause.correct ? 'Correct' : `Wrong (${cause.label.toLowerCase()})`) : 'No alarm'}</dd>
          <dt>Spare canister</dt><dd>{m.spareUsed ? 'Used' : 'Not used'}</dd>
          <dt>O₂ left</dt><dd>{(suit.o2Kg * 1000).toFixed(0)} g</dd>
        </dl>
        {m.trapPicked && <p className="warning">You tried breathing harder. {BREATHE_HARDER_WHY}</p>}
        <p className="dim">Lesson: when the scrubber runs low, slow down and swap the canister. Breathing harder makes it worse.</p>
        <div className="mission-actions">
          <button className="choice-btn" onClick={onRetry}>TRY AGAIN</button>
          <button className="choice-btn" onClick={onClose}>CLOSE</button>
        </div>
      </section>
    );
  }

  const actions = (
    <div className="mission-actions" role="group" aria-label="Recovery actions">
      <button className="choice-btn" aria-pressed={m.slow} onClick={() => onAct('slow')}>{m.slow ? 'RESUME NORMAL PACE' : 'SLOW DOWN'}</button>
      <button className="choice-btn" onClick={() => onAct('swap')} disabled={!canSwap(m)}>
        {m.spareUsed ? 'SPARE USED' : canSwap(m) ? 'SWAP CANISTER' : 'SWAP CANISTER (NO SPARE YET)'}
      </button>
      <button className="choice-btn" onClick={() => onAct('abort')} disabled={m.phase === 'walkBack'}>ABORT TO CABIN</button>
      {m.alarm === 'recover' && <button className="choice-btn" onClick={() => onAct('breathe')}>BREATHE HARDER</button>}
    </div>
  );

  if (m.alarm === 'diagnose') {
    return (
      <section className="mission-card alarm" aria-label="Scrubber alarm">
        <h2 className="warning">▲ CO₂ SCRUBBER ALARM · CLOCK HELD</h2>
        <p>What is going on? Read the telemetry, then pick the cause.</p>
        <dl>
          <dt>LiOH left</dt><dd>{(suit.liohKg * 1000).toFixed(0)} g</dd>
          <dt>Scrubber out in</dt><dd>{formatMinutes(fc.scrubberMin)}</dd>
          <dt>Inspired pCO₂</dt><dd>{suit.inspiredPCO2KPa.toFixed(2)} kPa</dd>
          <dt>Fan current</dt><dd>Nominal</dd>
          <dt>Metabolic rate</dt><dd>{Math.round(metabolicW)} W</dd>
        </dl>
        <div className="mission-actions">
          {CAUSES.map((c) => <button key={c.id} className="choice-btn" onClick={() => onDiagnose(c.id)}>{c.label}</button>)}
        </div>
      </section>
    );
  }

  if (m.alarm === 'recover') {
    const cause = CAUSES.find((c) => c.id === m.diagnosis);
    return (
      <section className="mission-card alarm" aria-label="Recovery">
        <h2 className="warning">▲ RECOVER · CLOCK HELD</h2>
        {cause && <p className={cause.correct ? undefined : 'warning'}>{cause.why}</p>}
        {m.trapPicked && <p className="warning">{BREATHE_HARDER_WHY}</p>}
        <p className="dim">Pick what to do. The clock resumes when you slow down, swap or abort.</p>
        {actions}
      </section>
    );
  }

  const where = m.phase === 'walkOut' ? 'WALKING TO DEBRIS FIELD'
    : m.phase === 'salvage' ? `SALVAGING ${m.piecesSalvaged + 1}/${PIECES.length}: ${PIECES[m.piecesSalvaged].name.toUpperCase()}`
    : `WALKING BACK WITH ${m.piecesSalvaged}/${PIECES.length}`;
  return (
    <section className="mission-status" aria-label="Sol 1 progress">
      <p>{where} · {formatMinutes(phaseMinLeft(m) / (m.slow ? SLOW_PACE : 1))} LEFT{m.slow ? ' · SLOW PACE' : ''}</p>
      {m.alarm === 'done' && actions}
    </section>
  );
}
