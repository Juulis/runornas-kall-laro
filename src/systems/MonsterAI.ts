import { themedMonsterTitle } from '../entities/enemyThemes';
import type { Monster } from '../entities/Monster';
import type { WorldFighter } from '../entities/WorldFighter';
import type { MonsterAttack } from '../entities/MonsterDefs';
import type { MonsterFactory } from '../entities/MonsterFactory';
import { dirIndex } from '../render/Assets';
import { Iso } from '../render/Iso';
import { detachLight, syncLight } from '../render/LightLayer';
import { isCampFieldUid, keepOutsideSafeRadius } from '../world/bigWorld/campMonsterField';
import type { CombatSystem } from './CombatSystem';
import type { World } from './World';

/** Bossens attackskada kommer enbart ur data (portal_by.json faser) – saknas den är det ett datafel. */
function dmgOf(a: MonsterAttack | undefined, what: string): number {
  if (a?.damage === undefined) throw new Error(`Bossattack saknar skada i data: ${what}`);
  return a.damage;
}

/** Monsterbeteenden: vandra, aggro, närstrid, avståndsskytt, taggsvinsladdning, flykt, teleport, och bossens faser. */
export class MonsterAI {
  /** Anropas när bossen aktiveras (hjälten går in i arenan). */
  onBossStart: (m: Monster) => void = () => undefined;
  /** Frågerutan pausar levande monster. Döda fortsätter att tona bort. */
  paused = false;
  onBossPhase: (m: Monster, phase: number) => void = () => undefined;

  constructor(
    private readonly w: () => World,
    private readonly combat: CombatSystem,
    private readonly factory: MonsterFactory,
  ) {}

