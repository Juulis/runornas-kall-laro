import { Rng } from '../core/Rng';
import type { Session } from '../core/Session';
import { DATA, monsterDef } from '../data';
import { expandStartskogenArea } from '../data/startskogenExpand';
import type { EliteKind, EnemyRow, MonsterLevels, SpawnArea, SpawnPoint } from '../data/types';
import { DEFAULT_ENEMY_THEME_ID, enemyThemeById, mergeEnemyTable } from '../entities/enemyThemes';

/** Ett genererat monster (i områdets egna koordinater). */
export interface SpawnSpec {
  /** Stabilt id: `${areaId}:${spawnPointIndex}:${monsterIndex}`, boss `${areaId}:boss`. */
  uid: string;
  enemy: string;
  pos: [number, number];
  level: number;
  elite: EliteKind | null;
  modifiers: string[];
  uniqueName?: string;
  zone?: string;
  boss: boolean;
}

/** Multiplikatorer för elites (monster_niva.json elites + modifierare). */
export interface EliteStats {
  hp: number;
  damage: number;
  defense: number;
  xp: number;
  speed: number;
  attackCd: number;
  knockbackImmune: boolean;
  lifeSteal: number;
  curse: boolean;
  thorns: number;
  extraLoot: MonsterLevels['elites']['champion']['loot'] | null;
}

export const MODIFIER_NAME: Readonly<Record<string, string>> = {
  extra_stark: 'Extra stark',
  extra_snabb: 'Extra snabb',
  stenhud: 'Stenhud',
  vampyrisk: 'Vampyrisk',
  forbannad: 'Förbannad',
  tornig: 'Tornig',
};

/**
 * D2-spawn (spawnzoner.json v2, session_roll). Allt i ett område slumpas en gång per game ur
 * hash(seed, area) och hash(seed, area, punkt). Dödade id i sessionen hoppas över.
 */
export class SpawnSystem {
  private readonly levels = DATA.monsterLevels;

  area(id: string): SpawnArea {
    const a = DATA.spawn.areas.find((x) => x.id === id);
    if (!a) throw new Error(`Okänt spawnområde: ${id}`);
    return expandStartskogenArea(a);
  }

