/**
 * Hjälteval och fiendetema (#28).
 * Kör: npx tsx tests/hero-registry.test.mts
 */
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/core/storage';
import { DATA, monsterDef } from '../src/data/index';
import { DEFAULT_ENEMY_THEME_ID, enemyThemeById, mergeEnemyTable } from '../src/entities/enemyThemes';
import {
  DEFAULT_HERO_CLASS,
  HERO_APPEARANCES,
  HERO_CLASS_STORAGE_KEY,
  heroAppearance,
  isHeroClassId,
  readLastHeroClass,
  sheetsFor,
  writeLastHeroClass,
} from '../src/save/heroRegistry';
import { HERO_CLASSES, classById } from '../src/save/types';

const IDS = ['riddare', 'amazonkrigare', 'barbar', 'kattflickan', 'gnistan', 'valpen', 'grisan'] as const;
const MONSTERS = ['kattflickan_monster', 'gnistan_monster', 'valpen_monster', 'grisan_monster'] as const;

assert.deepEqual(
  HERO_APPEARANCES.map((h) => h.id),
  [...IDS],
);
assert.deepEqual(
  HERO_CLASSES.map((c) => c.id),
  [...IDS],
);
for (const id of IDS) {
  assert.equal(isHeroClassId(id), true);
  assert.equal(classById(id)?.id, id);
  const row = DATA.classes.classes.find((c) => c.id === id);
  assert.ok(row, `klass ${id}`);
  assert.ok(Array.isArray(row.start_gear), `${id} start_gear`);
}
assert.equal(isHeroClassId('drake'), false);
assert.equal(isHeroClassId(''), false);
assert.equal(isHeroClassId(null), false);
assert.equal(heroAppearance('finns-inte').id, DEFAULT_HERO_CLASS);
assert.equal(classById('valpen')?.icon, '🐶');

const store = new MemoryStore();
assert.equal(readLastHeroClass(store), 'riddare');
writeLastHeroClass(store, 'inte-en-hjalte');
assert.equal(store.get(HERO_CLASS_STORAGE_KEY), null);
assert.equal(readLastHeroClass(store), 'riddare');
writeLastHeroClass(store, 'gnistan');
assert.equal(readLastHeroClass(store), 'gnistan');
assert.equal(store.get(HERO_CLASS_STORAGE_KEY), 'gnistan');
store.set(HERO_CLASS_STORAGE_KEY, 'skrap');
assert.equal(readLastHeroClass(store), 'riddare');

assert.deepEqual([...sheetsFor('riddare')], ['idle', 'walk', 'run', 'attack', 'dodge']);
assert.deepEqual([...sheetsFor('kattflickan')], ['idle', 'walk']);
assert.equal(sheetsFor('gnistan').includes('run'), false);
assert.equal(sheetsFor('valpen').includes('attack'), false);
assert.equal(sheetsFor('grisan').includes('dodge'), false);

const theme = enemyThemeById('okand-tema');
assert.equal(theme.id, DEFAULT_ENEMY_THEME_ID);
assert.equal(enemyThemeById(DEFAULT_ENEMY_THEME_ID).id, 'klassisk');
const extraIds = theme.extras.map((row) => row.enemy);
for (const id of MONSTERS) assert.ok(extraIds.includes(id), id);

const base = [{ enemy: 'skogsvarg', weight: 70 }];
const merged = mergeEnemyTable(base, theme);
assert.equal(base.length, 1);
assert.equal(base[0]?.weight, 70);
assert.equal(merged.length, base.length + theme.extras.length);
assert.equal(merged[0]?.enemy, 'skogsvarg');
const first = merged[0];
assert.ok(first);
first.weight = 1;
assert.equal(base[0]?.weight, 70, 'baslistan ska inte muteras');

for (const id of MONSTERS) {
  const m = monsterDef(id);
  assert.equal(typeof m.damage, 'number', id);
  assert.equal(m.boss, false, id);
  assert.ok(m.zones?.includes('startskogen') || DATA.families.monsters.some((row) => row.id === id));
}

console.log('hero-registry.test.mts: ok');
