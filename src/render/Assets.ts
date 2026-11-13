import { Rectangle, Texture } from 'pixi.js';
import { HERO_SHEET_STEPS, HeroSprites } from './HeroSprites';
import { KNIGHT_EQUIP_INDEX_STEPS, KNIGHT_EQUIP_SHEET_STEPS } from './KnightEquipmentSprites';
import { WorldFigureSprites, worldFigureLoadSteps } from './WorldFigureSprites';
import { fraction, WeightedLoadProgress } from './loadProgress';
import { fetchJsonResilient, loadTextureResilient } from './resilientAssets';
import { loadMonster8dirSet, loadSheet8dir, loadStripAnim } from './sheet8dir';
import {
  canonicalBiomeId,
  canonicalDecorGroup,
  decorForBiome,
  decorForGroup,
  STARTUP_DECOR,
  STARTUP_TILES,
  tilesForBiome,
} from './biomeAssetGroups';
import { assetUrl, DIRS, type Anim, type AnimName, type AnimSet } from './spriteAnim';

export { assetUrl, DIRS, type Anim, type AnimName, type AnimSet };
export { canonicalBiomeId, canonicalDecorGroup, decorForBiome, decorForGroup, STARTUP_DECOR, STARTUP_TILES, tilesForBiome };
export {
  biomeLoadLabel,
  BY_DECOR,
  DECOR,
  DECOR_GROUPS,
  FJALL_DECOR,
  FJALL_TILES,
  SKOG_DECOR,
  TILE_GROUPS,
  TILE_TRANSITIONS,
  TILES,
  TILES_BY_BIOME,
  TRASK_DECOR,
  TRASK_TILES,
} from './biomeAssetGroups';
export type { DecorId, TileTransitionGroup } from './biomeAssetGroups';

interface SheetAnim {
  file: string;
  frames: number;
  frameW: number;
  frameH: number;
  anchor: [number, number];
  fps: number;
  loop?: boolean;
}
interface Size {
  w: number;
  h: number;
  anchor: [number, number];
}

const BG_FILES = ['himmel.jpg', 'fjarran_skog.png', 'fjarran_portalby.png', 'fjarran_stad.png'] as const;
const EFFECT_FILES = ['glod_rare', 'glod_set', 'glod_legendary'] as const;

/**
 * Vikter för startladdningen. tiles/decor räknar bara startup-grupperna
 * (39 plattor, 24 dekor + dekor.json + lagereld_anim), inte hela katalogerna.
 * Övriga biom hämtas via ensureBiomeAssets. monsters är tyngre (8-dir-ark) än en markplatta.
 * npcs = manifest + en post per npc i npc.json (13 idag; testet låser antalet).
 * hero räknar riddarens utrustning. Klassark laddas senare, en figur i taget.
 */
export function startupLoadWeights(): Record<'tiles' | 'decor' | 'hero' | 'worldFigures' | 'monsters' | 'npcs' | 'bg' | 'icons', number> {
  return {
    tiles: STARTUP_TILES.length,
    decor: STARTUP_DECOR.length + 2,
    hero: HERO_SHEET_STEPS + KNIGHT_EQUIP_INDEX_STEPS + KNIGHT_EQUIP_SHEET_STEPS,
    worldFigures: worldFigureLoadSteps(),
    monsters: 90,
    npcs: 14,
    bg: BG_FILES.length + EFFECT_FILES.length,
    icons: 1,
  };
}

const tex = (p: string): Promise<Texture> => loadTextureResilient(p);

function cut(src: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: src.source, frame: new Rectangle(x, y, w, h) });
}
function sheet(src: Texture, a: SheetAnim, rows = 8): Anim {
  const frames: Texture[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Texture[] = [];
    for (let c = 0; c < a.frames; c++) row.push(cut(src, c * a.frameW, r * a.frameH, a.frameW, a.frameH));
    frames.push(row);
  }
  return { frames, anchor: a.anchor, w: a.frameW, h: a.frameH, fps: a.fps, loop: a.loop ?? true };
}
/** En enda bild (riktning SV): samma textur i alla riktningar; Sprite speglas för östliga riktningar. */
function single(t: Texture, s: Size): Anim {
  return { frames: DIRS.map(() => [t]), anchor: s.anchor, w: s.w, h: s.h, fps: 1, loop: true, single: true };
}

export function completeAnimSet(partial: Partial<AnimSet>): AnimSet {
  const gang = partial.gang ?? partial.run ?? partial.attack ?? partial.idle;
  const idle = partial.idle ?? gang;
  if (!idle) throw new Error('Tomt animationset');
  return {
    idle,
    gang,
    run: partial.run ?? gang,
    attack: partial.attack ?? gang,
    dod: partial.dod ?? idle,
  };
}