  /** cityState: stadens tillstånd (bara 'besatt' genererar monster). Dödade monster/bossar tas bort via session.killed (enda listan). */
  roll(area: SpawnArea, session: Session, opts: { cityState?: string } = {}): SpawnSpec[] {
    if (area.city_id && opts.cityState && opts.cityState !== 'besatt') return [];
    const R = area.session_roll ?? {};
    const E = this.levels.elites;
    const rng = new Rng(Rng.hash(session.seed, area.id));
    const pts = area.spawn_points;
    const always = pts.filter((p) => R.always_active?.includes(p.id) || !!p.zone);
    const rest = rng.shuffle(pts.filter((p) => !always.includes(p)));
    const want = R.active_spawn_points ? Math.max(always.length, rng.int(R.active_spawn_points)) : pts.length;
    const active = [...always, ...rest.slice(0, Math.max(0, want - always.length))];

    const counters = new Map<number, number>();
    const uidFor = (p: SpawnPoint): string => {
      const pi = pts.indexOf(p);
      const n = counters.get(pi) ?? 0;
      counters.set(pi, n + 1);
      return `${area.id}:${pi}:${n}`;
    };
    const out: SpawnSpec[] = [];
    const add = (s: SpawnSpec): void => {
      if (!session.killed.has(s.uid)) out.push(s);
    };
    const around = (r: Rng, p: SpawnPoint, radius: number): [number, number] => {
      const a = r.next() * Math.PI * 2;
      const d = Math.sqrt(r.next()) * radius;
      return [p.pos[0] + Math.cos(a) * d, p.pos[1] + Math.sin(a) * d];
    };
    // Extras från fiendetemat blandas in. Antal punkter och gruppstorlek är oförändrade.
    const theme = enemyThemeById(DEFAULT_ENEMY_THEME_ID);
    const table = (p: SpawnPoint): EnemyRow[] =>
      mergeEnemyTable(p.enemy_table ?? (p.zone ? area.zone_tables?.[p.zone] : undefined) ?? area.enemy_table ?? [], theme);

    // Grupper per aktiv punkt; champion per grupp tills max.
    let champions = 0;
    const champMax = R.champions?.max ?? 0;
    const champP = R.champions?.chance_per_group ?? 0;
    for (const p of active) {
      const pr = new Rng(Rng.hash(session.seed, area.id, p.id));
      const groups = pr.int(p.groups ?? [1, 1]);
      for (let g = 0; g < groups; g++) {
        const row = pr.weighted(table(p));
        const base = monsterDef(row.enemy).level;
        const champ = champions < champMax && pr.chance(champP);
        if (champ) champions++;
        const n = champ ? pr.int([2, 3]) : pr.int(row.group ?? p.group_size ?? R.monsters_per_group ?? [1, 1]);
        for (let i = 0; i < n; i++)
          add({
            uid: uidFor(p),
            enemy: row.enemy,
            pos: around(pr, p, p.radius),
            level: base + (champ ? E.champion.level_bonus : 0),
            elite: champ ? 'champion' : null,
            modifiers: [],
            zone: p.zone,
            boss: false,
          });
      }
    }

    // Unika: chans per game, högst max, med minions.
    const uMax = R.uniques?.max ?? 0;
    const uP = R.uniques?.chance_per_game ?? 0;
    for (let u = 0; u < uMax && active.length; u++) {
      if (!rng.chance(uP)) continue;
      const p = rng.pick(active);
      const row = rng.weighted(table(p));
      const base = monsterDef(row.enemy).level;
      const mods = rng.shuffle(E.modifiers.map((m) => m.id)).slice(0, rng.int(E.unik.modifiers_count));
      add({
        uid: uidFor(p),
        enemy: row.enemy,
        pos: around(rng, p, p.radius * 0.5),
        level: base + E.unik.level_bonus,
        elite: 'unik',
        modifiers: mods,
        uniqueName: rng.pick(E.unique_names),
        zone: p.zone,
        boss: false,
      });
      const minions = rng.int(E.unik.minions.count);
      for (let i = 0; i < minions; i++)
        add({
          uid: uidFor(p),
          enemy: row.enemy,
          pos: around(rng, p, p.radius),
          level: base + E.unik.minions.level_bonus,
          elite: 'minion',
          modifiers: [],
          zone: p.zone,
          boss: false,
        });
    }

    if (area.boss) {
      const b = area.boss;
      add({
        uid: `${area.id}:boss`,
        enemy: b.enemy,
        pos: b.pos,
        level: monsterDef(b.enemy).level,
        elite: null,
        modifiers: [],
        zone: b.zone,
        boss: true,
      });
    }
    return out;
  }

  eliteStats(spec: Pick<SpawnSpec, 'elite' | 'modifiers'>): EliteStats | null {
    if (!spec.elite) return null;
    const E = this.levels.elites;
    const src = spec.elite === 'unik' ? E.unik : spec.elite === 'minion' ? E.unik.minions : E.champion;
    const s: EliteStats = {
      hp: src.hp_mult,
      damage: src.damage_mult,
      defense: spec.elite === 'unik' ? E.unik.defense_add : E.champion.defense_add,
      xp: spec.elite === 'unik' ? E.unik.xp_mult : E.champion.xp_mult,
      speed: 1,
      attackCd: 1,
      knockbackImmune: false,
      lifeSteal: 0,
      curse: false,
      thorns: 0,
      extraLoot: spec.elite === 'unik' ? E.unik.loot : spec.elite === 'champion' ? E.champion.loot : null,
    };
    for (const m of spec.modifiers) {
      if (m === 'extra_stark') s.damage *= 1.3;
      else if (m === 'extra_snabb') {
        s.speed = 1.4;
        s.attackCd = 0.8;
      } else if (m === 'stenhud') {
        s.defense += 6;
        s.knockbackImmune = true;
      } else if (m === 'vampyrisk') s.lifeSteal = 0.1;
      else if (m === 'forbannad') s.curse = true;
      else if (m === 'tornig') s.thorns = 0.15;
    }
    return s;
  }
}
