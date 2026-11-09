import { Graphics } from 'pixi.js';
import { DATA } from '../data';
import type { Vec2 } from '../core/GameContext';
import type { Monster } from '../entities/Monster';
import type { WorldFighter } from '../entities/WorldFighter';
import { Iso } from '../render/Iso';
import type { MonsterSnapshot } from '../logic/CombatRules';
import type { LootSystem } from './LootSystem';
import type { World } from './World';
import { skillUnlocked } from '../logic/skills';
import { canStartDodge } from '../logic/dodge';

interface HitOpts {
  kb?: number;
  stun?: number;
  ranged?: boolean;
}

function bossActForMonster(id: string): string {
  const bx = DATA.monsterLevels.boss_xp_faktor;
  if (bx && typeof bx === 'object' && 'bossar' in bx && bx.bossar && typeof bx.bossar === 'object') {
    const act = (bx.bossar as Record<string, string>)[id];
    if (act) return act;
  }
  return 'akt_1';
}

/** Strid i klienten: effekter, knuff, projektiler. Utfall (träff, skada, XP, droppar) avgörs av GameAuthority. Hjältens anfall och färdigheter, träffchans, skada, krosslag, knuff, livsstöld, taggar, XP och död. */
export class CombatSystem {
  /** Anropas när bossen dör. */
  onBossDefeated: (m: Monster) => void = () => undefined;
  onHeroDied: () => void = () => undefined;
  /** Spelaren hjälpte en patrull att fälla monstret. */
  onPatrolAidKill: () => void = () => undefined;
  /** Lärversionen: monster ska inte döda hjälten före frågan. Quiz-skada går inte genom hurt. */
  suppressHeroHurt = true;
  /** Lärversionen: vapen, färdigheter och projektiler gör ingen skada. Bara frågan får fälla. */
  suppressHeroMonsterDamage = true;

  constructor(
    private readonly w: () => World,
    private readonly loot: LootSystem,
  ) {}

  /** Ren data om monstret för spellogiken (GameAuthority). */
  snapshot(m: Monster): MonsterSnapshot {
    const h = this.w().hero;
    const f = { x: Math.sin(m.facing), y: Math.cos(m.facing) };
    const to = this.norm({ x: h.pos.x - m.pos.x, y: h.pos.y - m.pos.y });
    return {
      id: m.id,
      lvl: m.lvl,
      hp: m.hp,
      max: m.max,
      defense: m.defense,
      boss: m.boss,
      family: m.def.family,
      weak: m.def.weak,
      resist: m.def.resist,
      immune: m.immune > 0,
      vulnerable: m.vuln > 0,
      shieldedFront: m.id === 'skelett_vakt' && f.x * to.x + f.y * to.y > 0.3,
      xp: m.def.xp,
      xpMult: m.boss || m.def.underboss ? 1 : (m.es?.xp ?? 1),
      underboss: m.def.underboss === true,
      bossAct: m.boss || m.def.underboss ? bossActForMonster(m.id) : undefined,
    };
  }