/** Laddar och äger alla 2D-texturer (tiles, dekor, hjälte, monster, NPC, bakgrunder, ikoner). */
export class AssetStore {
  readonly tiles = new Map<string, Texture>();
  readonly decor = new Map<string, { tex: Texture; size: Size }>();
  readonly monsters = new Map<string, AnimSet>();
  readonly npcs = new Map<string, Anim>();
  readonly npcPortraits = new Map<string, string>();
  readonly heroes = new HeroSprites();
  readonly worldFigures = new WorldFigureSprites();
  readonly backgrounds = new Map<string, Texture>();
  readonly effects = new Map<string, Texture>();
  /** Animerad dekor (t.ex. lägereld). *_anim.png hör hit, inte i DECOR. */
  readonly decorAnims = new Map<string, Anim>();
  iconIndex: Record<string, string> = {};
  private loadProgress: WeightedLoadProgress | null = null;
  private decorMeta: Record<string, Size> = {};
  private decorMetaReady = false;
  /** Pågående lazy-laddningar. Samma nyckel delar löfte, även vid parallella anrop. */
  private readonly loadJobs = new Map<string, Promise<void>>();

  /** @param onProgress kvot 0..1 av verkligt startarbete (plattor, ark, manifest). */
  async load(onProgress?: (ratio: number) => void): Promise<void> {
    const progress = new WeightedLoadProgress(startupLoadWeights());
    this.loadProgress = progress;
    const stop = onProgress ? progress.subscribe(onProgress) : undefined;
    try {
      await Promise.all([
        this.loadTiles(),
        this.loadDecor(),
        this.loadHero(),
        this.loadWorldFigures(),
        this.loadMonsters(),
        this.loadNpcs(),
        this.loadBg(),
        this.loadIcons(),
      ]);
      progress.seal();
    } finally {
      stop?.();
      this.loadProgress = null;
    }
  }
  /**
   * Hämtar plattor och dekor för ett biom. Idempotent: parallella anrop delar samma löfte.
   * Saknad fil loggas och hoppas över, den kraschar inte laddningen.
   */
  ensureBiomeAssets(biomeId: string, onProgress?: (ratio: number) => void): Promise<void> {
    const id = canonicalBiomeId(biomeId);
    return this.shareLoad(`biome:${id}`, () => this.loadNamedAssets(tilesForBiome(id), decorForBiome(id), onProgress));
  }

  /**
   * Hämtar en dekorgrupp som inte hör till startladdningen, till exempel by och interiör.
   * Samma löfte delas om gruppen redan laddas.
   */
  ensureDecorGroup(groupId: string, onProgress?: (ratio: number) => void): Promise<void> {
    const id = canonicalDecorGroup(groupId);
    return this.shareLoad(`decor:${id}`, () => this.loadNamedAssets([], decorForGroup(id), onProgress));
  }

  private shareLoad(key: string, work: () => Promise<void>): Promise<void> {
    const pending = this.loadJobs.get(key);
    if (pending) return pending;
    const job = work().catch((err: unknown) => {
      this.loadJobs.delete(key);
      throw err;
    });
    this.loadJobs.set(key, job);
    return job;
  }

  private async loadNamedAssets(
    tileIds: readonly string[],
    decorIds: readonly string[],
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const tiles = tileIds.filter((id) => !this.tiles.has(id));
    const decor = decorIds.filter((id) => !this.decor.has(id));
    const total = tiles.length + decor.length;
    if (total === 0) {
      onProgress?.(1);
      return;
    }
    if (decor.length > 0) await this.ensureDecorMeta();
    let done = 0;
    const tick = (): void => {
      done += 1;
      onProgress?.(done / total);
    };
    await Promise.all([
      ...tiles.map(async (id) => {
        try {
          this.tiles.set(id, await tex(`2d/tiles/${id}.png`));
        } catch (e) {
          console.warn(`[AssetStore] tile ${id}:`, e);
        } finally {
          tick();
        }
      }),
      ...decor.map(async (id) => {
        try {
          const size = this.decorMeta[id];
          if (!size?.w || !size.h || !Array.isArray(size.anchor) || size.anchor.length < 2) {
            console.warn(`[AssetStore] dekor ${id} saknar mått`);
          } else {
            this.decor.set(id, { tex: await tex(`2d/dekor/${id}.png`), size });
          }
        } catch (e) {
          console.warn(`[AssetStore] dekor ${id}:`, e);
        } finally {
          tick();
        }
      }),
    ]);
    onProgress?.(1);
  }

