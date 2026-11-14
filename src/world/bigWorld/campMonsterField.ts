import { DATA, monsterDef } from '../../data';
import type { Vec2 } from '../../core/GameContext';
import { Rng } from '../../core/Rng';
import { TILE_WORLD } from '../../render/Iso';
import type { SpawnSpec } from '../../systems/SpawnSystem';
import { campStartPos } from './startskogenFootprint';
import { isWaterAtWorld } from './waterPlanner';

/**
 * Lägerflock runt startelden.
 *
 * Spelaren börjar vid start_pos i chunk [0,0] (startlagret), som är sakert och
 * därför hoppas över av chunk-spawnen. Den täta listan i spawnzoner.json ligger
 * kvar vid Rungläntan (världens origo), ungefär 180 enheter bort, utanför både
 * kameran och aktiveringsradien. Den här flocken läggs därför i världskoordinater
 * runt elden, utanför den lilla gläntan, så man ser vargar direkt och möter en
 * inom några sekunders gång.
 */
export const CAMP_SAFE_RADIUS = 14;
/** Inga vanliga monster närmare start_pos än så här (världsenheter). */
export const START_POS_SAFE_RADIUS = 22;
export const CAMP_FIELD_UID_PREFIX = 'lager:';

const RINGS = [18, 30, 44] as const;
const POINTS_PER_RING = 8;
const PACK = 2;

/** Lägerelden (varld_stor lager_ankare). Inte Rungläntans mitt. */
export function campFirePos(): Vec2 {
  const raw = DATA.varldStor.meta.startskogen_fotavtryck?.lager_ankare?.lagerelden;
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
    return { x: raw[0], y: raw[1] };
  }
  return { x: -128, y: -128 };
}

export function isCampFieldUid(uid: string): boolean {
  return uid.startsWith(CAMP_FIELD_UID_PREFIX);
}

/** Puttar en punkt ut till cirkelns kant. Lägerflocken hålls här även när den jagar, så gläntan förblir fri. */
export function keepOutsideSafeRadius(pos: Vec2, center: Vec2, radius: number): void {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const r = Math.hypot(dx, dy);
  if (r < radius && r > 0.05) {
    const k = radius / r;
    pos.x = center.x + dx * k;
    pos.y = center.y + dy * k;
  } else if (r <= 0.05) {
    pos.x = center.x + radius;
    pos.y = center.y;
  }
}

/** Håller en lägerpunkt utanför eldens glänta och utanför start_pos. */
function pushCampPoint(x: number, y: number, fire: Vec2, start: Vec2): Vec2 {
  const pos = { x, y };
  keepOutsideSafeRadius(pos, fire, CAMP_SAFE_RADIUS + 1);
  keepOutsideSafeRadius(pos, start, START_POS_SAFE_RADIUS);
  keepOutsideSafeRadius(pos, fire, CAMP_SAFE_RADIUS + 1);
  return pos;
}

/**
 * Stabil flock per game-seed. Inre ringen är grupper om 2 och ligger inom en kort gång från start_pos.
 * worldSeed styr vatten. Utan den används seed, så äldre anrop fortfarande hoppar över vatten.
 */
export function campMonsterSpecs(seed: number, worldSeed = seed): SpawnSpec[] {
  const fire = campFirePos();
  const start = campStartPos();
  const rng = new Rng(Rng.hash(seed, 'lager-monster'));
  const rot = rng.next() * Math.PI * 2;
  const out: SpawnSpec[] = [];
  let n = 0;
  for (const radius of RINGS) {
    for (let i = 0; i < POINTS_PER_RING; i++) {
      const ang = rot + (i / POINTS_PER_RING) * Math.PI * 2;
      const enemy = rng.chance(0.72) ? 'skogsvarg' : 'vargbest';
      const level = monsterDef(enemy).level;
      for (let g = 0; g < PACK; g++) {
        const side = g === 0 ? -0.9 : 0.9;
        const rawX = fire.x + Math.cos(ang) * radius + Math.cos(ang + Math.PI / 2) * side;
        const rawY = fire.y + Math.sin(ang) * radius + Math.sin(ang + Math.PI / 2) * side;
        const pos = pushCampPoint(rawX, rawY, fire, start);
        if (isWaterAtWorld(worldSeed, pos.x, pos.y)) {
          let dry = false;
          for (let step = 1; step <= 8; step++) {
            const nudged = pushCampPoint(pos.x + Math.cos(ang) * step * TILE_WORLD, pos.y + Math.sin(ang) * step * TILE_WORLD, fire, start);
            if (!isWaterAtWorld(worldSeed, nudged.x, nudged.y)) {
              pos.x = nudged.x;
              pos.y = nudged.y;
              dry = true;
              break;
            }
          }
          if (!dry) continue;
        }
        out.push({
          uid: `${CAMP_FIELD_UID_PREFIX}${n}`,
          enemy,
          pos: [pos.x, pos.y],
          level,
          elite: null,
          modifiers: [],
          boss: false,
        });
        n++;
      }
    }
  }
  return out;
}
