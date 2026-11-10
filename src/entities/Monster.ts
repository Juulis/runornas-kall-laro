import type { Vec2 } from '../core/GameContext';
import type { EliteKind } from '../data/types';
import type { DirSprite } from '../render/DirSprite';
import type { EliteStats, SpawnSpec } from '../systems/SpawnSystem';
import type { FullMonsterDef } from './MonsterDefs';

/** Ett monster i världen: data + tillstånd. Beteende sköts av MonsterAI, skada av CombatSystem. */
export class Monster {
  readonly pos: Vec2;
  readonly home: Vec2;
  hp: number;
  max: number;
  defense: number;
  dmgMult = 1;
  facing = 0;
  readonly elite: EliteKind | null;
  readonly es: EliteStats | null;
  readonly mods: string[];
  readonly uname: string | undefined;
  readonly uid: string | null;
  // AI-tillstånd
  cd = 0;
  wanderT = 0;
  target: Vec2;
  kb: Vec2 = { x: 0, y: 0 };
  flash = 0;
  dead = 0;
  stun = 0;
  immune = 0;
  vuln = 0;
  aggroed = false;
  atk = 0;
  wind = 0;
  charge = 0;
  warn = 0;
  chargeHit = false;
  chargeDir: Vec2 = { x: 0, y: 0 };
  fled = 0;
  timers: Record<string, number> = {};
  phase = 0;
  active = false;
  moving = false;
  lastHit = 0;
  /** Hjälten deltog i strid nära en världspatrull (belöning vid död). */
  heroAidedPatrol = false;
  /** Spriteark som ritas. Samma som id när inget fiendetema byter utseende. */
  readonly appearanceId: string;

  constructor(
    readonly def: FullMonsterDef,
    readonly lvl: number,
    pos: Vec2,
    readonly view: DirSprite,
    spec: SpawnSpec | null,
    es: EliteStats | null,
    rnd: () => number,
    appearanceId?: string,
  ) {
    this.facing = rnd() * 6.28;
    this.cd = rnd();
    this.pos = { ...pos };
    this.home = { ...pos };
    this.target = { ...pos };
    this.hp = this.max = def.hp;
    this.defense = def.defense;
    this.uid = spec?.uid ?? null;
    this.elite = spec?.elite ?? null;
    this.mods = spec?.modifiers ?? [];
    this.uname = spec?.uniqueName;
    this.appearanceId = appearanceId || def.id;
    this.es = es;
    if (es) {
      this.hp = this.max = Math.round(this.max * es.hp);
      this.dmgMult = es.damage;
      this.defense += es.defense;
    }
  }

  get id(): string {
    return this.def.id;
  }
  get boss(): boolean {
    return this.def.boss;
  }
  get radius(): number {
    return this.boss ? 0.9 : 0.5;
  }
}
