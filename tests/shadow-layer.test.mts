/**
 * Delad markskugga (issue #61).
 * Kör: npx tsx tests/shadow-layer.test.mts
 */
import assert from 'node:assert/strict';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { SaveBackend } from '../src/core/SaveBackend';
import { DirSprite } from '../src/render/DirSprite';
import { ShadowSettings } from '../src/render/ShadowSettings';
import {
  activeShadowCount,
  attachShadow,
  createShadowSprite,
  detachAll,
  detachShadow,
  setShadowsEnabled,
  SHADOW_BASE_ALPHA,
  SHADOW_NIGHT_DIM,
  shadowAlphaAt,
  shadowEllipsePixels,
  shadowKindForDecorId,
  shadowKindForDecorLayer,
  shadowPixelAlpha,
  shadowScaleFor,
  shadowScreenOffset,
  SHADOW_TEXTURE_H,
  SHADOW_TEXTURE_W,
  sharedShadowTexture,
  syncShadow,
} from '../src/render/ShadowLayer';
import type { AnimSet } from '../src/render/spriteAnim';
import { nightBlend, SECONDS_PER_HOUR } from '../src/world/GameClock';

const noon = 12 * SECONDS_PER_HOUR;
const midnight = 0;
const dusk = 20 * SECONDS_PER_HOUR + SECONDS_PER_HOUR / 2;

assert.equal(shadowScaleFor('tree'), 1.6);
assert.equal(shadowScaleFor('bush'), 0.9);
assert.equal(shadowScaleFor('monster'), 0.8);
assert.equal(shadowScaleFor('hero'), 0.6);
assert.equal(shadowScaleFor('npc'), 0.6);
assert.equal(shadowKindForDecorLayer('stor'), 'tree');
assert.equal(shadowKindForDecorLayer('mellan'), 'bush');
assert.equal(shadowKindForDecorLayer('liten'), 'decor_small');
assert.equal(shadowKindForDecorId('gran'), 'tree');
assert.equal(shadowKindForDecorId('vindtall'), 'tree');
assert.equal(shadowKindForDecorId('fjallbjork'), 'tree');
assert.equal(shadowKindForDecorId('buske'), 'bush');
assert.equal(shadowKindForDecorId('stubbe'), 'bush');
assert.equal(shadowKindForDecorId('stenhog'), 'bush');
assert.equal(shadowKindForDecorId('eldstad_kall'), 'decor_small');

assert.equal(nightBlend(noon), 0);
assert.equal(shadowAlphaAt(noon), SHADOW_BASE_ALPHA);
assert.equal(nightBlend(midnight), 1);
const nightA = shadowAlphaAt(midnight);
assert.ok(nightA > 0, 'nattskugga ska synas svagt');
assert.ok(nightA <= SHADOW_BASE_ALPHA * 0.5, 'midnatt minst 50 % svagare');
assert.equal(nightA, SHADOW_BASE_ALPHA * (1 - SHADOW_NIGHT_DIM * nightBlend(midnight)));
assert.ok(nightBlend(dusk) > 0 && nightBlend(dusk) < 1);
assert.ok(shadowAlphaAt(dusk) < shadowAlphaAt(noon));
assert.ok(shadowAlphaAt(dusk) > shadowAlphaAt(midnight));
assert.equal(shadowAlphaAt(noon, false), 0);
assert.equal(shadowAlphaAt(midnight, false), 0);

const mid = shadowPixelAlpha(SHADOW_TEXTURE_W / 2, SHADOW_TEXTURE_H / 2);
const corner = shadowPixelAlpha(0, 0);
const halfway = shadowPixelAlpha(SHADOW_TEXTURE_W - 8, SHADOW_TEXTURE_H / 2);
assert.ok(mid > 200, `mittpixel ${mid} ska vara nästan opak`);
assert.ok(corner < 5, `hörn ${corner} ska vara genomskinligt`);
assert.ok(halfway > corner && halfway < mid, 'ellipsen ska tona ut, inte ha hård kant');
const px = shadowEllipsePixels();
assert.equal(px.length, SHADOW_TEXTURE_W * SHADOW_TEXTURE_H * 4);
assert.equal(px[(SHADOW_TEXTURE_H / 2) * SHADOW_TEXTURE_W * 4] ?? -1, 0, 'rgb är svart');

const a = createShadowSprite('tree');
const b = createShadowSprite('hero');
assert.equal(a.texture, b.texture);
assert.equal(a.texture, sharedShadowTexture());
assert.equal(a.scale.x, 1.6);
assert.equal(b.scale.x, 0.6);
assert.equal(a.eventMode, 'none');
assert.equal(a.anchor.x, 0.5);
assert.equal(a.anchor.y, 0.5);
const shared = a.texture;
a.destroy(true);
b.destroy({ texture: true, textureSource: true });
assert.equal(shared.destroyed, false);
assert.equal(sharedShadowTexture(), shared);