  damageMonster(m: Monster, mult = 1, opts: HitOpts = {}): void {
    if (this.suppressHeroMonsterDamage) return;
    const w = this.w();
    const h = w.hero;
    const st = h.stats;
    const t = w.text;
    if (m.dead) return;
    m.aggroed = true;
    this.markPatrolAid(m);
    let mMult = mult * h.combatDamageMult();
    if (h.passiveActive('jagarblick') && m.hp / m.max > 0.8) mMult *= 1.1;
    const extraCrit = h.nextCritBonus;
    const r = w.authority.heroHit(st, h.level, this.snapshot(m), mMult, extraCrit);
    if (extraCrit > 0) h.nextCritBonus = 0;
    if (!r.hit) {
      w.fb.float(m.pos, t.t('fx.miss'), 'res', m.view.height2);
      return;
    }
    const { dmg, crit, strong, fm } = r;
    m.hp -= dmg;
    m.flash = 0.15;
    m.lastHit = w.time;
    if (dmg > 0 && st.lifeOnHit) h.s.hp = Math.min(st.maxHp, h.s.hp + st.lifeOnHit);
    const o = this.norm({ x: m.pos.x - h.pos.x, y: m.pos.y - h.pos.y });
    const k = (opts.kb ?? 8) * (1 - (m.def.knockback_resist ?? 0)) * (m.boss ? 0.15 : 1) * (m.es?.knockbackImmune ? 0 : 1);
    m.kb = { x: o.x * k, y: o.y * k };
    if (opts.stun) m.stun = opts.stun;
    if (m.es?.thorns && dmg > 0 && !opts.ranged) {
      const th = Math.max(1, Math.round(dmg * m.es.thorns));
      h.s.hp = Math.max(1, h.s.hp - th);
      w.fb.float(h.pos, t.t('fx.thorns', { n: th }), 'hurt', 90);
    }
    w.bus.emit('hit', { target: m.uid ?? m.id, dmg, crit });
    const label = m.immune > 0 ? t.t('fx.immune') : (crit ? `${dmg}!` : `${dmg}`) + (strong ? ' ' + t.t('fx.strong') : '');
    w.fb.float(m.pos, label, fm > 1 ? 'weak' : fm < 1 ? 'res' : crit ? 'crit' : '', m.view.height2);
    if (st.lifesteal) h.s.hp = Math.min(st.maxHp, h.s.hp + dmg * st.lifesteal);
    if (m.id === 'skelett_runprast' && !((m.timers.tp ?? 0) > 0) && m.hp > 0) {
      m.timers.tp = 6;
      const a = w.rng.float(0, 6.28);
      m.pos.x += Math.cos(a) * 5;
      m.pos.y += Math.sin(a) * 5;
      w.zone.collide(m.pos, 0.5);
    }
    if (m.hp <= 0) this.kill(m);
  }

  /** Låg skada från världspatrull — lämnar minst 1 HP så spelaren får sista slaget. */
  damageMonsterFromFighter(m: Monster, dmg: number): void {
    const w = this.w();
    if (m.dead || m.boss) return;
    m.aggroed = true;
    m.hp = Math.max(1, m.hp - dmg);
    m.flash = 0.15;
    m.lastHit = w.time;
  }

  hurtWorldFighter(f: WorldFighter, raw: number, _from: Vec2 | null): void {
    const w = this.w();
    if (!f.alive) return;
    const dmg = Math.max(1, Math.round(raw * 0.35));
    f.hp -= dmg;
    w.fb.float(f.pos, `-${dmg}`, 'hurt', 70);
    if (f.hp <= 0) {
      f.dead = 0.001;
      f.playDeath();
    }
  }

  /**
   * Fäller monstret och delar ut XP och byte.
   * fromLearn krävs i lärversionen: anrop från träff, färdighet eller taggar ignoreras.
   */
  kill(m: Monster, fromLearn = false): void {
    if (this.suppressHeroMonsterDamage && !fromLearn) return;
    const w = this.w();
    m.dead = 0.001;
    m.view.play('dod');
    const first = !!m.uid && m.boss && !w.session.killed.has(m.uid);
    if (m.uid) w.session.killed.add(m.uid);
    const st = w.hero.stats;
    const lo = m.es?.extraLoot;
    const reward = w.authority.killReward({
      m: this.snapshot(m),
      heroLvl: w.hero.level,
      mf: st.mf,
      goldFind: st.goldFind,
      firstKill: first,
      ilvl: Math.min(DATA.monsterLevels.item_level.cap, m.lvl + (m.boss ? 2 : m.elite === 'unik' ? 1 : 0)),
      extraRolls: lo?.extra_rolls ?? 0,
      qualityMult: lo?.quality_mult ?? 1,
    });
    const ups = w.hero.gainXp(reward.xp);
    const equipped = this.loot.grantAuto(reward.drops);
    if (ups) {
      w.fb.flash(w.text.t('msg.level_up', { level: w.hero.level }));
      w.bus.emit('level_up', { level: w.hero.level });
    }
    for (const name of equipped) w.fb.flash(w.text.t('msg.new_gear', { name }));
    w.bus.emit('kill', {
      id: m.uid ?? m.id,
      area: w.zone.areaId,
      lvl: m.lvl,
      champion: m.elite === 'champion' || m.elite === 'minion',
      unique: m.elite === 'unik',
      boss: m.boss,
    });
    if (m.boss) this.onBossDefeated(m);
    if (m.heroAidedPatrol) this.onPatrolAidKill();
    if (w.hero.passiveActive('blodtorst')) w.hero.s.hp = Math.min(w.hero.s.maxHp, w.hero.s.hp + w.hero.s.maxHp * 0.05);
  }

