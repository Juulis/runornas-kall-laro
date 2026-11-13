import type { PortalView, Vec2, ZoneView } from '../core/GameContext';
import type { VillageZoneDef } from '../data/types';
import type { Key, Params } from '../i18n/types';
import { isPlayableCityZone, PLAYABLE_CITIES, type PlayableCityZone } from '../world/cityZones';
import { bigWorldCityPortalWorld } from '../world/bigWorld/bigWorldPortals';
import type { MapModel } from './MapModel';

const CITY_GOAL: Record<PlayableCityZone, Key> = {
  wolfstead: 'map.goal_wolf_den',
  dimmerstrand: 'map.goal_dimmerstrand',
  kopparberg: 'map.goal_kopparberg',
  askeborg: 'map.goal_askeborg',
};

const PORTAL_PLACE: Record<PlayableCityZone, Key> = {
  wolfstead: 'map.zones.wolfstead',
  dimmerstrand: 'map.zones.dimmerstrand',
  kopparberg: 'map.zones.kopparberg',
  askeborg: 'map.zones.askeborg',
};

export interface Goal {
  x: number;
  y: number;
  text: Key;
  params?: Params;
}

/** Nästa mål: i skogen runsten/portal; i byn nästa ej rensade zon eller kapellet. */
export class GoalTracker {
  constructor(private readonly model: MapModel) {}

  goal(z: ZoneView, hero: Vec2): Goal | null {
    if (z.name === 'village' || z.areaId === 'gamla_byn') return this.villageGoal(z);
    if (isPlayableCityZone(z.name)) {
      const a = z.arena;
      if (a) return { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2, text: CITY_GOAL[z.name] };
    }
    const inactive = z.runes.filter((r) => !r.active);
    if (inactive.length) {
      let best = inactive[0];
      let bd = Infinity;
      for (const r of inactive) {
        const d = Math.hypot(r.x - hero.x, r.y - hero.y);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      if (best) return { x: best.x, y: best.y, text: 'map.goal_rune' };
    }
    if (z.runes.length) {
      const near = this.nearestPortalGoal(z.portals, hero);
      if (near) return near;
      const fp = this.model.forestPortal();
      if (fp) return { x: fp[0], y: fp[1], text: 'map.goal_portal' };
    }
    const near = this.nearestPortalGoal(z.portals, hero);
    if (near) return near;
    return this.nearestTownPortal(hero);
  }

  /** Närmaste portal i listan. Känd stad får platsens namn, annars den gamla portaltexten. */
  private nearestPortalGoal(portals: readonly PortalView[], hero: Vec2): Goal | null {
    let best: PortalView | null = null;
    let bd = Infinity;
    for (const p of portals) {
      const d = Math.hypot(p.x - hero.x, p.y - hero.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    if (isPlayableCityZone(best.target)) {
      return {
        x: best.x,
        y: best.y,
        text: 'map.goal_nearest_town',
        params: { place: this.model.t(PORTAL_PLACE[best.target]) },
      };
    }
    return { x: best.x, y: best.y, text: 'map.goal_portal' };
  }

  /** Inget runmål och inga portaler i zonen: närmaste av de fyra byportalerna. */
  private nearestTownPortal(hero: Vec2): Goal | null {
    let best: { x: number; y: number; city: PlayableCityZone } | null = null;
    let bd = Infinity;
    for (const city of PLAYABLE_CITIES) {
      const p = bigWorldCityPortalWorld(city);
      const d = Math.hypot(p.x - hero.x, p.y - hero.y);
      if (d < bd) {
        bd = d;
        best = { x: p.x, y: p.y, city };
      }
    }
    if (!best) return null;
    return {
      x: best.x,
      y: best.y,
      text: 'map.goal_nearest_town',
      params: { place: this.model.t(PORTAL_PLACE[best.city]) },
    };
  }

  private villageGoal(z: ZoneView): Goal | null {
    const zones = this.model.villageZones();
    for (const q of zones) {
      if (q.safe) continue;
      if (!z.cleared[q.id]) {
        const [x, y] = this.zoneCenter(q);
        return { x, y, text: 'map.goal_area', params: { area: this.model.areaName(q.id) } };
      }
    }
    const chapel = zones.find((q) => q.id === 'benkungens_kapell');
    if (chapel) {
      const [x, y] = this.zoneCenter(chapel);
      return { x, y, text: 'map.goal_area', params: { area: this.model.areaName(chapel.id) } };
    }
    return null;
  }

  private zoneCenter(q: VillageZoneDef): [number, number] {
    const t0 = q.tiles[0];
    const t1 = q.tiles[1];
    const tx = (t0[0] + t1[0]) / 2;
    const ty = (t0[1] + t1[1]) / 2;
    return this.model.tileToWorld(tx, ty);
  }
}
