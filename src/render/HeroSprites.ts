import type { Anim, AnimSet } from './spriteAnim';
import { KnightEquipmentSprites } from './KnightEquipmentSprites';
import { loadSheet8dir, type TexLoader } from './sheet8dir';
import { DEFAULT_HERO_CLASS, heroAppearance, isHeroClassId, type HeroSheetKind } from '../save/heroRegistry';

const HERO_SCALE = 0.55;

/**
 * Klassark laddas inte vid boot (walk-arken är flera megabyte).
 * Riddarens utrustning räknas för sig i KnightEquipmentSprites.
 */
export const HERO_SHEET_STEPS = 0;

/** NV/NO i run-arket är profil. Använd walk-rader, snabbare fps i run. */
export function patchRunDiagonals(run: Anim, walk: Anim): void {
  for (const d of [3, 5]) {
    if (walk.frames[d]?.length) run.frames[d] = walk.frames[d];
    if (walk.alignX?.[d]) {
      run.alignX ??= walk.alignX.map((row) => [...row]);
      run.alignY ??= walk.alignY?.map((row) => [...row]) ?? [];
      run.alignX[d] = [...walk.alignX[d]];
      if (walk.alignY?.[d]) run.alignY[d] = [...walk.alignY[d]];
    }
  }
}

function withFallbacks(set: AnimSet): AnimSet | null {
  const gang = set.gang ?? set.run ?? set.attack ?? set.idle;
  const idle = set.idle ?? gang;
  if (!idle) return null;
  return {
    idle,
    gang,
    run: set.run ?? gang,
    attack: set.attack ?? gang,
    dod: set.dod ?? idle,
  };
}

async function emergencySet(tex: TexLoader): Promise<AnimSet> {
  const t = await tex('2d/tiles/gras_1.png');
  const stub: Anim = {
    frames: Array.from({ length: 8 }, () => [t]),
    anchor: [16, 32],
    w: 32,
    h: 32,
    fps: 1,
    loop: true,
    scale: 1,
  };
  return { idle: stub, gang: stub, run: stub, attack: stub, dod: stub };
}

const SHEET_FIELD: Record<HeroSheetKind, 'idle' | 'gang' | 'run' | 'attack' | 'dod'> = {
  idle: 'idle',
  walk: 'gang',
  run: 'run',
  attack: 'attack',
  dodge: 'dod',
};

/** Laddar hjältesprites per klass från sprites/hero/<klass>/ (eller rot för riddare). */
export class HeroSprites {
  private readonly byClass = new Map<string, AnimSet>();
  private readonly loadingClass = new Map<string, Promise<void>>();
  private fallback: AnimSet | null = null;
  readonly knightEquipment = new KnightEquipmentSprites();

  /** Boot: inga klassark, bara riddarens utrustning och en nödsprite tills en klass laddats. */
  async load(tex: TexLoader, onStep?: () => void): Promise<void> {
    await this.knightEquipment.load(tex, onStep);
    if (!this.fallback) this.fallback = await emergencySet(tex);
  }

  /**
   * Laddar bara de ark registret säger finns för klassen.
   * Redan laddad klass, eller en pågående laddning, gör inget extra.
   */
  async loadClass(cls: string, tex: TexLoader, onStep?: () => void): Promise<void> {
    const id = isHeroClassId(cls) ? cls : DEFAULT_HERO_CLASS;
    if (this.byClass.has(id)) return;
    const pending = this.loadingClass.get(id);
    if (pending) return pending;
    const job = this.fetchClass(id, tex, onStep).finally(() => {
      this.loadingClass.delete(id);
    });
    this.loadingClass.set(id, job);
    await job;
  }

  private async fetchClass(id: string, tex: TexLoader, onStep?: () => void): Promise<void> {
    const app = heroAppearance(id);
    const base = app.folder ? `2d/sprites/hero/${app.folder}` : '2d/sprites/hero';
    const loaded = new Map<HeroSheetKind, Anim>();
    await Promise.all(
      app.sheets.map(async (kind) => {
        const file = `${app.prefix}_${kind}_8dir`;
        try {
          loaded.set(kind, await loadSheet8dir(tex, base, file, HERO_SCALE));
        } catch (e) {
          console.warn(`[HeroSprites] kunde inte ladda ${base}/${file}:`, e);
        } finally {
          onStep?.();
        }
      }),
    );
    const walk = loaded.get('walk');
    const run = loaded.get('run');
    if (run && walk) patchRunDiagonals(run, walk);
    const partial: AnimSet = {};
    for (const [kind, anim] of loaded) partial[SHEET_FIELD[kind]] = anim;
    const full = withFallbacks(partial);
    if (!full) {
      console.warn(`[HeroSprites] tomt animationset för ${id}`);
      if (!this.fallback) this.fallback = await emergencySet(tex);
      return;
    }
    this.byClass.set(id, full);
    if (id === DEFAULT_HERO_CLASS || !this.fallback) this.fallback = full;
  }

  hasDedicated(cls: string): boolean {
    return this.byClass.has(cls);
  }

  setFor(cls: string): AnimSet {
    const own = this.byClass.get(cls);
    if (own) return own;
    if (!this.fallback) throw new Error('Hjältesprites ej laddade');
    return this.fallback;
  }
}
