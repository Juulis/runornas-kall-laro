import { Container, Sprite } from 'pixi.js';
import { Rng } from '../core/Rng';
import { villageLayout } from '../core/GameContext';
import { DATA } from '../data';
import type { AssetStore, DecorId } from '../render/Assets';
import { Iso, TILE_WORLD } from '../render/Iso';
import { StripAnimSprite } from '../render/StripAnimSprite';
import { FOREST_CITY_PORTALS, FOREST_DECOR_MID, FOREST_DECOR_OUTER, FOREST_PLAY_RADIUS, FOREST_SAFE_RADIUS } from './forestConstants';
import { ForestGroundChunks } from './ForestGroundChunks';
import { BIG_WORLD_STREAMING_ENABLED } from './bigWorld/bigWorldConfig';
import { bigWorldCityPortalWorld } from './bigWorld/bigWorldPortals';
import { bigWorldRuntime } from './bigWorld/runtime';
import { campStartPos } from './bigWorld/startskogenFootprint';
import { applyStartskogenAnchor } from './bigWorld/startskogenSpawn';
import {
  CITY_RNG_SEED,
  cityAreaId,
  cityArenaTiles,
  cityPortEntry,
  cityTheme,
  isPlayableCityZone,
  PLAYABLE_CITIES,
  type PlayableCityZone,
} from './cityZones';
import { Zone, type ZoneName } from './Zone';

export const RUNE_POS: readonly [number, number][] = [
  [14, -10],
  [-16, -6],
  [4, 20],
];

/** Ritad zon: logik (Zone) + markcontainer + dekorsprites (läggs i objektlagret, djupsorterade). */
export interface BuiltZone {
  zone: Zone;
  ground: Container;
  decor: Container[];
  decorAnims: StripAnimSprite[];
  /** Runornas sprites i samma ordning som zone.runes. */
  runeSprites: Sprite[];
}

/** Bygger skogen och byn i 2D (procedurell layout som i 3D-versionen, samma världskoordinater). */
export class ZoneFactory {
  constructor(private readonly assets: AssetStore) {}

  build(name: ZoneName): BuiltZone {
    if (name === 'village') return this.village();
    if (isPlayableCityZone(name)) return this.playableCity(name);
    return this.forest();
  }

  private tile(id: string, i: number, j: number, ground: Container): void {
    const t = this.assets.tiles.get(id);
    if (!t) return;
    const s = new Sprite(t);
    s.anchor.set(0.5);
    const p = Iso.toScreen(i, j);
    s.position.set(p.x, p.y);
    s.scale.set(1.02); // döljer sömmar
    ground.addChild(s);
  }

  private decorSprite(id: DecorId, x: number, y: number, k: number, flip = false): Sprite {
    const d = this.assets.decor.get(id);
    const s = new Sprite(d?.tex);
    if (d) s.anchor.set(d.size.anchor[0] / d.size.w, d.size.anchor[1] / d.size.h);
    s.scale.set(flip ? -k : k, k);
    const p = Iso.worldToScreen(x, y);
    s.position.set(p.x, p.y);
    s.zIndex = x + y;
    return s;
  }

  private decorAnimSprite(id: string, x: number, y: number, k: number): StripAnimSprite | null {
    const anim = this.assets.decorAnims.get(id);
    if (!anim) return null;
    const s = new StripAnimSprite(anim, k);
    const p = Iso.worldToScreen(x, y);
    s.position.set(p.x, p.y);
    s.zIndex = x + y + 0.01;
    return s;
  }