  update(dt: number): void {
    const w = this.w();
    const hp = w.hero.pos;
    for (const m of [...w.monsters]) {
      if (m.dead) {
        m.dead += dt;
        m.view.update(dt);
        m.view.alpha = Math.max(0, 1 - Math.max(0, m.dead - 0.8) * 1.5);
        if (m.dead > 1.6) {
          detachLight(m.view);
          m.view.destroy({ children: true });
          w.monsters.splice(w.monsters.indexOf(m), 1);
        }
        continue;
      }
      if (this.paused) {
        this.sync(m, dt);
        continue;
      }
      const threat = this.pickThreat(w, m);
      const tx = threat ? threat.pos.x - m.pos.x : hp.x - m.pos.x;
      const ty = threat ? threat.pos.y - m.pos.y : hp.y - m.pos.y;
      const hx = tx;
      const hy = ty;
      const d = Math.hypot(hx, hy) || 0.01;
      const D = m.def;
      for (const k of Object.keys(m.timers)) m.timers[k] = (m.timers[k] ?? 0) - dt;
      m.cd -= dt;
      m.immune -= dt;
      m.vuln -= dt;
      m.stun -= dt;
      m.atk -= dt;
      let vx = 0;
      let vy = 0;
      let sp = 0;
      let face: number | null = null;
      const playing = w.hero.s.playing;
      const aggro =
        !!threat &&
        (!m.boss || m.active) &&
        (threat.hero
          ? playing && (d < D.aggro_range || (m.aggroed && d < D.aggro_range * 2))
          : d < D.aggro_range * 1.15 || (m.aggroed && d < D.aggro_range * 2.5));
      if (m.boss && !m.active && playing && w.zone.inArena(hp)) {
        m.active = true;
        this.onBossStart(m);
      }
      if (m.stun > 0) {
        /* bedövad */
      } else if (m.boss && m.active && playing) {
        [vx, vy, sp] = this.boss(m, d, hx, hy, dt);
        face = Math.atan2(hx, hy);
      } else if (m.charge > 0) {
        m.charge -= dt;
        vx = m.chargeDir.x;
        vy = m.chargeDir.y;
        sp = 7;
        face = Math.atan2(vx, vy);
        if (!m.chargeHit && d < 1.3) {
          m.chargeHit = true;
          this.hitThreat(threat, D.damage, m.pos, m);
        }
      } else if (aggro) {
        const ranged = D.attack_range > 5;
        face = Math.atan2(hx, hy);
        if (D.ai === 'skelett_hund' && m.hp < m.max * 0.3 && m.fled === 0) m.fled = 2;
        if (m.fled > 0) {
          m.fled -= dt;
          vx = -hx / d;
          vy = -hy / d;
          sp = D.speed;
          face = Math.atan2(vx, vy);
          if (m.fled <= 0) m.fled = -1;
        } else if (D.ai === 'taggsvin') {
          if (m.warn > 0) {
            m.warn -= dt;
            m.flash = 0.05;
            if (m.warn <= 0) {
              m.charge = 1;
              m.chargeHit = false;
              m.chargeDir = { x: hx / d, y: hy / d };
              m.cd = D.attack_cd * (m.es?.attackCd ?? 1);
            }
          } else if (d < 8 && m.cd <= 0) m.warn = 1;
          else if (d > 2) {
            vx = hx / d;
            vy = hy / d;
            sp = D.speed;
          }
        } else if (ranged) {
          if (d < 5) {
            vx = -hx / d;
            vy = -hy / d;
            sp = D.speed * 0.8;
          } else if (d > 10) {
            vx = hx / d;
            vy = hy / d;
            sp = D.speed;
          }
          if (d <= D.attack_range && m.cd <= 0) {
            m.cd = D.attack_cd * (m.es?.attackCd ?? 1);
            const a = D.attacks[0];
            this.combat.projectile(
              m.pos,
              threat?.pos ?? hp,
              a?.projectile_speed ?? 12,
              D.damage,
              D.ai === 'skelett_runprast' ? 'fire' : 'arrow',
              m,
            );
            m.atk = 0.4;
          }
        } else {
          if (d > D.attack_range * 0.75) {
            vx = hx / d;
            vy = hy / d;
            sp = D.speed;
          }
          if (d < D.attack_range && m.cd <= 0) {
            m.cd = D.attack_cd * (m.es?.attackCd ?? 1);
            m.atk = 0.4;
            this.hitThreat(threat, D.damage, m.pos, m);
          }
        }
      } else {
        m.wanderT -= dt;
        if (m.wanderT <= 0) {
          m.wanderT = this.w().rng.float(2, 5);
          const a = this.w().rng.float(0, 6.28);
          m.target = { x: m.home.x + Math.cos(a) * 5, y: m.home.y + Math.sin(a) * 5 };
        }
        const ox = m.target.x - m.pos.x;
        const oy = m.target.y - m.pos.y;
        const od = Math.hypot(ox, oy);
        if (od > 0.5) {
          vx = ox / od;
          vy = oy / od;
          sp = D.speed * 0.4;
          face = Math.atan2(vx, vy);
        }
      }
      const spd = sp * (m.es?.speed ?? 1);
      m.pos.x += (vx * spd + m.kb.x) * dt;
      m.pos.y += (vy * spd + m.kb.y) * dt;
      const decay = Math.max(0, 1 - dt * 7);
      m.kb.x *= decay;
      m.kb.y *= decay;
      w.zone.collide(m.pos, m.radius);
      // Vanliga monster puttas ut bara när de vandrar. Lägerflocken stannar utanför gläntan även i jakt,
      // annars springer de in till elden och frågerutan täcker lägret innan man hunnit gå.
      if (w.zone.safeRadius && (!aggro || isCampFieldUid(m.uid ?? ''))) {
        keepOutsideSafeRadius(m.pos, w.zone.safeCenter, w.zone.safeRadius);
      }
      if (m.boss && !m.active) {
        m.pos.x = m.home.x;
        m.pos.y = m.home.y;
      }
      if (face !== null) m.facing = face;
      m.moving = sp > 0.3;
      this.sync(m, dt);
    }
  }

