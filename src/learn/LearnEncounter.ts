import type { Monster } from '../entities/Monster';
import type { Hero } from '../entities/Hero';
import type { CombatSystem } from '../systems/CombatSystem';
import type { MonsterAI } from '../systems/MonsterAI';
import type { World } from '../systems/World';
import { LearnOverlay } from '../ui/LearnOverlay';
import { applyWrongAnswer } from './damage';
import { questionsForEncounter } from './questions';
import { encounterKindOf, type LearnSettings } from './types';

const FIGHT_S = 1.25;
const HIT_AT = [0.12, 0.48, 0.86];
const WRONG_S = 1.1;

type Phase = 'idle' | 'ask' | 'feedback' | 'fight';

/**
 * Pausar när hjälten möter ett monster, visar en fråga och spelar sedan en kort strid.
 * Fel svar kostar en fjärdedel av maxlivet. Monstret dör när alla frågor är besvarade.
 * Träffarna i animationen är kosmetiska så att bossfaser inte triggas i förtid.
 */
export class LearnEncounter {
  private readonly overlay: LearnOverlay;
  private phase: Phase = 'idle';
  private settings: LearnSettings;
  private settingsOpen = false;
  private monster: Monster | null = null;
  private questions: ReturnType<typeof questionsForEncounter> = [];
  private index = 0;
  private timer = 0;
  private fightT = 0;
  private nextHit = 0;
  private shake = 0;

  constructor(
    private readonly w: () => World,
    private readonly combat: CombatSystem,
    private readonly ai: MonsterAI,
    initial: LearnSettings,
    private readonly blocked: () => boolean,
    private readonly onHeroDied: () => void,
  ) {
    this.settings = initial;
    this.overlay = new LearnOverlay(initial);
    this.overlay.onAnswer = (i) => this.answer(i);
    this.overlay.onToggleSettings = () => this.toggleSettings();
  }

  get overlaySettings(): LearnOverlay {
    return this.overlay;
  }

  dispose(): void {
    this.cancel();
    this.overlay.dispose();
  }

  setSettings(settings: LearnSettings): void {
    this.settings = settings;
    this.overlay.setSettings(settings);
  }

  busy(): boolean {
    return this.phase !== 'idle';
  }

  blocksMovement(): boolean {
    return this.busy() || this.settingsOpen;
  }

  blocksInput(): boolean {
    return this.blocksMovement();
  }

  isQuestion(): boolean {
    return this.phase === 'ask';
  }

  toggleSettings(): void {
    if (this.busy()) return;
    this.settingsOpen = !this.settingsOpen;
    this.overlay.setSettingsOpen(this.settingsOpen);
    this.ai.paused = this.blocksMovement();
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.overlay.setSettingsOpen(false);
    this.ai.paused = this.blocksMovement();
  }

  cancel(): void {
    this.phase = 'idle';
    this.monster = null;
    this.questions = [];
    this.shake = 0;
    this.overlay.hideQuiz();
    this.ai.paused = this.settingsOpen;
    const w = this.worldOrNull();
    w?.hero.clearAttack();
  }

  answer(choice: number): void {
    if (this.phase !== 'ask') return;
    const q = this.questions[this.index];
    if (!q || choice < 0 || choice > 3) return;
    if (choice === q.correctIndex) {
      this.overlay.hideQuiz();
      this.w().fb.flash('Rätt!', '#7dff9a');
      this.beginFight();
      return;
    }
    this.phase = 'feedback';
    this.timer = WRONG_S;
    this.overlay.showWrong(q.answer);
  }

  tick(dt: number): void {
    const w = this.worldOrNull();
    if (!w) return;
    this.ai.paused = this.blocksMovement();
    if (this.monster && (this.monster.dead || !w.monsters.includes(this.monster))) {
      if (this.phase !== 'idle') this.cancel();
    }
    if (this.phase === 'fight') this.tickFight(dt);
    else if (this.phase === 'feedback') this.tickFeedback(dt);
    else if (this.phase === 'ask') this.face();
    else this.tryStart();
    this.applyShake(dt);
  }

  private worldOrNull(): World | null {
    try {
      return this.w();
    } catch {
      return null;
    }
  }

  private tryStart(): void {
    if (this.phase !== 'idle' || this.settingsOpen || this.blocked()) return;
    const w = this.w();
    const h = w.hero;
    if (!h.s.playing) return;
    let best: Monster | null = null;
    let bestD = Infinity;
    for (const m of w.monsters) {
      if (m.dead || (m.boss && !m.active)) continue;
      const d = Math.hypot(m.pos.x - h.pos.x, m.pos.y - h.pos.y);
      if (!inLearnRange(h, m, d) || d >= bestD) continue;
      best = m;
      bestD = d;
    }
    if (best) this.begin(best);
  }