  /** Hjälten tar skada. from = varifrån slaget kom (för block), m = anfallaren. */
  hurt(raw: number, from: Vec2 | null, m: Monster | null): void {
    if (this.suppressHeroHurt) return;
    const w = this.w();
    const h = w.hero;
    const st = { ...h.stats, defense: h.effectiveDefense() };
    const t = w.text;
    if (!h.s.playing) return;
    if (h.invulnerable()) return;
    const f = h.forward();
    const to = from ? this.norm({ x: from.x - h.pos.x, y: from.y - h.pos.y }) : null;
    const front = to ? f.x * to.x + f.y * to.y > 0.2 : true;
    const rawIn = raw * (m?.dmgMult ?? 1) * (h.skillDmgT > 0 && h.skillTakeDmgPct > 0 ? 1 + h.skillTakeDmgPct : 1);
    const r = w.authority.monsterHit({
      raw: rawIn,
      monsterLvl: m?.lvl ?? h.level,
      st,
      heroLvl: h.level,
      front,
      moving: h.moving,
      blocking: h.blocking && !!from,
    });
    if (r.kind === 'miss') return w.fb.float(h.pos, t.t('fx.miss'), 'weak', 100);
    if (r.kind === 'block') return w.fb.float(h.pos, t.t('fx.block'), 'weak', 100);
    const d = r.dmg;
    h.s.hp = Math.max(0, h.s.hp - d);
    if (m?.es?.lifeSteal && !m.dead) m.hp = Math.min(m.max, m.hp + d * m.es.lifeSteal);
    if (m?.es?.curse) h.curse = 4;
    if (st.thorns && m && !m.dead) {
      m.hp = Math.max(1, m.hp - st.thorns);
    }
    w.fb.float(h.pos, '-' + d, 'hurt', 100);
    h.view.sprite.tint = 0xff8080;
    if (h.s.hp <= 0) {
      h.s.playing = false;
      this.onHeroDied();
    }
  }

  arcHit(range: number, dot: number, mult: number, opts: HitOpts = {}, max = 99): number {
    const w = this.w();
    const h = w.hero;
    const f = h.forward();
    let n = 0;
    for (const m of [...w.monsters]) {
      if (m.dead || n >= max) continue;
      const ox = m.pos.x - h.pos.x;
      const oy = m.pos.y - h.pos.y;
      const d = Math.hypot(ox, oy);
      const r = range + (m.boss ? 0.8 : 0.4);
      if (d < r && (d < 0.01 || (ox * f.x + oy * f.y) / d > dot)) {
        this.damageMonster(m, mult, opts);
        n++;
      }
    }
    return n;
  }

  attack(): void {
    const h = this.w().hero;
    if (!h.s.playing || h.atkCd > 0 || h.atkT > 0) return;
    const attackAnim = h.view.getAnim('attack');
    const spd = Math.max(0.25, h.stats.atkSpeed * h.atkSpeedMult());
    h.atkCd = 0.5 / spd;
    if (attackAnim?.hitFrame !== undefined && attackAnim.frames[0]?.length) {
      const n = attackAnim.frames[0].length;
      h.atkT = n / attackAnim.fps / spd;
      h.atkHitT = attackAnim.hitFrame / attackAnim.fps / spd;
      h.atkPendingHit = true;
      h.view.playbackRate = spd;
      h.view.play('attack', true);
      return;
    }
    h.atkPendingHit = false;
    h.atkT = 0.3;
    this.arcHit(h.stats.reach, 0.3, 1);
  }

  /** Träfffas i attackanimationen (anropas från Game när atkHitT når 0). */
  resolveAttackHit(): void {
    const h = this.w().hero;
    if (!h.atkPendingHit) return;
    h.atkPendingHit = false;
    this.arcHit(h.stats.reach, 0.3, 1);
  }

