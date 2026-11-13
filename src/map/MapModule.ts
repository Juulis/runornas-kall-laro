import { Disposables } from '../core/Disposables';
import type { GameContext, GameModule } from '../core/GameContext';
import type { SaveBackendSource } from '../save/SaveBackendSource';
import { FogOfWar } from './FogOfWar';
import { FogRepository } from './FogRepository';
import { GoalTracker } from './GoalTracker';
import { MapInput } from './MapInput';
import { MapModel } from './MapModel';
import { MapPainter } from './MapPainter';
import { MapView } from './MapView';
import { MiniMapView } from './MiniMapView';
import type { LocaleManager } from '../i18n/LocaleManager';

/**
 * Karta (issue #6): Tab-karta, minikarta, målmarkör och fog of war per hjälte-id.
 */
export class MapModule implements GameModule {
  static readonly SAVE_MS = 5000;
  private readonly fogRepo: FogRepository;
  private readonly d = new Disposables();
  private ctx: GameContext | null = null;
  private fog = new FogOfWar();
  private heroId: string | null = null;
  private open = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private views: { big: MapView; mini: MiniMapView } | null = null;
  private input: MapInput | null = null;

  constructor(
    saves: SaveBackendSource,
    private readonly i18n: LocaleManager,
    private readonly host: () => HTMLElement = () => document.body,
    private readonly animate = true,
  ) {
    this.fogRepo = new FogRepository(saves.backend);
  }

  get isOpen(): boolean {
    return this.open;
  }
  get fogOfWar(): FogOfWar {
    return this.fog;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const model = new MapModel(ctx.data, this.i18n);
    const goals = new GoalTracker(model);
    const bus = ctx.bus;
    void this.fogRepo.prepare(ctx.hero.id).then(() => this.resetFog(ctx.hero.id));
    const painter = new MapPainter(
      model,
      () => this.fog,
      () => this.ctx?.session.worldSeed ?? 0,
    );
    this.views = { big: new MapView(painter, model, goals), mini: new MiniMapView(painter, goals) };
    this.host().append(this.views.big.canvas, this.views.mini.canvas);
    this.input = new MapInput(
      () => this.playing(),
      () => this.toggle(),
    );
    this.input.bind(bus);
    this.d.add(
      bus.on('hero_loaded', ({ heroId }) => {
        this.flush();
        void this.fogRepo.prepare(heroId).then(() => this.resetFog(heroId));
      }),
    );
    this.d.add(
      bus.on('hero_deleted', ({ heroId }) => {
        this.fogRepo.deleteHero(heroId);
        if (heroId === this.heroId) {
          clearTimeout(this.saveTimer);
          this.fog.takeDirty();
          this.heroId = null;
        }
      }),
    );
    this.d.add(
      bus.on('zone_enter', () => {
        this.flush();
        const z = this.ctx?.zone;
        if (z) this.fog.setWorldAnchored(z.bigWorldStreaming === true);
        this.reveal();
      }),
    );
    this.d.add(bus.on('step', () => this.reveal()));
    this.d.listen(window, 'beforeunload', () => this.flush());
    this.d.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    if (this.animate) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private resetFog(heroId: string | null): void {
    this.heroId = heroId;
    this.fog = new FogOfWar((zone) => (heroId ? this.fogRepo.load(heroId, zone) : null));
    if (this.ctx?.zone.bigWorldStreaming) this.fog.setWorldAnchored(true);
  }

  private playing(): boolean {
    return !!this.ctx && !!this.ctx.hero.playing && !this.input?.panelOpen;
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next === this.open) return;
    this.open = next;
    this.views?.big.setVisible(next);
    this.ctx?.bus.emit('map_toggle', { open: next });
  }

  reveal(): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.hero.playing) return;
    const z = ctx.zone;
    const changed = z.bigWorldStreaming
      ? this.fog.revealWorld(z.name, ctx.hero.pos.x, ctx.hero.pos.y)
      : this.fog.reveal(z.name, ctx.hero.pos.x, ctx.hero.pos.y);
    if (changed && !this.saveTimer) {
      this.saveTimer = setTimeout(() => this.flush(), MapModule.SAVE_MS);
    }
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const id = this.heroId;
    if (!id) return;
    for (const [zone, cells] of this.fog.takeDirty()) {
      if (!cells) continue;
      void this.fogRepo.save(id, zone, cells).then((ok) => {
        if (ok) return;
        const ctx = this.ctx;
        if (ctx) {
          ctx.bus.emit('save_failed', { reason: 'fog' });
        }
        if (this.fog.storageQuotaExceeded) {
          console.warn('[MapModule] Kartdimma: lagringsutrymmet fullt — nya avslöjanden sparas inte.');
        } else if (this.fogRepo.lastError) {
          console.warn('[MapModule] Kartdimma kunde inte sparas:', this.fogRepo.lastError);
        }
      });
    }
  }

  private frame(t: number): void {
    this.raf = requestAnimationFrame((n) => this.frame(n));
    this.render(t);
  }

  render(t: number): void {
    const ctx = this.ctx;
    const v = this.views;
    if (!ctx || !v) return;
    const playing = this.playing();
    v.mini.setVisible(playing);
    if (!playing) {
      if (this.open) this.toggle(false);
      return;
    }
    const z = ctx.zone;
    const h = ctx.hero;
    const ct = ctx.clock?.time ?? 0;
    v.mini.draw(z, h, t, ct);
    if (this.open) v.big.draw(z, h, t, ct);
  }

  dispose(): void {
    this.flush();
    cancelAnimationFrame(this.raf);
    this.d.dispose();
    this.input?.dispose();
    this.views?.big.canvas.remove();
    this.views?.mini.canvas.remove();
    this.views = null;
    this.ctx = null;
  }
}
