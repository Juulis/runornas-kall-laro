/**
 * Ljuskällor och natt (issue #68).
 * Kör: npx tsx tests/light-layer.test.mts
 */
import assert from 'node:assert/strict';
import { Container, Sprite, Texture } from 'pixi.js';
import type { SaveBackend } from '../src/core/SaveBackend';
import { DARKNESS_SETTING_KEY, DarknessSettings } from '../src/render/DarknessSettings';
import {
  activeLightCount,
  attachLight,
  bindLightLayer,
  createLightSprite,
  DAY_OVERLAY_ALPHA,
  detachAll,
  detachLight,
  isGlowingMonsterId,
  LIGHT_ACTIVE_CAP,
  LIGHT_TEXTURE_SIZE,
  lightAlphaAt,
  lightGradientPixels,
  lightKindForDecorId,
  lightPixelAlpha,
  lightScaleFor,
  nightOverlayAlpha,
  refreshLightCap,
  setClockTime,
  setDarknessMode,
  setLightZoom,
  sharedLightTexture,
  syncLight,
  type LightKind,
} from '../src/render/LightLayer';
import { DEFAULT_CLOCK_TIME } from '../src/world/GameClock';

const kinds: LightKind[] = ['campfire', 'torch', 'lamp', 'rune', 'monster', 'hero'];

assert.equal(DAY_OVERLAY_ALPHA, 0.08);
assert.equal(lightScaleFor('campfire'), Math.max(...kinds.map((k) => lightScaleFor(k))));
assert.equal(lightScaleFor('hero'), Math.min(...kinds.map((k) => lightScaleFor(k))));
assert.equal(lightKindForDecorId('runsten'), 'rune');
assert.equal(lightKindForDecorId('vargspar_runsten'), 'rune');
assert.equal(lightKindForDecorId('fackla_stolpe'), 'torch');
assert.equal(lightKindForDecorId('fackla_slackt'), null);
assert.equal(lightKindForDecorId('lykta_vag'), 'lamp');
assert.equal(lightKindForDecorId('gran'), null);
assert.equal(isGlowingMonsterId('lyktgast'), true);
assert.equal(isGlowingMonsterId('lyktman'), true);
assert.equal(isGlowingMonsterId('irrbloss'), true);
assert.equal(isGlowingMonsterId('skogsvarg'), false);

for (const mode of ['normal', 'light'] as const) {
  for (const biome of [undefined, 'skog', 'trask', 'ask', 'kust', 'fjall', 'träsk', 'aska']) {
    assert.equal(nightOverlayAlpha(0, mode, biome), 0.08);
  }
}
const woodsNight = nightOverlayAlpha(1, 'normal', 'skog');
const unknownNight = nightOverlayAlpha(1, 'normal');
assert.ok(woodsNight >= 0.58, `skog-natt ${woodsNight} ska vara mörkare än dagens 0,50`);
assert.ok(unknownNight >= 0.58);
assert.equal(unknownNight, woodsNight);
assert.ok(nightOverlayAlpha(1, 'normal', 'trask') > woodsNight);
assert.ok(nightOverlayAlpha(1, 'normal', 'ask') > woodsNight);
assert.ok(nightOverlayAlpha(1, 'normal', 'träsk') > woodsNight);
assert.ok(nightOverlayAlpha(1, 'normal', 'aska') > woodsNight);
const coastNight = nightOverlayAlpha(1, 'normal', 'kust');
assert.ok(coastNight < woodsNight);
assert.ok(coastNight > 0.08);
for (const biome of ['skog', 'trask', 'ask', 'kust', undefined] as const) {
  const mild = nightOverlayAlpha(1, 'light', biome);
  const hard = nightOverlayAlpha(1, 'normal', biome);
  assert.ok(mild < hard, `${biome ?? 'okänt'} milt ${mild} ska vara ljusare än ${hard}`);
  assert.ok(mild > 0.08);
}
assert.equal(nightOverlayAlpha(1, 'normal', 'fjall'), woodsNight);

for (const kind of kinds) {
  assert.equal(lightAlphaAt(0, kind), 0);
  assert.equal(lightAlphaAt(0, kind, 'light'), 0);
  assert.ok(lightAlphaAt(1, kind) > 0);
  assert.ok(lightAlphaAt(1, kind, 'light') > 0);
}
const nightAlphas = kinds.map((kind) => lightAlphaAt(1, kind));
assert.equal(Math.max(...nightAlphas), lightAlphaAt(1, 'campfire'));
assert.equal(Math.min(...nightAlphas), lightAlphaAt(1, 'hero'));
assert.equal(Math.max(...kinds.map((kind) => lightAlphaAt(1, kind, 'light'))), lightAlphaAt(1, 'campfire', 'light'));
assert.equal(Math.min(...kinds.map((kind) => lightAlphaAt(1, kind, 'light'))), lightAlphaAt(1, 'hero', 'light'));