  private async ensureDecorMeta(): Promise<void> {
    if (this.decorMetaReady) return;
    this.decorMeta = await fetchJsonResilient<Record<string, Size>>('2d/dekor/dekor.json', {});
    this.decorMetaReady = true;
  }

  private async loadTiles(): Promise<void> {
    const total = STARTUP_TILES.length;
    let done = 0;
    await Promise.all(
      STARTUP_TILES.map(async (t) => {
        this.tiles.set(t, await tex(`2d/tiles/${t}.png`));
        done += 1;
        this.loadProgress?.setPhase('tiles', fraction(done, total));
      }),
    );
    this.loadProgress?.setPhase('tiles', 1);
  }
  private async loadDecor(): Promise<void> {
    const total = STARTUP_DECOR.length + 2;
    let done = 0;
    const tick = (): void => {
      done += 1;
      this.loadProgress?.setPhase('decor', fraction(done, total));
    };
    await this.ensureDecorMeta();
    tick();
    await Promise.all(
      STARTUP_DECOR.map(async (d) => {
        const size = this.decorMeta[d];
        if (size) this.decor.set(d, { tex: await tex(`2d/dekor/${d}.png`), size });
        tick();
      }),
    );
    try {
      this.decorAnims.set('lagereld_anim', await loadStripAnim(tex, '2d/dekor', 'lagereld_anim'));
    } catch (e) {
      console.warn('[AssetStore] lagereld_anim:', e);
    }
    tick();
    this.loadProgress?.setPhase('decor', 1);
  }
  private async loadHero(): Promise<void> {
    const total = HERO_SHEET_STEPS + KNIGHT_EQUIP_INDEX_STEPS + KNIGHT_EQUIP_SHEET_STEPS;
    let done = 0;
    const tick = (): void => {
      done += 1;
      this.loadProgress?.setPhase('hero', fraction(done, total));
    };
    try {
      await this.heroes.load((p) => tex(p), tick);
    } catch (e) {
      console.warn('[AssetStore] hjältesprites:', e);
    }
    this.loadProgress?.setPhase('hero', 1);
  }

