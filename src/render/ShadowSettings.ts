import type { SaveBackend } from '../core/SaveBackend';
import { setShadowsEnabled } from './ShadowLayer';

/** Sparad grafikflagga. Samma mönster som volymens vol/mute. Standard på. */
export const SHADOW_SETTING_KEY = 'shadows';

export class ShadowSettings {
  private on = true;
  private backend: SaveBackend | null = null;
  private readonly listeners = new Set<() => void>();

  /** Läser `shadows` (`1`/`0`). Saknas nyckeln är skuggorna på. */
  async bind(backend: SaveBackend): Promise<void> {
    this.backend = backend;
    const v = await backend.getSetting(SHADOW_SETTING_KEY);
    if (v === '0') this.on = false;
    else if (v === '1') this.on = true;
    setShadowsEnabled(this.on);
    this.changed();
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    void this.backend?.setSetting(SHADOW_SETTING_KEY, on ? '1' : '0');
    setShadowsEnabled(on);
    this.changed();
  }

  toggle(): boolean {
    this.setEnabled(!this.on);
    return this.on;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