  /** Q / högerklick / färdighetsknapp 1: första aktiva färdigheten (sköldblock hålls). */
  skill(down: boolean): void {
    this.useBarSkill(0, down);
  }

  useBarSkill(slot: number, down = true): void {
    const h = this.w().hero;
    const sk = h.barSkills()[slot];
    if (!sk) return;
    this.useSkill(sk.id, down);
  }

  useSkill(id: string, down = true): void {
    const w = this.w();
    const h = w.hero;
    if (!h.s.playing) return;
    const sk = h.cls.skills.find((s) => s.id === id);
    if (!sk) return;

    if (sk.id === 'skoldblock') {
      h.blocking = down;
      return;
    }
    if (!down) return;
    if (h.skillCdLeft(sk.id) > 0) return;
    if (!skillUnlocked(sk, h.level)) return;
    if (sk.id === 'kastspjut' && h.countJavelins() === 0) {
      w.fb.flash(w.text.t('skill.no_javelin'));
      return;
    }
    if (sk.id === 'vig_undanmanover') {
      if (
        !canStartDodge({
          playing: h.s.playing,
          dodgeCd: h.dodgeCd,
          dodgeRemain: h.dodgeRemain,
          atkT: h.atkT,
        })
      ) {
        return;
      }
    }
    const staminaCost = sk.stamina_cost;
    if (staminaCost > 0 && !h.spendStamina(staminaCost)) {
      w.fb.flash(w.text.t('skill.no_stamina'));
      return;
    }

    switch (sk.id) {
      case 'spjutstot':
        h.atkT = 0.3;
        h.atkCd = 0.5;
        this.arcHit(3.5, 0.85, 1.5, { kb: 5 }, 2);
        break;
      case 'kastspjut':
        if (!h.consumeJavelin()) {
          h.refundStamina(staminaCost);
          w.fb.flash(w.text.t('skill.no_javelin'));
          return;
        }
        this.heroShot(14, 1.2);
        break;
      case 'vig_undanmanover': {
        const f = h.forward();
        if (h.tryDodge(f.x, f.y, 0.35)) {
          h.iframeT = Math.max(h.iframeT, 0.3);
          h.nextCritBonus = 0.3;
        } else {
          h.refundStamina(staminaCost);
          return;
        }
        break;
      }
      case 'virvelspjut':
        this.arcHit(3, 0.1, 0.6);
        this.arcHit(3, 0.1, 0.6);
        break;
      case 'tungt_slag':
      case 'markslag':
        h.atkT = 0.35;
        this.arcHit(2.4, 0.2, 2.0, { kb: 10, stun: 1 });
        this.ring(h.pos, 2.4, 0xc8b090, 0.35);
        break;
      case 'stridsvral':
        h.skillDmgPct = 0.2;
        h.skillDmgT = 6;
        for (const m of w.monsters) if (!m.dead) m.aggroed = true;
        break;
      case 'markskakning':
        this.arcHit(4, 0.05, 1.2, { kb: 6, stun: 0.5 });
        this.ring(h.pos, 4, 0x8a7050, 0.4);
        break;
      case 'berserkerrus':
        h.skillDmgPct = 0.4;
        h.skillAtkSpeedPct = 0.4;
        h.skillTakeDmgPct = 0.15;
        h.skillDmgT = 8;
        break;
      case 'skoldslag':
        this.arcHit(2.2, 0.4, 0.8, { kb: 8, stun: 1.5 });
        break;
      case 'framstot': {
        const f = h.forward();
        h.pos.x += f.x * 6;
        h.pos.y += f.y * 6;
        w.zone.collide(h.pos, 0.5);
        this.arcHit(2.5, 0.5, 1.3, { kb: 12, stun: 0.5 }, 1);
        break;
      }
      case 'motattack':
        h.blocking = true;
        h.iframeT = 0.3;
        this.arcHit(2.8, 0.45, 1.8, { kb: 6 });
        break;
      case 'fanbararens_rop':
        h.s.hp = Math.min(h.s.maxHp, h.s.hp + h.s.maxHp * 0.25);
        h.bannerDefBonus = 3;
        h.bannerDefT = 10;
        break;
      case 'yxkast':
        this.heroShot(10, 1.6);
        break;
      default:
        this.arcHit(h.stats.reach, 0.35, 1.2);
        break;
    }
    if (sk.cooldown_s > 0) h.skillCooldowns[sk.id] = sk.cooldown_s;
    w.fb.flash(w.text.data('klasser', sk.id, 'name', sk.name));
  }

