import type { Vec2 } from '../core/GameContext';
import type { AssetStore } from '../render/Assets';
import { DirSprite } from '../render/DirSprite';
import { scaleKForWorldHeightM, shadowRadiusForWorldHeightM, worldHeightMForMonster } from '../render/figureWorldHeights';
import type { AnimSet } from '../render/spriteAnim';
import type { SpawnSpec, SpawnSystem } from '../systems/SpawnSystem';
import type { World } from '../systems/World';
import { peekBigWorldRuntime } from '../world/bigWorld/runtime';
import { ensureStartskogenSpawnQueue } from '../world/bigWorld/startskogenSpawn';
import { DEFAULT_ENEMY_THEME_ID, getActiveEnemyTheme, themeSheetFor, type EnemyLookFlags } from './enemyThemes';
import { Monster } from './Monster';
import { fullDef, monsterLook } from './MonsterDefs';

function animVisible(set: AnimSet | undefined): set is AnimSet {
  return !!set && !!(set.idle || set.gang || set.run || set.attack || set.dod);
}

/** Föredraget ark om det syns, annars forvriden_jagare, annars första synliga arket. */
function resolveMonsterAnim(monsters: Map<string, AnimSet>, preferred: string): { id: string; set: AnimSet } {
  const direct = monsters.get(preferred);
  if (animVisible(direct)) return { id: preferred, set: direct };
  const backup = monsters.get('forvriden_jagare');
  if (animVisible(backup)) return { id: 'forvriden_jagare', set: backup };
  for (const [sheetId, set] of monsters) {
    if (animVisible(set)) return { id: sheetId, set };
  }
  console.warn(`[MonsterFactory] inget spriteark för ${preferred}`);
  return { id: preferred, set: {} };
}

/** Skapar monster (data + figur) och lägger dem i världen. */
export class MonsterFactory {
  constructor(
    private readonly assets: AssetStore,
    private readonly spawn: SpawnSystem,
  ) {}

  create(w: World, id: string, pos: Vec2, lvl: number | null, spec: SpawnSpec | null): Monster {
    const def = fullDef(id);
    const theme = getActiveEnemyTheme();
    const flags: EnemyLookFlags = {
      boss: spec?.boss === true || def.boss,
      underboss: def.underboss === true,
      elite: spec?.elite ?? null,
    };
    const salt = spec?.uid ? `${id}:${spec.uid}` : id;
    const themedSheet = themeSheetFor(theme, id, flags, salt);
    const has = (k: string): boolean => this.assets.monsters.has(k);
    const look = monsterLook(id, def.family, has);
    const preferred = theme.id !== DEFAULT_ENEMY_THEME_ID && has(themedSheet) ? themedSheet : look.sheet;
    const resolved = resolveMonsterAnim(this.assets.monsters, preferred);
    const usingTheme = theme.id !== DEFAULT_ENEMY_THEME_ID && resolved.id === themedSheet;
    const hm = usingTheme
      ? worldHeightMForMonster(resolved.id, def.family, resolved.id === 'kaxig_mastare')
      : worldHeightMForMonster(id, def.family, def.boss);
    const view = new DirSprite(resolved.set, scaleKForWorldHeightM(resolved.set, hm), shadowRadiusForWorldHeightM(hm), true, 'monster');
    view.sprite.tint = usingTheme ? 0xffffff : look.tint;
    const es = spec?.elite ? this.spawn.eliteStats(spec) : null;
    const m = new Monster(def, lvl ?? spec?.level ?? def.level, pos, view, spec, es, () => w.rng.next(), resolved.id);
    if (m.elite) {
      const c = m.elite === 'unik' ? 0xc7a35a : 0x8a8aff;
      view.sprite.tint = c === 0xc7a35a ? 0xffe8b0 : 0xc8c8ff;
    }
    w.objects.addChild(view);
    w.monsters.push(m);
    return m;
  }

  /** Fyller legacy-startskogens spawnkön (ankrad på regionchunk) om tom. */
  refillStartskogenQueue(w: World, cityState: string): void {
    if (!w.zone.bigWorldStreaming) return;
    ensureStartskogenSpawnQueue(w, () => {
      const area = this.spawn.area('startskogen');
      return this.spawn.roll(area, w.session, { cityState });
    });
  }

  /** Spawnlista per game; Startskogen instansierar nära hjälten (se syncProximitySpawns). */
  populate(w: World, cityState: string): void {
    if (w.zone.bigWorldStreaming) {
      const inside = peekBigWorldRuntime()?.heroInsideStartskogenRegion(w.hero.pos) === true;
      if (inside) this.refillStartskogenQueue(w, cityState);
      else w.spawnQueue = [];
      return;
    }
    const area = this.spawn.area(w.zone.areaId);
    const specs = this.spawn.roll(area, w.session, { cityState });
    if (w.zone.areaId === 'startskogen') {
      w.spawnQueue = specs.map((s) => {
        const p = w.zone.toWorld(s.pos);
        w.zone.collide(p, 0.5);
        return { spec: s, pos: p, done: false };
      });
      return;
    }
    w.spawnQueue = [];
    for (const s of specs) {
      if (w.session.killed.has(s.uid)) continue;
      const p = w.zone.toWorld(s.pos);
      w.zone.collide(p, 0.5);
      this.create(w, s.enemy, p, s.boss ? (area.boss?.level ?? null) : s.level, s);
    }
  }
}