  /** Laddar spriteark för den valda figuren. Redan laddad klass hoppas över. */
  async loadHeroClass(cls: string): Promise<void> {
    await this.heroes.loadClass(cls, (p) => tex(p));
  }
  private async loadWorldFigures(): Promise<void> {
    const total = worldFigureLoadSteps();
    let done = 0;
    const tick = (): void => {
      done += 1;
      this.loadProgress?.setPhase('worldFigures', fraction(done, total));
    };
    try {
      await this.worldFigures.load((p) => tex(p), tick);
    } catch (e) {
      console.warn('[AssetStore] världsfigurer:', e);
    }
    this.loadProgress?.setPhase('worldFigures', 1);
  }
  private async loadMonsters(): Promise<void> {
    const index = await fetchJsonResilient<{
      sheets: string[];
      eightDir?: string[];
      eightDirAnims?: Record<string, string[]>;
    }>('2d/sprites/monster/index.json', {
      sheets: [],
    });
    const eightDir = new Set(index.eightDir ?? []);
    const sheets = index.sheets;
    const sheetUnits = sheets.length;
    let sheetsDone = 0;
    // Arkens andel stannar på 0.95 så den lilla monster.json-svansen inte drar kvoten bakåt.
    const reportMonsters = (tailDone: number, tailUnits: number): void => {
      const head = sheetUnits <= 0 ? 0.95 : 0.95 * (sheetsDone / sheetUnits);
      const tail = tailUnits <= 0 ? 0 : 0.05 * (tailDone / tailUnits);
      this.loadProgress?.setPhase('monsters', head + tail);
    };
    if (sheetUnits === 0) this.loadProgress?.setPhase('monsters', 0.95);
    await Promise.all(
      sheets.map(async (id) => {
        try {
          if (eightDir.has(id)) {
            const eight = await loadMonster8dirSet(tex, id, index.eightDirAnims?.[id]);
            if (eight) {
              this.monsters.set(id, completeAnimSet(eight));
              return;
            }
          }
          const m = await fetchJsonResilient<{ anims: Record<AnimName, SheetAnim> }>(`2d/sprites/monster/${id}/${id}.json`, {
            anims: {} as Record<AnimName, SheetAnim>,
          });
          const set: AnimSet = {};
          await Promise.all(
            (Object.entries(m.anims) as [AnimName, SheetAnim][]).map(async ([k, a]) => {
              if (!a?.file) return;
              set[k] = sheet(await tex(`2d/sprites/monster/${id}/${a.file}`), a);
            }),
          );
          if (Object.keys(set).length) this.monsters.set(id, completeAnimSet(set));
        } catch (e) {
          console.warn(`[AssetStore] monster ${id}:`, e);
        } finally {
          sheetsDone += 1;
          reportMonsters(0, 0);
        }
      }),
    );
    const meta = await fetchJsonResilient<{ monster: Record<string, Size & { fil: string }> }>('2d/sprites/monster/monster.json', {
      monster: {},
    });
    const singles = Object.entries(meta.monster);
    let singlesDone = 0;
    await Promise.all(
      singles.map(async ([id, s]) => {
        try {
          if (this.monsters.has(id)) return;
          const a = single(await tex(`2d/sprites/monster/${s.fil}`), s);
          this.monsters.set(id, completeAnimSet({ idle: a, gang: a, attack: a }));
        } catch (e) {
          console.warn(`[AssetStore] monsterbild ${id}:`, e);
        } finally {
          singlesDone += 1;
          reportMonsters(singlesDone, singles.length);
        }
      }),
    );
    this.loadProgress?.setPhase('monsters', 1);
  }
  private async loadNpcs(): Promise<void> {
    const meta = await fetchJsonResilient<{
      npc: Record<string, Size & { fil: string; portratt?: string }>;
    }>('2d/sprites/npc/npc.json', { npc: {} });
    const entries = Object.entries(meta.npc);
    const total = 1 + entries.length;
    let done = 1;
    this.loadProgress?.setPhase('npcs', fraction(done, total));
    await Promise.all(
      entries.map(async ([id, s]) => {
        try {
          const dir = `2d/sprites/npc/${id}`;
          try {
            const anim = await loadSheet8dir(tex, dir, `${id}_idle_8dir`, 0.8);
            this.npcs.set(id, anim);
          } catch {
            this.npcs.set(id, single(await tex(`2d/sprites/npc/${s.fil}`), s));
          }
          if (s.portratt) this.npcPortraits.set(id, `2d/sprites/npc/${s.portratt}`);
        } catch (e) {
          console.warn(`[AssetStore] npc ${id}:`, e);
        } finally {
          done += 1;
          this.loadProgress?.setPhase('npcs', fraction(done, total));
        }
      }),
    );
    this.loadProgress?.setPhase('npcs', 1);
  }
  npcPortraitUrl(spriteId: string): string | null {
    const p = this.npcPortraits.get(spriteId);
    return p ? assetUrl(p) : null;
  }
  private async loadBg(): Promise<void> {
    const total = BG_FILES.length + EFFECT_FILES.length;
    let done = 0;
    const tick = (): void => {
      done += 1;
      this.loadProgress?.setPhase('bg', fraction(done, total));
    };
    await Promise.all(
      BG_FILES.map(async (f) => {
        this.backgrounds.set(f.replace(/\..*/, ''), await tex(`2d/bakgrund/${f}`));
        tick();
      }),
    );
    await Promise.all(
      EFFECT_FILES.map(async (f) => {
        this.effects.set(f, await tex(`effekter/${f}.png`));
        tick();
      }),
    );
    this.loadProgress?.setPhase('bg', 1);
  }
  private async loadIcons(): Promise<void> {
    const idx = await fetchJsonResilient<Record<string, unknown>>('ikoner/index.json', {});
    for (const [k, v] of Object.entries(idx)) if (!k.startsWith('_') && typeof v === 'string') this.iconIndex[k] = v;
    this.loadProgress?.setPhase('icons', 1);
  }
  /** URL till föremålsikon (DOM), eller null. Sökordning: legendarisk, setdel, set.bas, bas. */
  iconUrl(keys: (string | undefined)[]): string | null {
    for (const k of keys) {
      const f = k ? this.iconIndex[k] : undefined;
      if (f) return assetUrl('ikoner/' + f);
    }
    return null;
  }
  frameUrl(quality: string): string {
    return assetUrl(
      `ikoner/ram_${quality === 'magic' || quality === 'rare' || quality === 'set' || quality === 'legendary' ? quality : 'normal'}.png`,
    );
  }
}

/** Skärmriktning (0–7, DIRS-ordning) för en världsriktning (dx österut, dy söderut) i isometrisk vy. */
export function dirIndex(dx: number, dy: number): number {
  const sx = dx - dy;
  const sy = (dx + dy) / 2;
  const a = (Math.atan2(sy, sx) * 180) / Math.PI;
  return ((Math.round((a - 90) / 45) % 8) + 8) % 8;
}
