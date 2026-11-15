import type { ContentFile } from '../data/files';
import type { MapItem, Pt } from '../map';
import { callStage, hasCommsLink } from './ending';
import { FINDINGS, type FindingId } from './findings';
import { SALVAGE, type Pack } from './inventory';
import type { MissionStep, RelayPass } from './mission';
import { REPAIRS, repairNeeds, type Repair, type Ship } from './ship';

/**
 * The quest guide: the mission card's current step, turned into ONE next action, the place to go for it, and why.
 * It answers "what do I do now, and where?" so the player is never left wandering. Pure: no React, no DOM.
 */
export interface QuestTarget { at: Pt; label: string }
export interface Quest {
  /** The mission step this belongs to ('journal' once the mission is done). */
  step: MissionStep['id'] | 'journal' | 'done';
  title: string;
  /** One line of story: why this matters. */
  why: string;
  /** The very next thing to do, as an order. */
  task: string;
  /** Where to go for it (null: nowhere in particular). */
  target: QuestTarget | null;
  /** What the current job needs, ticked when the player has it. */
  needs: { label: string; done: boolean }[];
}

export interface QuestInput {
  steps: MissionStep[];
  /** Everything lying in the world that can still be picked up or salvaged. */
  items: MapItem[];
  pack: Pack;
  ship: Ship;
  content?: ContentFile | null;
  base: Pt;
  me: Pt;
  suitJob: Repair;
  linkJob: Repair;
  rover: MapItem | null;
  linked: boolean;
  pass: RelayPass | null;
  fmtMin: (m: number) => string;
  /** Findings in the field journal, for the side quests after the mission. */
  found?: readonly FindingId[];
  /** All map items (the science target and Three Forks), for the side quests. */
  allItems?: MapItem[];
}

const WHY: Record<MissionStep['id'], string> = {
  crash: 'You survived the crash.',
  suit: 'The crash tore your suit. Until it is patched, it leaks 25% more oxygen.',
  ship: 'A repaired lander is your base: power recharges your suit, life support refills it.',
  page: "This field manual page shows how to repair Perseverance's radio.",
  link: "Build the kit that repairs Perseverance's radio, so it can call Earth.",
  rover: "NASA's Perseverance rover is parked about 2 km west. Its radio can still reach Earth.",
  call: "Orbiters passing overhead relay Perseverance's radio to Earth.",
};

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Distance (m) and compass direction from `me` to `at`. Map points: x east, y south. */
export function bearing(me: Pt, at: Pt): { m: number; dir: string; deg: number } {
  const dx = at.x - me.x, dy = at.y - me.y;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return { m: Math.hypot(dx, dy), dir: DIRS[Math.round(deg / 45) % 8], deg };
}

const nearest = (me: Pt, items: MapItem[], ok: (i: MapItem) => boolean) =>
  items.filter(ok).sort((a, b) => Math.hypot(a.at.x - me.x, a.at.y - me.y) - Math.hypot(b.at.x - me.x, b.at.y - me.y))[0] ?? null;

/** Scrap materials (kg) an item breaks down into, from content.json rocket pieces (or the salvage list). */
export function yieldsOf(item: MapItem, content?: ContentFile | null): Record<string, number> {
  if (item.id in SALVAGE) return SALVAGE[item.id].yields ?? {};
  const piece = content?.rocketPieces.find((p) => p.id === (item.contentId ?? item.id));
  return piece?.yields ?? {};
}

const at = (i: MapItem): QuestTarget => ({ at: i.at, label: i.label });
const lander = (base: Pt): QuestTarget => ({ at: base, label: 'Your lander' });