  private forest(): BuiltZone {
    if (BIG_WORLD_STREAMING_ENABLED) return this.bigWorldForest();
    const R = new Rng(7);
    const span = Math.ceil(FOREST_PLAY_RADIUS * 2.2);
    const zone = new Zone('forest', 'startskogen', span, span);
    zone.circle = FOREST_PLAY_RADIUS;
    zone.safeRadius = FOREST_SAFE_RADIUS;
    const ground = new ForestGroundChunks(this.assets);
    const decor: Container[] = [];
    const decorAnims: StripAnimSprite[] = [];
    const free = (x: number, y: number, r: number): boolean =>
      Math.hypot(x, y) > FOREST_SAFE_RADIUS &&
      RUNE_POS.every(([a, b]) => Math.hypot(x - a, y - b) > 4) &&
      zone.colliders.every((c) => Math.hypot(x - c.x, y - c.y) > c.r + r);
    for (let n = 0, g = 0; n < 280 && g < 12000; g++) {
      const a = R.next() * 6.283;
      const d = Math.sqrt(R.next()) * FOREST_DECOR_OUTER;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      if (!free(x, y, 1)) continue;
      decor.push(this.decorSprite(R.next() < 0.85 ? 'gran' : 'dod_ek', x, y, 0.55 + R.next() * 0.35, R.next() < 0.5));
      zone.colliders.push({ x, y, r: 0.9 });
      n++;
    }
    for (let n = 0, g = 0; n < 85 && g < 12000; g++) {
      const a = R.next() * 6.283;
      const d = Math.sqrt(R.next()) * FOREST_DECOR_MID;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      if (!free(x, y, 1.2)) continue;
      const id = R.pick<DecorId>(['stenhog', 'stubbe', 'ormbunkar']);
      decor.push(this.decorSprite(id, x, y, 0.3 + R.next() * 0.2, R.next() < 0.5));
      if (id !== 'ormbunkar') zone.colliders.push({ x, y, r: 0.8 });
      n++;
    }
    const runeSprites: Sprite[] = [];
    for (const [x, y] of RUNE_POS) {
      zone.runes.push({ x, y, active: false });
      zone.colliders.push({ x, y, r: 0.8 });
      const s = this.decorSprite('runsten', x, y, 0.42);
      runeSprites.push(s);
      decor.push(s);
    }
    zone.entry = { x: 0, y: 4 };
    for (const city of PLAYABLE_CITIES) {
      const p = FOREST_CITY_PORTALS[city];
      zone.portals.push({ x: p.x, y: p.y, target: city });
    }
    decor.push(this.decorSprite('eldstad_kall', -1.2, 2.6, 0.34));
    const fire = this.decorAnimSprite('lagereld_anim', -1.2, 2.6, 0.34);
    if (fire) {
      decor.push(fire);
      decorAnims.push(fire);
    }
    return { zone, ground, decor, decorAnims, runeSprites };
  }

  /** Stor värld: chunk-streaming (world_seed + game_seed). Obegränsad värld — se BIG_WORLD_UNBOUNDED. */
  private bigWorldForest(): BuiltZone {
    const { BigWorldStreamGround } = bigWorldRuntime();
    const zone = new Zone('forest', 'startskogen', 4096, 4096);
    zone.bigWorldStreaming = true;
    zone.safeRadius = FOREST_SAFE_RADIUS;
    zone.entry = campStartPos();
    const ground = new BigWorldStreamGround(this.assets);
    const decor: Container[] = [];
    const decorAnims: StripAnimSprite[] = [];
    const runeSprites: Sprite[] = [];
    for (const [lx, ly] of RUNE_POS) {
      const { x, y } = applyStartskogenAnchor(lx, ly);
      zone.runes.push({ x, y, active: false });
      zone.colliders.push({ x, y, r: 0.8 });
      const s = this.decorSprite('runsten', x, y, 0.42);
      runeSprites.push(s);
      decor.push(s);
    }
    const camp = { x: -128, y: -128 };
    decor.push(this.decorSprite('eldstad_kall', camp.x, camp.y, 0.34));
    const fire = this.decorAnimSprite('lagereld_anim', camp.x, camp.y, 0.34);
    if (fire) {
      decor.push(fire);
      decorAnims.push(fire);
    }
    for (const city of PLAYABLE_CITIES) {
      const p = bigWorldCityPortalWorld(city);
      zone.portals.push({ x: p.x, y: p.y, target: city });
    }
    return { zone, ground, decor, decorAnims, runeSprites };
  }

