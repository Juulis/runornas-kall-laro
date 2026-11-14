import type { SaveBackend } from '../core/SaveBackend';
import { setDarknessMode, type DarknessMode } from './LightLayer';

/** Sparad natt. `normal` är den mörka natten. `light` är mild för den som tycker det är läskigt. */
export const DARKNESS_SETTING_KEY = 'darkness';

export class DarknessSettings {
  private mode: DarknessMode = 'normal';
  private backend: SaveBackend | null = null;
  private readonly listeners = new Set<() => void>();

  /** Läser `darkness` (`normal`/`light`). Saknas nyckeln är natten vanlig. */
  async bind(backend: SaveBackend): Promise<void> {
    this.backend = backend;
    const v = await backend.getSetting(DARKNESS_SETTING_KEY);
    if (v === 'light' || v === 'normal') this.mode = v;
    setDarknessMode(this.mode);
    this.changed();
  }

  get current(): DarknessMode {
    return this.mode;
  }

  setMode(mode: DarknessMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    void this.backend?.setSetting(DARKNESS_SETTING_KEY, mode);
    setDarknessMode(mode);
    this.changed();
  }

  toggle(): DarknessMode {
    this.setMode(this.mode === 'normal' ? 'light' : 'normal');
    return this.mode;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