  private heroShot(range: number, mult: number): void {
    const w = this.w();
    const h = w.hero;
    const f = h.forward();
    const speed = 22;
    this.projectile(h.pos, { x: h.pos.x + f.x * range, y: h.pos.y + f.y * range }, speed, 0, 'arrow', null, {
      heroShot: true,
      mult,
    });
  }

  projectile(
    from: Vec2,
    to: Vec2,
    speed: number,
    dmg: number,
    kind: 'arrow' | 'fire',
    src: Monster | null,
    extra?: { heroShot?: boolean; mult?: number },
  ): void {
    const w = this.w();
    const v = this.norm({ x: to.x - from.x, y: to.y - from.y });
    const view =
      kind === 'fire'
        ? new Graphics().circle(0, -40, 7).fill(0xff5530)
        : new Graphics().moveTo(-10, -40).lineTo(10, -40).stroke({ color: 0xe8e0c8, width: 3 });
    const sv = Iso.worldToScreen(v.x, v.y);
    if (kind === 'arrow') view.rotation = Math.atan2(sv.y, sv.x);
    w.objects.addChild(view);
    w.projectiles.push({
      pos: { ...from },
      v: { x: v.x * speed, y: v.y * speed },
      dmg,
      life: 3,
      from: src,
      view,
      heroShot: extra?.heroShot,
      mult: extra?.mult,
    });
  }

  /** Ring på marken (telegraf eller effekt). Tas bort efter life sekunder. */
  ring(c: Vec2, r: number, color: number, life: number): Graphics {
    const w = this.w();
    const g = new Graphics();
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const s = Iso.worldToScreen(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      pts.push(s.x, s.y);
    }
    g.poly(pts).stroke({ color, width: 4, alpha: 0.9 });
    w.effects.addChild(g);
    setTimeout(() => g.destroy(), life * 1000);
    return g;
  }

  update(dt: number): void {
    const w = this.w();
    const h = w.hero;
    for (const p of [...w.projectiles]) {
      p.pos.x += p.v.x * dt;
      p.pos.y += p.v.y * dt;
      p.life -= dt;
      const s = Iso.worldToScreen(p.pos.x, p.pos.y);
      p.view.position.set(s.x, s.y);
      p.view.zIndex = p.pos.x + p.pos.y;
      let gone = p.life <= 0 || !w.zone.contains(p.pos);
      if (!gone && p.heroShot) {
        for (const m of w.monsters) {
          if (m.dead) continue;
          if (Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y) < 0.85) {
            this.damageMonster(m, p.mult ?? 1, { ranged: true });
            gone = true;
            break;
          }
        }
      }
      if (!gone && !p.heroShot && Math.hypot(p.pos.x - h.pos.x, p.pos.y - h.pos.y) < 0.7) {
        this.hurt(p.dmg, p.pos, p.from);
        gone = true;
      }
      if (!gone && !p.heroShot) {
        for (const f of w.worldFighters) {
          if (!f.alive) continue;
          if (Math.hypot(p.pos.x - f.pos.x, p.pos.y - f.pos.y) < 0.75) {
            this.hurtWorldFighter(f, p.dmg, p.pos);
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        p.view.destroy();
        w.projectiles.splice(w.projectiles.indexOf(p), 1);
      }
    }
  }

  private markPatrolAid(m: Monster): void {
    const w = this.w();
    const aidR = 14;
    for (const f of w.worldFighters) {
      if (!f.alive) continue;
      if (Math.hypot(f.pos.x - m.pos.x, f.pos.y - m.pos.y) < aidR) {
        m.heroAidedPatrol = true;
        return;
      }
    }
  }

  private norm(v: Vec2): Vec2 {
    const d = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / d, y: v.y / d };
  }
}