/** The next action for one repair or build job (and the jobs it waits on). */
function planJob(job: Repair, q: QuestInput, title: string, why: string, depth = 0): Quest {
  const { pack, ship, content, items, me, base } = q;
  const matName = (m: string) => content?.materials.find((x) => x.id === m)?.name ?? m;
  const partName = (id: string) => SALVAGE[id]?.name ?? id;
  const needs = repairNeeds(job, pack, ship, matName, partName).map((n) => ({ label: n.label, done: n.have }));
  const quest = (task: string, target: QuestTarget | null): Quest => ({ step: q.steps.find((s) => !s.done)?.id ?? 'done', title, why, task, target, needs });
  const owned = [...pack.entries, ...ship.stored];

  // A repair that must come first.
  const dep = (job.after ?? []).find((d) => !ship.repaired.includes(d));
  if (dep && depth < 3) {
    const first = REPAIRS.find((r) => r.id === dep)!;
    const sub = planJob(first, q, title, why, depth + 1);
    return { ...sub, task: `First, ${first.name.toLowerCase()}: ${sub.task.charAt(0).toLowerCase()}${sub.task.slice(1)}` };
  }
  if (job.tool && !owned.some((e) => !!e.repairs)) {
    const kit = nearest(me, items, (i) => i.kind === 'repair');
    return quest('Pick up a repair kit (you need its tools)', kit ? at(kit) : null);
  }
  if (job.page !== undefined && !owned.some((e) => e.kind === 'page' && e.page === job.page)) {
    const pg = nearest(me, items, (i) => i.kind === 'manual' && (i.contentId === String(job.page) || i.id === `page-${job.page}`));
    return quest(`Find field manual page ${job.page}`, pg ? at(pg) : null);
  }
  if (job.blueprint && !owned.some((e) => e.blueprint === job.blueprint)) {
    const bp = nearest(me, items, (i) => i.id === `blueprint:${job.blueprint}`);
    return quest('Pick up the blueprint', bp ? at(bp) : null);
  }
  for (const p of job.parts) {
    if (owned.some((e) => e.id === p)) continue;
    const site = items.find((i) => i.id === p);
    return quest(`Salvage the ${partName(p).toLowerCase()}${site ? ` at ${site.label}` : ''} (press F there)`, site ? at(site) : null);
  }
  // Materials: gather everything that is missing first, then store it all in one trip to the lander.
  let unstored = false;
  for (const [m, kg] of Object.entries(job.materials)) {
    const stored = ship.materials[m] ?? 0;
    if (stored + 1e-9 >= kg) continue;
    const carried = pack.entries.reduce((a, e) => a + (e.kind === 'scrap' ? e.yields?.[m] ?? 0 : 0), 0);
    if (stored + carried + 1e-9 >= kg) { unstored = true; continue; }
    const src = nearest(me, items, (i) => (yieldsOf(i, content)[m] ?? 0) > 0);
    return quest(`Pick up ${src ? src.label : 'scrap'} for ${matName(m).toLowerCase()}`, src ? at(src) : null);
  }
  if (unstored) return quest('Take your scrap into the lander: PACK → STORE EVERYTHING IN THE SHIP', lander(base));
  return quest(`At the lander, open PACK → REPAIRS and start "${job.name}"`, lander(base));
}

/** The quest for right now. */
export function currentQuest(q: QuestInput): Quest {
  const step = q.steps.find((s) => !s.done);
  if (!step) return sideQuest(q);
  const title = step.label;
  const why = WHY[step.id];
  const plain = (task: string, target: QuestTarget | null): Quest => ({ step: step.id, title, why, task, target, needs: [] });
  switch (step.id) {
    case 'suit':
      return planJob(q.suitJob, q, title, why);
    case 'ship': {
      const done = q.ship.repaired as string[];
      const next = REPAIRS.find((r) => !done.includes(r.id) && (r.after ?? []).every((d) => q.ship.repaired.includes(d)))
        ?? REPAIRS.find((r) => !done.includes(r.id))!;
      const plan = planJob(next, q, title, why);
      return { ...plan, title: `${title}: ${next.name.toLowerCase()}` };
    }
    case 'page': {
      const pg = q.items.find((i) => i.required);
      return plain(pg ? `Find ${pg.label.replace(/^Manual page/, 'manual page')}` : 'Find the manual page about the rover radio', pg ? at(pg) : null);
    }
    case 'link':
      return planJob(q.linkJob, q, title, why);
    case 'rover':
      return plain('Walk west to Perseverance', q.rover ? { at: q.rover.at, label: 'Perseverance (last seen area)' } : null);
    case 'call': {
      const rv = q.rover ? { at: q.rover.at, label: 'Perseverance' } : null;
      const stage = callStage(q.linked, hasCommsLink(q.pack), q.pass);
      if (stage === 'need-link') {
        if (q.ship.stored.some((e) => e.id === q.linkJob.id)) return plain('Take the radio repair kit from the lander: PACK → SHIP', lander(q.base));
        return planJob(q.linkJob, q, title, why);
      }
      if (stage === 'connect') return plain('Walk up to Perseverance and press F to fit the radio repair kit', rv);
      if (stage === 'wait') {
        return plain(q.pass ? `${q.pass.orbiter} passes overhead in ${q.fmtMin(q.pass.inMin)}: press F at Perseverance to wait for it` : 'Stay by Perseverance and wait for an orbiter pass', rv);
      }
      return plain(`${q.pass?.orbiter ?? 'An orbiter'} is overhead: press F at Perseverance to call Earth`, rv);
    }
    default:
      return sideQuest(q);
  }
}

/** After the call: the field journal's open findings, as side quests while help is on the way. */
function sideQuest(q: QuestInput): Quest {
  const have = q.found ?? [];
  const open = FINDINGS.find((f) => !have.includes(f.id));
  if (!open) return { step: 'done', title: 'Mission complete', why: 'Help is on the way, and your field journal is full.', task: 'Explore Jezero while you wait', target: null, needs: [] };
  const all = q.allItems ?? q.items;
  const place = open.id === 'lake' ? all.find((i) => i.kind === 'science') : open.id === 'cache' ? all.find((i) => i.id === 'three_forks_depot') : null;
  return {
    step: 'journal', title: `Field journal: ${open.title}`, why: 'While help is on the way, learn how people could live here.',
    task: open.how, target: place ? at(place) : null, needs: [],
  };
}