const parent = new Container();
const host = new Sprite(Texture.EMPTY);
parent.addChild(host);
host.position.set(10, 20);
const shadow = attachShadow(host, 'decor_small');
assert.equal(shadow.parent, parent);
assert.ok(parent.getChildIndex(shadow) < parent.getChildIndex(host));
host.position.set(40, 15);
host.zIndex = 7;
syncShadow(host);
const off = shadowScreenOffset();
assert.ok(off.x !== 0 || off.y !== 0);
assert.ok(off.x > 0, 'sydost ska peka åt höger på skärmen');
assert.ok(off.y > 0, 'sydost ska peka nedåt på skärmen');
assert.equal(shadow.position.x, host.position.x + off.x);
assert.equal(shadow.position.y, host.position.y + off.y);
assert.ok(shadow.zIndex < host.zIndex);
detachShadow(host);
parent.destroy({ children: true });

const kept = new Container();
const keptHost = new Sprite(Texture.EMPTY);
kept.addChild(keptHost);
const keptShadow = attachShadow(keptHost, 'waymark');
setShadowsEnabled(false);
assert.equal(keptShadow.visible, false);
assert.equal(keptShadow.destroyed, false);
assert.equal(shadowAlphaAt(noon, false), 0);
setShadowsEnabled(true);
assert.equal(keptShadow.visible, true);
assert.equal(keptShadow.alpha, SHADOW_BASE_ALPHA);
detachShadow(keptHost);
kept.destroy({ children: true });

detachAll();
const tex = sharedShadowTexture();
for (let i = 0; i < 20; i++) {
  const chunkHost = new Sprite(Texture.EMPTY);
  const chunkParent = new Container();
  chunkParent.addChild(chunkHost);
  attachShadow(chunkHost, i % 2 === 0 ? 'tree' : 'bush');
  detachShadow(chunkHost);
  chunkHost.destroy();
  chunkParent.destroy({ children: true });
}
assert.equal(activeShadowCount(), 0);
assert.equal(tex.destroyed, false);
assert.equal(sharedShadowTexture(), tex);

const figureHost = new Container();
attachShadow(figureHost, 'npc');
figureHost.destroy(true);
assert.equal(activeShadowCount(), 0);
assert.equal(tex.destroyed, false);

const anim: AnimSet = {
  idle: {
    frames: [[Texture.EMPTY]],
    anchor: [8, 16],
    w: 16,
    h: 32,
    fps: 8,
    loop: true,
  },
};
const hero = new DirSprite(anim, 1, 26);
const monster = new DirSprite(anim, 1, 40, true, 'monster');
assert.equal(
  hero.children.some((c) => c instanceof Graphics),
  false,
);
assert.ok(hero.children.includes(hero.shadowSprite));
assert.equal(hero.shadowSprite, hero.children[0]);
assert.equal(hero.shadowSprite.texture, tex);
assert.equal(hero.shadowSprite.scale.x, shadowScaleFor('hero'));
assert.equal(monster.shadowSprite.scale.x, shadowScaleFor('monster'));
const heroOff = shadowScreenOffset();
assert.equal(hero.shadowSprite.position.x, heroOff.x);
assert.equal(hero.shadowSprite.position.y, heroOff.y);
hero.setShadowVisible(false);
assert.equal(hero.shadowSprite.visible, false);
hero.setShadowAlpha(0.2);
assert.equal(hero.shadowSprite.alpha, 0.2);
hero.shadowSprite.destroy({ texture: true, textureSource: true });
monster.shadowSprite.destroy({ texture: true, textureSource: true });
assert.equal(tex.destroyed, false);
hero.destroy({ children: true });
monster.destroy({ children: true });
assert.equal(activeShadowCount(), 0);

const saved = new Map<string, string>();
const backend = {
  async getSetting(key: string): Promise<string | null> {
    return saved.get(key) ?? null;
  },
  async setSetting(key: string, value: string): Promise<void> {
    saved.set(key, value);
  },
} as unknown as SaveBackend;
const settings = new ShadowSettings();
assert.equal(settings.enabled, true);
await settings.bind(backend);
assert.equal(settings.enabled, true);
let changes = 0;
settings.onChange(() => {
  changes += 1;
});
settings.setEnabled(false);
assert.equal(settings.enabled, false);
assert.equal(saved.get('shadows'), '0');
assert.equal(changes, 1);
const again = new ShadowSettings();
await again.bind(backend);
assert.equal(again.enabled, false);
again.setEnabled(true);
assert.equal(saved.get('shadows'), '1');
assert.equal(again.enabled, true);
setShadowsEnabled(true);

console.log('shadow-layer.test.mts: ok');