  private pickThreat(w: World, m: Monster): { pos: { x: number; y: number }; hero: boolean; fighter: WorldFighter | null } | null {
    const h = w.hero;
    let best: { pos: { x: number; y: number }; hero: boolean; fighter: WorldFighter | null; d: number } | null = null;
    if (h.s.playing) {
      const d = Math.hypot(h.pos.x - m.pos.x, h.pos.y - m.pos.y);
      best = { pos: h.pos, hero: true, fighter: null, d };
    }
    for (const f of w.worldFighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - m.pos.x, f.pos.y - m.pos.y);
      if (!best || d < best.d) best = { pos: f.pos, hero: false, fighter: f, d };
    }
    if (!best) return null;
    return { pos: best.pos, hero: best.hero, fighter: best.fighter };
  }

  private hitThreat(
    threat: { hero: boolean; fighter: WorldFighter | null } | null,
    dmg: number,
    from: { x: number; y: number },
    m: Monster,
  ): void {
    if (threat?.fighter) this.combat.hurtWorldFighter(threat.fighter, dmg, from);
    else this.combat.hurt(dmg, from, m);
  }

  private sync(m: Monster, dt: number): void {
    const v = m.view;
    v.dir = dirIndex(Math.sin(m.facing), Math.cos(m.facing));
    v.play(m.atk > 0 || m.wind > 0 ? 'attack' : m.moving ? 'gang' : 'idle');
    v.update(dt);
    m.flash = Math.max(0, m.flash - dt);
    v.sprite.alpha = m.flash > 0 ? 0.6 : m.immune > 0 ? 0.75 : 1;
    const s = Iso.worldToScreen(m.pos.x, m.pos.y);
    v.position.set(s.x, s.y);
    v.zIndex = m.pos.x + m.pos.y;
    syncLight(v, m.pos);
  }

  /** Benkungen: liehugg (0,35 s uppladdning), benstorm, de dödas hov, gravslag med telegraf (miss = sårbar 3 s). */
  private boss(m: Monster, d: number, hx: number, hy: number, dt: number): [number, number, number] {
    const w = this.w();
    const phases = m.def.phases ?? [];
    const ratio = m.hp / m.max;
    const ph = ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2;
    if (ph !== m.phase) {
      m.phase = ph;
      m.immune = 2;
      this.onBossPhase(m, ph);
    }
    const F = phases[ph];
    if (!F) return [0, 0, 0];
    const A = Object.fromEntries(F.attacks.map((a) => [a.id, a])) as Record<string, MonsterAttack | undefined>;
    const mult = F.damage_mult ?? 1;
    const speed = F.speed ?? m.def.speed;
    const lie = A.liehugg;
    const range = lie?.range ?? 2.6;
    if (m.wind > 0) {
      m.wind -= dt;
      if (m.wind <= 0) {
        m.atk = 0.4;
        const f = { x: Math.sin(m.facing), y: Math.cos(m.facing) };
        const dot = (f.x * hx + f.y * hy) / d;
        if (d <= range + 0.6 && dot >= Math.cos((((lie?.arc_deg ?? 120) / 2) * Math.PI) / 180))
          this.combat.hurt(dmgOf(lie, 'liehugg') * mult, m.pos, m);
      }
      return [0, 0, 0];
    }
    if (lie && d <= range && !((m.timers.lie ?? 0) > 0)) {
      m.timers.lie = lie.cd ?? 1.4;
      m.wind = 0.35;
      return [0, 0, 0];
    }
    const storm = A.benstorm;
    if (storm && !((m.timers.storm ?? 0) > 0) && (ph === 2 || d > 4)) {
      m.timers.storm = storm.cd ?? 8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283;
        this.combat.projectile(
          m.pos,
          { x: m.pos.x + Math.cos(a), y: m.pos.y + Math.sin(a) },
          10,
          dmgOf(storm, 'benstorm') * mult,
          'arrow',
          m,
        );
      }
    }
    const court = A.kalla_hovet;
    if (court?.summon && !((m.timers.court ?? 0) > 0)) {
      m.timers.court = court.cd ?? 15;
      for (const [id, n] of Object.entries(court.summon))
        for (let i = 0; i < n; i++) {
          const s = this.factory.create(
            w,
            id,
            { x: m.pos.x + this.w().rng.float(-4, 4), y: m.pos.y + this.w().rng.float(2, 4) },
            null,
            null,
          );
          s.aggroed = true;
        }
      w.fb.flash(w.text.t('msg.court'));
    }
    const slam = A.gravslag;
    if (slam && !((m.timers.slam ?? 0) > 0)) {
      m.timers.slam = slam.cd ?? 10;
      const c = { ...w.hero.pos };
      const r = slam.radius ?? 4;
      const tele = slam.telegraph_s ?? 1.2;
      const dmg = dmgOf(slam, 'gravslag') * mult;
      this.combat.ring(c, r, 0xc0182a, tele);
      setTimeout(() => {
        if (m.dead || !this.w().monsters.includes(m)) return;
        const h = this.w().hero;
        if (Math.hypot(h.pos.x - c.x, h.pos.y - c.y) < r) this.combat.hurt(dmg, c, m);
        else {
          m.vuln = 3;
          w.fb.flash(
            w.text.t('msg.boss_vulnerable', {
              name: themedMonsterTitle(m.appearanceId, w.text.data('monsterfamiljer', m.id, 'name', m.def.name), m.uname),
            }),
          );
        }
      }, tele * 1000);
    }
    return d > range * 0.8 ? [hx / d, hy / d, speed] : [0, 0, 0];
  }
}
