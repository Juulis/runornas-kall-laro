import { Disposables } from '../core/Disposables';
import type { GameContext, GameModule } from '../core/GameContext';
import { isTypingTarget } from '../core/keys';
import { DarknessSettings } from '../render/DarknessSettings';
import { ShadowSettings } from '../render/ShadowSettings';
import type { SaveBackendSource } from '../save/SaveBackendSource';
import { DarknessWidget } from '../ui/DarknessWidget';
import { ShadowWidget } from '../ui/ShadowWidget';
import { AudioEngine } from './AudioEngine';
import { AudioEventBinder } from './AudioEventBinder';
import { SfxLibrary } from './SfxLibrary';
import { VolumeControl } from './VolumeControl';
import { VolumeWidget } from './VolumeWidget';

/** Ljudmodulen (issue #5): sätter ihop motor, bibliotek, volym, event-koppling, M-tangent och volymreglage. */
export class AudioModule implements GameModule {
  readonly volume = new VolumeControl();
  readonly shadows = new ShadowSettings();
  readonly darkness = new DarknessSettings();
  readonly engine: AudioEngine;
  private readonly d = new Disposables();
  private widget: VolumeWidget | null = null;
  private shadowWidget: ShadowWidget | null = null;
  private darknessWidget: DarknessWidget | null = null;
  private createdPlate = false;

  constructor(
    private readonly saves: SaveBackendSource,
    private readonly widgetHost: () => HTMLElement | null = () => document.getElementById('plate'),
    engine?: AudioEngine,
  ) {
    this.engine = engine ?? new AudioEngine(new SfxLibrary(), this.volume);
  }

  init(ctx: GameContext): void {
    void this.volume.bind(this.saves.backend);
    void this.shadows.bind(this.saves.backend);
    void this.darkness.bind(this.saves.backend);
    for (const off of new AudioEventBinder(this.engine).bind(ctx.bus)) this.d.add(off);
    const unlock = (): void => this.engine.unlock();
    for (const t of ['pointerdown', 'keydown', 'touchstart'] as const) this.d.listen(window, t, unlock, { capture: true, passive: true });
    this.d.listen(window, 'keydown', (e) => this.onKey(e));
    const host = this.ensureWidgetHost();
    if (host) {
      this.widget = new VolumeWidget(this.volume, {
        onInteract: unlock,
        onToggle: () => this.toggleMute(),
        onCommit: () => this.engine.play('click'),
      });
      this.widget.mount(host);
      this.shadowWidget = new ShadowWidget(this.shadows);
      this.shadowWidget.mount(host);
      this.darknessWidget = new DarknessWidget(this.darkness);
      this.darknessWidget.mount(host);
      this.d.add(
        ctx.bus.on('locale_changed', ({ locale }) => {
          this.shadowWidget?.setLocale(locale);
          this.darknessWidget?.setLocale(locale);
        }),
      );
    }
  }

  /** #plate i HUD:en. Saknas den skapas en så volym, skuggor och mörker sitter ihop. */
  private ensureWidgetHost(): HTMLElement | null {
    const found = this.widgetHost();
    if (found) return found;
    if (typeof document === 'undefined') return null;
    const plate = document.createElement('div');
    plate.id = 'plate';
    document.body.appendChild(plate);
    this.createdPlate = true;
    return plate;
  }

  toggleMute(): void {
    if (!this.volume.toggleMute()) this.engine.play('toggle');
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code !== 'KeyM' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    this.toggleMute();
  }

  dispose(): void {
    this.d.dispose();
    this.widget?.dispose();
    this.widget = null;
    this.shadowWidget?.dispose();
    this.shadowWidget = null;
    this.darknessWidget?.dispose();
    this.darknessWidget = null;
    if (this.createdPlate) {
      document.getElementById('plate')?.remove();
      this.createdPlate = false;
    }
    this.engine.dispose();
  }
}