const mid = lightPixelAlpha(LIGHT_TEXTURE_SIZE / 2, LIGHT_TEXTURE_SIZE / 2);
const corner = lightPixelAlpha(0, 0);
const edge = lightPixelAlpha(LIGHT_TEXTURE_SIZE - 1, LIGHT_TEXTURE_SIZE / 2);
assert.ok(mid > 200, `mittpixel ${mid} ska vara nästan opak`);
assert.ok(corner < 5, `hörn ${corner} ska vara genomskinligt`);
assert.ok(mid > edge && edge < mid, 'gradienten ska tona ut mot kanten');
const px = lightGradientPixels();
assert.equal(px.length, LIGHT_TEXTURE_SIZE * LIGHT_TEXTURE_SIZE * 4);
const center = (Math.floor(LIGHT_TEXTURE_SIZE / 2) * LIGHT_TEXTURE_SIZE + Math.floor(LIGHT_TEXTURE_SIZE / 2)) * 4;
assert.ok((px[center] ?? 0) > 200, 'rgb är vitt');

setClockTime(0);
const camp = createLightSprite('campfire');
const heroGlow = createLightSprite('hero');
assert.equal(activeLightCount(), 0);
assert.equal(camp.texture, heroGlow.texture);
assert.equal(camp.texture, sharedLightTexture());
assert.equal(camp.scale.x, lightScaleFor('campfire'));
assert.equal(heroGlow.scale.x, lightScaleFor('hero'));
assert.equal(camp.anchor.x, 0.5);
assert.equal(camp.anchor.y, 0.5);
assert.equal(camp.eventMode, 'none');
assert.equal(camp.blendMode, 'add');
const shared = camp.texture;
camp.destroy(true);
heroGlow.destroy({ texture: true, textureSource: true });
assert.equal(shared.destroyed, false);
assert.equal(sharedLightTexture(), shared);

const parent = new Container();
const host = new Sprite(Texture.EMPTY);
parent.addChild(host);
host.position.set(10, 20);
const light = attachLight(host, 'torch');
assert.equal(light.parent, parent);
host.position.set(40, 15);
syncLight(host);
assert.equal(light.position.x, host.position.x);
assert.equal(light.position.y, host.position.y);
detachLight(host);
assert.equal(activeLightCount(), 0);
parent.destroy({ children: true });

const tex = sharedLightTexture();
for (let i = 0; i < 20; i++) {
  const chunkHost = new Sprite(Texture.EMPTY);
  const chunkParent = new Container();
  chunkParent.addChild(chunkHost);
  chunkHost.position.set(i, i * 2);
  attachLight(chunkHost, i % 2 === 0 ? 'rune' : 'torch');
  detachLight(chunkHost);
  chunkHost.destroy();
  chunkParent.destroy({ children: true });
}
assert.equal(activeLightCount(), 0);
assert.equal(tex.destroyed, false);
assert.equal(sharedLightTexture(), tex);

const figure = new Container();
attachLight(figure, 'hero');
figure.destroy({ children: true });
assert.equal(activeLightCount(), 0);
assert.equal(tex.destroyed, false);

const capParent = new Container();
const placed: { host: Sprite; sprite: Sprite; x: number }[] = [];
for (let i = 0; i < 30; i++) {
  const h = new Sprite(Texture.EMPTY);
  h.position.set(i * 10, 0);
  capParent.addChild(h);
  const sprite = attachLight(h, 'torch');
  placed.push({ host: h, sprite, x: i * 10 });
}
assert.equal(activeLightCount(), 30);
refreshLightCap({ x: 0, y: 0 });
const visibleNear = placed.filter((p) => p.sprite.visible);
assert.equal(visibleNear.length, LIGHT_ACTIVE_CAP);
assert.ok(visibleNear.length <= 24);
for (const p of placed) {
  const near = p.x <= 23 * 10;
  assert.equal(p.sprite.visible, near, `x=${p.x} visible=${p.sprite.visible}`);
}
refreshLightCap({ x: 29 * 10, y: 0 });
const visibleFar = placed.filter((p) => p.sprite.visible);
assert.equal(visibleFar.length, LIGHT_ACTIVE_CAP);
for (const p of placed) {
  const near = p.x >= 6 * 10;
  assert.equal(p.sprite.visible, near, `fokus längst bort, x=${p.x}`);
}
const moved = placed[0];
if (!moved) throw new Error('saknar ljus');
moved.host.position.set(29 * 10, 0);
syncLight(moved.host);
assert.equal(moved.sprite.position.x, moved.host.position.x);
refreshLightCap({ x: 0, y: 0 });
assert.equal(moved.sprite.visible, false);
detachAll();
capParent.destroy({ children: true });
assert.equal(activeLightCount(), 0);
assert.equal(tex.destroyed, false);

const saved = new Map<string, string>();
const backend = {
  async getSetting(key: string): Promise<string | null> {
    return saved.get(key) ?? null;
  },
  async setSetting(key: string, value: string): Promise<void> {
    saved.set(key, value);
  },
} as unknown as SaveBackend;
const settings = new DarknessSettings();
assert.equal(settings.current, 'normal');
await settings.bind(backend);
assert.equal(settings.current, 'normal');
let changes = 0;
settings.onChange(() => {
  changes += 1;
});
settings.setMode('light');
assert.equal(settings.current, 'light');
assert.equal(saved.get(DARKNESS_SETTING_KEY), 'light');
assert.equal(saved.get('darkness'), 'light');
assert.equal(changes, 1);
const again = new DarknessSettings();
await again.bind(backend);
assert.equal(again.current, 'light');
again.setMode('normal');
assert.equal(saved.get('darkness'), 'normal');
assert.equal(again.current, 'normal');

detachAll();
setDarknessMode('normal');
setLightZoom(1);
bindLightLayer(null);
setClockTime(DEFAULT_CLOCK_TIME);

console.log('light-layer.test.mts: ok');