  private village(): BuiltZone {
    const R = new Rng(99);
    const zone = new Zone('village', 'gamla_byn', 62, 62);
    zone.rect = [-31, 31];
    zone.tileCoords = true;
    const lay = villageLayout(DATA);
    const ground = new Container();
    const decor: Container[] = [];
    const decorAnims: StripAnimSprite[] = [];
    const zrect = (id: string): { x0: number; y0: number; x1: number; y1: number } | null => {
      const z = lay.zones.find((q) => q.id === id);
      if (!z) return null;
      const a = Zone.T(z.tiles[0][0], z.tiles[0][1]);
      const b = Zone.T(z.tiles[1][0], z.tiles[1][1]);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    };
    const arena = zrect('benkungens_kapell');
    const yard = zrect('kyrkogarden');
    for (let tx = -3; tx < 35; tx++)
      for (let ty = -3; ty < 35; ty++) {
        const w = Zone.T(tx, ty);
        const inside = tx >= 0 && tx < 32 && ty >= 0 && ty < 32;
        const road = Math.abs(w.x - 1) < 2.2 || Math.abs(w.y - 4) < 1.6;
        const inArena = arena && w.x >= arena.x0 - 1 && w.x <= arena.x1 + 1 && w.y >= arena.y0 - 1 && w.y <= arena.y1 + 1;
        const id = !inside
          ? R.pick(['skogsbotten_lov', 'skogsbotten_ormbunke'])
          : inArena
            ? 'kullersten'
            : road
              ? R.next() < 0.3
                ? 'kullersten_mossig'
                : 'kullersten'
              : R.next() < 0.25
                ? R.pick(['lera_1', 'lera_2', 'lera_3'])
                : R.pick(['gras_1', 'gras_2', 'gras_3', 'gras_4']);
        this.tile(id, w.x / TILE_WORLD, w.y / TILE_WORLD, ground);
      }
    // skogskant runt byn
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 4;
      const side = Math.floor(t);
      const c = -30 + (t - side) * 60;
      const e = 32 + R.next() * 3;
      const p = [
        [c, -e],
        [e, c],
        [-c, e],
        [-e, -c],
      ][side] ?? [0, 0];
      decor.push(this.decorSprite('gran', p[0] ?? 0, p[1] ?? 0, 0.6 + R.next() * 0.3, R.next() < 0.5));
    }
    for (const [tx, ty] of [
      [14, 17],
      [9, 14],
      [22, 23],
    ] as const) {
      const p = Zone.T(tx, ty);
      decor.push(this.decorSprite('dod_ek', p.x, p.y, 0.55));
      zone.colliders.push({ x: p.x, y: p.y, r: 0.8 });
    }
    // mur över byn med port mitt på vägen
    const gy = Zone.T(16, 22).y;
    for (let x = -21; x <= 23; x += 4)
      if (Math.abs(x - 1) > 3) {
        decor.push(this.decorSprite('ruinmur', x, gy, 0.42));
        for (let k = -1.5; k <= 1.5; k += 1.5) zone.colliders.push({ x: x + k, y: gy, r: 0.9 });
      }
    // husruiner
    for (const [tx, ty] of [
      [4, 11],
      [4, 17],
      [4, 22],
      [8, 19],
      [27, 11],
      [27, 16],
      [27, 21],
      [23, 18],
    ] as const) {
      const p = Zone.T(tx, ty);
      decor.push(this.decorSprite('ruinmur', p.x, p.y, 0.55, tx > 16));
      decor.push(this.decorSprite('stenhog', p.x + 1.4, p.y + 1.2, 0.3));
      zone.colliders.push({ x: p.x, y: p.y, r: 2 });
    }
    if (yard)
      for (let x = yard.x0 + 1; x < yard.x1; x += 2.6)
        for (let y = yard.y0 + 1; y < yard.y1; y += 3) {
          if (Math.abs(x - 1) < 3) continue;
          decor.push(this.decorSprite(R.next() < 0.6 ? 'stenhog' : 'stubbe', x, y, 0.22 + R.next() * 0.08));
          zone.colliders.push({ x, y: y + 0.3, r: 0.5 });
        }
    if (arena) {
      zone.arena = { x0: arena.x0, y0: arena.y0, x1: arena.x1, y1: arena.y1 + 2 };
      const cx = (arena.x0 + arena.x1) / 2;
      decor.push(this.decorSprite('ruinmur', cx, arena.y0 - 2, 0.9));
      zone.colliders.push({ x: cx, y: arena.y0 - 2, r: 3 });
      for (const [x, y] of [
        [arena.x0, arena.y0],
        [arena.x1, arena.y0],
        [arena.x0, arena.y1],
        [arena.x1, arena.y1],
      ] as const) {
        decor.push(this.decorSprite('runsten', x, y, 0.3));
        zone.colliders.push({ x, y, r: 0.9 });
      }
    }
    const e = Zone.T(...(DATA.portalVillage as unknown as { portal: { village_entry_tile: [number, number] } }).portal.village_entry_tile);
    zone.entry = { x: e.x, y: e.y - 3 };
    zone.portals.push({ x: e.x, y: e.y + 1, target: 'forest' });
    return { zone, ground, decor, decorAnims, runeSprites: [] };
  }

  /** Spelbar stad — 32×32 rutor enligt spawnzoner, platshållargrafik per tema. */
  private playableCity(zoneName: PlayableCityZone): BuiltZone {
    const areaId = cityAreaId(zoneName);
    const theme = cityTheme(areaId);
    const R = new Rng(CITY_RNG_SEED[zoneName]);
    const zone = new Zone(zoneName, areaId, 62, 62);
    zone.rect = [-31, 31];
    zone.tileCoords = true;
    const ground = new Container();
    const decor: Container[] = [];
    const decorAnims: StripAnimSprite[] = [];
    const roadV = (tx: number) => Math.abs(tx - 16) < 1.2;
    const roadH = (ty: number) => Math.abs(ty - 18) < 1.2 || Math.abs(ty - 15) < 1.1;
    const pickGround = (inside: boolean, road: boolean, tx: number, ty: number): string => {
      if (!inside) return R.pick(['skogsbotten_lov', 'skogsbotten_ormbunke']);
      if (road) return R.next() < 0.35 ? 'kullersten_mossig' : 'kullersten';
      if (theme === 'wolf' && inside && ty <= 7 && Math.abs(tx - 16) < 5) return R.pick(['lera_1', 'lera_2', 'lera_3']);
      if (theme === 'mist')
        return R.next() < 0.45 ? R.pick(['lera_1', 'lera_2', 'lera_3']) : R.pick(['skogsbotten_lov', 'skogsbotten_ormbunke']);
      if (theme === 'copper') return R.next() < 0.4 ? 'kullersten' : R.pick(['lera_1', 'lera_2', 'lera_3']);
      if (theme === 'ash') return R.next() < 0.35 ? 'aska' : R.pick(['lera_1', 'lera_2', 'lera_3']);
      return R.next() < 0.3 ? R.pick(['lera_1', 'lera_2', 'lera_3']) : R.pick(['gras_1', 'gras_2', 'gras_3', 'gras_4']);
    };
    for (let tx = -3; tx < 35; tx++)
      for (let ty = -3; ty < 35; ty++) {
        const w = Zone.T(tx, ty);
        const inside = tx >= 0 && tx < 32 && ty >= 0 && ty < 32;
        const road = inside && (roadV(tx) || roadH(ty) || ty >= 24);
        this.tile(pickGround(inside, road, tx, ty), w.x / TILE_WORLD, w.y / TILE_WORLD, ground);
      }
    const edgeDecor: DecorId[] =
      theme === 'mist'
        ? ['dod_ek', 'gran']
        : theme === 'copper'
          ? ['gran', 'stenhog']
          : theme === 'ash'
            ? ['dod_ek', 'stubbe']
            : ['gran', 'dod_ek'];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * 4;
      const side = Math.floor(t);
      const c = -30 + (t - side) * 60;
      const e = 32 + R.next() * 3;
      const p = [
        [c, -e],
        [e, c],
        [-c, e],
        [-e, -c],
      ][side] ?? [0, 0];
      decor.push(this.decorSprite(R.pick(edgeDecor), p[0] ?? 0, p[1] ?? 0, 0.55 + R.next() * 0.25, R.next() < 0.5));
    }
    for (const [tx, ty] of [
      [8, 12],
      [24, 12],
      [10, 22],
      [22, 22],
    ] as const) {
      const p = Zone.T(tx, ty);
      decor.push(this.decorSprite('ruinmur', p.x, p.y, 0.5, tx > 16));
      decor.push(this.decorSprite('stenhog', p.x + 1.2, p.y + 0.8, 0.28));
      zone.colliders.push({ x: p.x, y: p.y, r: 1.8 });
    }
    const arena = cityArenaTiles(areaId);
    const ac = Zone.T(...arena.center);
    zone.arena = {
      x0: ac.x - arena.halfW,
      y0: ac.y - arena.halfH,
      x1: ac.x + arena.halfW,
      y1: ac.y + arena.halfH,
    };
    for (const ox of [-5, 5]) {
      decor.push(this.decorSprite('ruinmur', ac.x + ox, ac.y - 1, 0.45));
      zone.colliders.push({ x: ac.x + ox, y: ac.y - 1, r: 1.2 });
    }
    for (let i = -3; i <= 3; i++) {
      const p = Zone.T(arena.center[0] + i, arena.center[1] + 2);
      decor.push(this.decorSprite('stenhog', p.x, p.y, 0.2 + R.next() * 0.08));
    }
    const { entry, portal } = cityPortEntry(zoneName);
    zone.entry = entry;
    zone.portals.push({ x: portal.x, y: portal.y, target: 'forest' });
    decor.push(this.decorSprite('ruinmur', portal.x - 4, portal.y, 0.4));
    decor.push(this.decorSprite('ruinmur', portal.x + 4, portal.y, 0.4, true));
    return { zone, ground, decor, decorAnims, runeSprites: [] };
  }
}