  private begin(m: Monster): void {
    const w = this.w();
    const kind = encounterKindOf(m);
    const seed = kind === 'boss' ? 0 : (w.rng.next() * 0x100000000) >>> 0;
    let questions;
    try {
      questions = questionsForEncounter({
        kind,
        monsterId: m.id,
        grade: this.settings.grade,
        subject: this.settings.subject,
        seed,
      });
    } catch (err) {
      console.warn('Fråga kunde inte skapas', err);
      return;
    }
    this.monster = m;
    this.questions = questions;
    this.index = 0;
    w.hero.moveTarget = null;
    w.hero.clearAttack();
    this.face();
    this.showCurrent();
  }

  private showCurrent(): void {
    const q = this.questions[this.index];
    if (!q) {
      this.cancel();
      return;
    }
    this.phase = 'ask';
    this.overlay.showQuestion(q, this.index, this.questions.length);
    this.ai.paused = true;
  }

  private beginFight(): void {
    this.phase = 'fight';
    this.fightT = 0;
    this.nextHit = 0;
    this.face();
    this.ai.paused = true;
  }

  private tickFight(dt: number): void {
    this.fightT += dt;
    while (this.nextHit < HIT_AT.length && this.fightT >= (HIT_AT[this.nextHit] ?? 99)) {
      this.cosmeticHit();
      this.nextHit++;
    }
    if (this.fightT < FIGHT_S) return;
    const last = this.index >= this.questions.length - 1;
    const m = this.monster;
    if (last) {
      this.endQuiet();
      if (m && !m.dead) this.combat.kill(m);
      return;
    }
    this.index++;
    this.showCurrent();
  }

  private tickFeedback(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    const w = this.w();
    const h = w.hero;
    const dealt = applyWrongAnswer(h.s.hp, h.stats.maxHp);
    h.s.hp = dealt.hp;
    w.fb.float(h.pos, damageLabel(dealt.damage), 'hurt', 100);
    const last = this.index >= this.questions.length - 1;
    const m = this.monster;
    if (dealt.died) {
      h.s.playing = false;
      if (last && m && !m.dead) this.combat.kill(m);
      this.endQuiet();
      this.onHeroDied();
      return;
    }
    if (last) {
      this.endQuiet();
      if (m && !m.dead) this.combat.kill(m);
      return;
    }
    this.index++;
    this.showCurrent();
  }

  private cosmeticHit(): void {
    const w = this.w();
    const m = this.monster;
    const h = w.hero;
    if (!m || m.dead) return;
    this.face();
    h.atkPendingHit = false;
    h.atkT = 0.32;
    h.view.playbackRate = 1.15;
    h.view.play('attack', true);
    m.flash = 0.16;
    m.view.sprite.alpha = 0.45;
    this.shake = 0.18;
    const span = Math.max(0, h.stats.dmgMax - h.stats.dmgMin);
    const bias = [0.35, 0.7, 1][this.nextHit] ?? 0.5;
    const dmg = Math.max(1, Math.round(h.stats.dmgMin + span * bias));
    w.fb.float(m.pos, String(dmg), '', m.view.height2);
    this.combat.ring(m.pos, 0.55, 0xffe08a, 0.28);
  }

  private face(): void {
    const m = this.monster;
    const w = this.worldOrNull();
    if (!m || !w) return;
    w.hero.s.facing = Math.atan2(m.pos.x - w.hero.pos.x, m.pos.y - w.hero.pos.y);
  }

  private applyShake(dt: number): void {
    const m = this.monster;
    if (!m || this.shake <= 0) return;
    this.shake = Math.max(0, this.shake - dt);
    const mag = this.shake * 22;
    const flip = Math.floor(this.fightT * 40) % 2 === 0 ? mag : -mag;
    m.view.position.x += flip;
  }

  private endQuiet(): void {
    this.phase = 'idle';
    this.monster = null;
    this.questions = [];
    this.shake = 0;
    this.overlay.hideQuiz();
    this.ai.paused = this.settingsOpen;
  }
}

function inLearnRange(h: Hero, m: Monster, d: number): boolean {
  const reach = h.stats.reach + (m.boss ? 0.45 : 0.25);
  const attack = m.def.attack_range > 5 ? 3.4 : m.def.attack_range + 0.35;
  return d <= Math.max(reach, attack);
}

function damageLabel(damage: number): string {
  const rounded = Math.round(damage);
  if (rounded > 0) return `-${rounded}`;
  return `-${damage.toFixed(1).replace('.', ',')}`;
}
