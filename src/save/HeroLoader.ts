import type { GameContext } from '../core/GameContext';
import { nextEvent } from '../core/nextEvent';
import type { AutoSaveService } from './AutoSaveService';
import type { HeroGateway } from './HeroGateway';
import type { SeedSource } from '../core/entropy';
import { newGameRecord, type SaveFile } from './types';

/**
 * Startar en hjälte via Game.loadHero (skriver hjälte + session, skickar hero_loaded),
 * startar autosparning direkt (så att ett avbrott under laddningen inte tappar `game`),
 * emit:ar new_game och väntar sedan på att zonen är redo: zone_enter för startzonen, eller
 * att Game redan har zonen laddad (ctx.zone.name === hero.zone). Ingen fast fördröjning som wait(1300).
 */
export class HeroLoader {
  constructor(
    private readonly ctx: GameContext,
    private readonly game: HeroGateway,
    private readonly autosave: AutoSaveService,
    /** Seed för nytt game; injiceras (crypto i plattformslagret, eller från Game). */
    private readonly newSeed: SeedSource,
    private readonly zoneTimeoutMs = 2_000,
  ) {}

  async start(save: SaveFile, resume: boolean): Promise<void> {
    this.autosave.end(this.autosave.isPlaying);
    if (!save.game) {
      save.game = newGameRecord(this.newSeed());
      save.game.worldSeed = this.newSeed();
    } else if (!resume) {
      const worldSeed = save.game.worldSeed ?? save.game.seed;
      save.game = { ...newGameRecord(this.newSeed()), worldSeed };
    }
    const g = save.game;
    const h = save.hero;
    const fresh = !!h.fresh;
    this.game.loadHero({
      hero: {
        id: h.id,
        name: h.name,
        cls: h.cls,
        level: h.level,
        xp: h.xp,
        gold: h.gold,
        inv: fresh ? [] : h.inv,
        equip: fresh ? {} : h.equip,
        fresh,
      },
      game: {
        seed: g.seed,
        worldSeed: g.worldSeed ?? this.ctx.session.worldSeed,
        killed: g.killed,
        zone: resume ? g.zone : 'forest',
        pos: resume && g.pos ? { x: g.pos[0], y: g.pos[1] } : null,
        stage: resume ? g.stage : 0,
        runes: resume ? g.runes : 0,
        city: resume ? g.city : 'besatt',
      },
      worldState: save.worldState,
      ...(save.learn ? { learn: save.learn } : {}),
    });
    if (fresh) delete h.fresh;
    this.autosave.begin(save);
    await this.autosave.saveNow('start');
    const zone = this.ctx.hero.zone;
    const ready = nextEvent(this.ctx.bus, 'zone_enter', (p) => p.name === zone, this.zoneTimeoutMs);
    this.ctx.bus.emit('new_game', { seed: g.seed });
    if (this.zoneLoaded(zone)) {
      ready.catch(() => undefined);
      return;
    }
    try {
      await ready;
    } catch (e) {
      console.warn('[HeroLoader] zone_enter uteblev', e);
    }
  }

  /** Game har redan zonen laddad (t.ex. när motorn inte emit:ar zone_enter för startzonen). */
  private zoneLoaded(zone: string): boolean {
    return this.ctx.zone.name === zone;
  }
}
