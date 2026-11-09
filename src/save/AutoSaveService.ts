import { Disposables } from '../core/Disposables';
import type { GameEvents } from '../core/events';
import type { GameContext } from '../core/GameContext';
import type { HeroGateway } from './HeroGateway';
import type { SaveRepository } from './SaveRepository';
import { SAVE_VERSION, type SaveFile } from './types';
import { BIG_WORLD_COORD_EPOCH } from '../world/bigWorld/saveCoordMigrate';

/**
 * Autosparning drivs helt av bussen (issue #12): inga polling-timers. DOM-fri:
 * sidans livscykel (beforeunload/visibilitychange) kopplas in av PageLifecycleSaver.
 * Sparar (debounce 150 ms) vid spelhändelser. Ögonblicksbilden tas synkront när saveNow anropas.
 */
export class AutoSaveService {
  static readonly TRIGGERS: ReadonlyArray<keyof GameEvents> = [
    'kill',
    'pickup',
    'loot_drop',
    'gold',
    'rune',
    'zone_enter',
    'portal_open',
    'boss_phase',
    'boss_start',
    'level_up',
    'lore_unlock',
    'boss_killed',
    'legendary_found',
    'city_state_changed',
    'runes_changed',
    'learn_settings',
  ];
  private current: SaveFile | null = null;
  private playing = false;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private readonly d = new Disposables();
  lastSave: { reason: string; at: number } | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly game: HeroGateway,
    private readonly repo: SaveRepository,
    private readonly onSaved: (d: SaveFile) => void = () => undefined,
    private readonly onFailed: (reason?: string) => void = () => undefined,
    private readonly debounceMs = 150,
  ) {}

  start(): void {
    const bus = this.ctx.bus;
    for (const e of AutoSaveService.TRIGGERS) this.d.add(bus.on(e, () => this.saveSoon(e)));
    this.d.add(
      bus.on('new_game', () => {
        // nytt game (även från motorns "Spela igen"): Game har redan bytt session, spara snapshot
        this.saveSoon('new_game');
      }),
    );
    this.d.add(
      bus.on('hero_deleted', ({ heroId }) => {
        if (this.current?.hero.id === heroId) this.end(false);
      }),
    );
  }

  get isPlaying(): boolean {
    return this.playing;
  }
  get currentSave(): SaveFile | null {
    return this.current;
  }

  begin(save: SaveFile): void {
    this.repo.backend.setActiveHero(save.hero.id);
    this.current = save;
    this.playing = true;
  }

  /** Avslutar spelpass (t.ex. tillbaka till menyn). */
  end(saveFirst = true): void {
    if (saveFirst) void this.saveNow('menu');
    clearTimeout(this.pending);
    this.playing = false;
    this.current = null;
    this.repo.backend.setActiveHero(null);
  }

  saveSoon(reason: string): void {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => void this.saveNow(reason), this.debounceMs);
  }

  /** Tar ögonblicksbilden direkt (synkront) och skriver den via SaveRepository. */
  async saveNow(reason = ''): Promise<boolean> {
    if (!this.playing || !this.current) return false;
    const snap = this.snapshot(this.current);
    this.current = snap;
    // köas direkt (före ev. radering), så att en sen sparning aldrig återskapar en raderad hjälte
    if (!(await this.repo.save(snap))) {
      this.ctx.bus.emit('save_failed', { reason });
      this.onFailed(reason);
      return false;
    }
    this.lastSave = { reason, at: snap.savedAt ?? Date.now() };
    this.onSaved(snap);
    return true;
  }

  /** Sparfil från Game.getSnapshot(); behåller id/namn från sparfilen och lägger till riktning. */
  private snapshot(cur: SaveFile): SaveFile {
    const snap = this.game.getSnapshot();
    const g = snap.game;
    const r2 = (n: number, k: number): number => Number(n.toFixed(k));
    const h = snap.hero;
    return {
      version: SAVE_VERSION,
      hero: { id: cur.hero.id, name: cur.hero.name, cls: h.cls, level: h.level, xp: h.xp, gold: h.gold, inv: h.inv, equip: h.equip },
      game: {
        seed: g?.seed || cur.game?.seed || this.ctx.session.seed,
        worldSeed: g?.worldSeed ?? cur.game?.worldSeed ?? this.ctx.session.worldSeed,
        killed: g?.killed ?? [],
        zone: g?.zone || this.ctx.zone.name || 'forest',
        pos: g?.pos ? [r2(g.pos.x, 2), r2(g.pos.y, 2)] : null,
        rot: r2(this.ctx.hero.facing, 3),
        stage: g?.stage ?? 0,
        runes: g?.runes ?? 0,
        city: g?.city ?? 'besatt',
        ...(typeof g?.worldTime === 'number' ? { worldTime: g.worldTime } : {}),
        bwCoordEpoch: g?.bwCoordEpoch ?? cur.game?.bwCoordEpoch ?? BIG_WORLD_COORD_EPOCH,
      },
      savedAt: Date.now(),
      worldState: snap.worldState ?? cur.worldState,
      ...(snap.learn || cur.learn ? { learn: snap.learn ?? cur.learn } : {}),
      ...(cur.foundItems ? { foundItems: cur.foundItems, found: cur.found } : {}),
      ...(cur.fog ? { fog: cur.fog } : {}),
    };
  }

  dispose(): void {
    clearTimeout(this.pending);
    this.d.dispose();
  }
}
