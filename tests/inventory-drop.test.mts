import assert from 'node:assert/strict';
import { BAG_H, BAG_W, Inventory } from '../src/logic/Inventory';
import { discardNeedsConfirm, shouldKeepInInventory } from '../src/logic/inventoryDiscard';
import { HeroModel } from '../src/logic/HeroModel';
import type { HeroState } from '../src/core/GameContext';
import { isQuestItemProtected } from '../src/quest/questItems';
import { Loot } from '../src/logic/loot/Loot';
import { Text } from '../src/text/Text';
import { Rng } from '../src/core/Rng';
import { LootSystem } from '../src/systems/LootSystem';
import type { World } from '../src/systems/World';
import { Zone } from '../src/world/Zone';

const L = new Loot(new Text(), new Rng(1));
const inv = new Inventory(L, [], {}, () => 1);
const normal = L.makeItem('torkat_kott', { n: 2 });
assert.ok(inv.add(normal));
const questStub = { uid: 'q1', base: 'sandaler', leg: 'flyktingens_sandaler', quality: 'legendary', affixes: [], ilvl: 1 };
assert.ok(isQuestItemProtected(questStub));
assert.equal(discardNeedsConfirm(questStub), false);
assert.equal(discardNeedsConfirm(normal), false);

assert.equal(BAG_W, 10);
assert.equal(BAG_H, 12);
const cells = new Inventory(L, [], {}, () => 1);
for (let i = 0; i < BAG_W * BAG_H; i++) assert.equal(cells.add(L.makeItem('jarnring')), true, `plats ${i}`);
assert.equal(cells.bag.length, BAG_W * BAG_H);
assert.equal(cells.add(L.makeItem('jarnring')), false, 'väskan är full vid 120 rutor');

assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'normal' })), false);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'magic' })), false);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'rare', rareName: 'Röda ringen' })), false);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'legendary' })), true);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'unique' })), true);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'set', set: 'tempelriddarens_ed' })), true);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'normal', leg: 'nagon_unik' })), true);
assert.equal(shouldKeepInInventory(L.makeItem('jarnring', { quality: 'magic', set: 'ett_set' })), true);

inv.detach(normal);
assert.equal(inv.bag.length, 0);

const zone = new Zone('forest', 'startskogen', 90, 90);
const heroPos = { x: 2, y: 3 };
const drops: { pos: { x: number; y: number }; data: { item?: { base: string } } }[] = [];
const world = {
  hero: { pos: heroPos, inv: { bag: [] } },
  rng: new Rng(99),
  zone,
  L,
  objects: { addChild: () => undefined },
  drops,
  text: new Text(),
  fb: { flash: () => undefined, float: () => undefined },
  bus: { emit: () => undefined },
} as unknown as World;

const sys = new LootSystem(
  () => world,
  { iconUrl: () => null, frameUrl: () => '' } as never,
  () => ({
    markFound: async () => false,
    unmarkFound: async () => undefined,
  }),
);
const dropped = L.makeItem('benflisa');
sys.dropFromHero(dropped);
assert.equal(drops.length, 1);
assert.equal(drops[0]?.data.item?.base, 'benflisa');
const p = drops[0]?.pos;
assert.ok(p);
assert.ok(Math.hypot(p.x - heroPos.x, p.y - heroPos.y) < 1.5);

const state: HeroState = {
  id: 't',
  name: 'T',
  cls: 'riddare',
  level: 1,
  xp: 0,
  gold: 0,
  hp: 40,
  maxHp: 40,
  pos: { x: 0, y: 0 },
  facing: 0,
  zone: 'forest',
  stage: 1,
  runes: 0,
  city: 'besatt',
  playing: true,
  fresh: false,
  resumePos: null,
  inv: [],
  equip: {},
};
const hero = new HeroModel(state, L);
assert.equal(hero.inv.equipTo(L.makeItem('jarnring'), 'ring1'), true);
assert.equal(hero.inv.equipTo(L.makeItem('jarnring'), 'ring2'), true);
const food = L.makeItem('torkat_kott');
const rareRing = L.makeItem('jarnring', { quality: 'rare', rareName: 'Röda ringen' });
const legRing = L.makeItem('jarnring', { quality: 'legendary', leg: 'okand_leg' });
const ground: { data: { item?: { uid: string } } }[] = [];
const autoWorld = {
  hero,
  rng: new Rng(3),
  zone,
  L,
  objects: { addChild: () => undefined },
  drops: ground,
  text: new Text(),
  fb: { flash: () => undefined, float: () => undefined },
  bus: { emit: () => undefined },
} as unknown as World;
const auto = new LootSystem(
  () => autoWorld,
  { iconUrl: () => null, frameUrl: () => '' } as never,
  () => ({ markFound: async () => false, unmarkFound: async () => undefined }),
);
auto.grantAuto([{ item: food }, { item: rareRing }, { item: legRing }]);
assert.equal(hero.inv.bag.includes(food), false, 'mat som inte tas på slängs');
assert.equal(hero.inv.bag.includes(rareRing), false, 'rareName räcker inte');
assert.ok(hero.inv.bag.includes(legRing), 'legendary som inte är bättre ska i väskan');
assert.equal(
  ground.some((g) => g.data.item?.uid === food.uid || g.data.item?.uid === rareRing.uid),
  false,
);

console.log('inventory-drop.test.mts: ok');
