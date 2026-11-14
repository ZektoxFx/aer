/** Player settings, remembered in this browser only (a per-viewer convenience). */
export interface Settings {
  /** START goes straight to the game. */
  skipIntro: boolean;
  /** Turn off the intro and interface animations. */
  reducedMotion: boolean;
  /** Scale the game interface up for readability. */
  largeText: boolean;
}

export const DEFAULT_SETTINGS: Settings = { skipIntro: false, reducedMotion: false, largeText: false };

const KEY = 'aer.settings.v1';

/** Read settings; anything missing, malformed or unreadable falls back to the defaults. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* private mode or blocked storage: keep it in memory only */ }
}

/** Browser storage if it can be reached (it can throw in private windows). */
export function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Keyboard controls on the HUD, shown in Settings. */
export const CONTROLS: { keys: string; action: string }[] = [
  { keys: 'W A S D', action: '3D: walk (arrow keys work too)' },
  { keys: 'Shift', action: '3D: run' },
  { keys: 'Q · E / drag', action: '3D: look around (scroll to zoom)' },
  { keys: 'Space', action: 'Pause / resume' },
  { keys: '1 · 2 · 3 · 4', action: '2D HUD: in cabin · rest · walk · run' },
  { keys: 'S · T · H · R', action: '2D HUD: Sol 1 · storm · skip hour · restart' },
];

/** HUD action for a key press, or null. */
export type HudKeyAction = 'pause' | 'mode:cabin' | 'mode:rest' | 'mode:walk' | 'mode:run' | 'sol1' | 'storm' | 'skip' | 'restart';
export function hudKeyAction(key: string): HudKeyAction | null {
  switch (key.toLowerCase()) {
    case ' ': return 'pause';
    case '1': return 'mode:cabin';
    case '2': return 'mode:rest';
    case '3': return 'mode:walk';
    case '4': return 'mode:run';
    case 's': return 'sol1';
    case 't': return 'storm';
    case 'h': return 'skip';
    case 'r': return 'restart';
    default: return null;
  }
}
