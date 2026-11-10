import type { Monster } from '../entities/Monster';
import type { Hero } from '../entities/Hero';
import type { KeyValueStore } from '../core/storage';
import { LocalStore, MemoryStore } from '../core/storage';
import type { CombatSystem } from '../systems/CombatSystem';
import type { MonsterAI } from '../systems/MonsterAI';
import type { World } from '../systems/World';
import { LearnOverlay } from '../ui/LearnOverlay';
import { ParentView } from '../ui/ParentView';
import { RewardHud } from '../ui/RewardHud';
import { RewardToast } from '../ui/RewardToast';
import { StickerAlbum } from '../ui/StickerAlbum';
import { celebrateCorrect, heroBounceFrame, HERO_BOUNCE_S, type StarFlyInfo } from './celebrate';
import { applyWrongAnswer } from './damage';
import { questionsForEncounter } from './questions';
import { loadRewards } from './rewards';
import { recordLearnAnswer } from './rewardEvents';
import { encounterKindOf, type LearnQuestion, type LearnSettings } from './types';

/** Rätt svar: kort glad hjälte-attack. */
export const FIGHT_S = 1.25;
const HIT_AT = [0.12, 0.48, 0.86];
/** Fel svar: långsammare så barnet hinner se sving, träff och liv. */
export const WRONG_S = 2.75;
/** Monstret hinner svinga innan träffen landar och livet sjunker. */
export const HURT_LAND_AT = 0.625;
export const ENEMY_SWING_S = 1.25;
/** Andning efter rätt svar, innan nästa fråga. */
export const LEARN_PACK_PAUSE_S = 0.5;
/** Längre andning efter fel så skadan hinns ses. */
export const LEARN_WRONG_PAUSE_S = 0.9;
/** Hur länge hjälten skakar när träffen landar. */
export const HERO_HURT_SHAKE_S = 0.65;
/** Hörförståelse: texten syns efter rätt svar innan striden börjar. */
export const LISTEN_REVEAL_S = 1.4;
/** Mjuk röd blink efter träffen. Ingen blod, bara färgen. */
export const HERO_HURT_FLASH_S = 1.1;

type Phase = 'idle' | 'ask' | 'feedback' | 'reveal' | 'fight' | 'pause';

/**
 * Pausar när hjälten möter ett monster, visar frågor och spelar sedan striden.
 * Fel svar kostar en fjärdedel av maxlivet och tar längre tid så träffen syns.
 * Monstret dör när alla frågor är besvarade.
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
  /** Sprite-x före skak. Sätts vid första skak och används som position.x = bas + offset. */
  private shakeBaseX: number | null = null;
  private readonly store: KeyValueStore;
  private readonly hud: RewardHud;
  private readonly toast: RewardToast;
  private album: StickerAlbum | null = null;
  private parentView: ParentView | null = null;
  private albumOpen = false;
  private parentOpen = false;
  /** performance.now() när frågan visades. */
  private shownAt = 0;
  /** Rätt i det pågående mötet. Champion och boss räknas på sista frågan. */
  private encounterCorrect = 0;
  private hurtT = 0;
  private hurtLanded = false;
  private hurtResult: { hp: number; damage: number; died: boolean } | null = null;
  private heroFlash = 0;
  private heroShake = 0;
  /** Paus innan nästa fråga. Längre när senaste svaret var fel. */
  private packPause = LEARN_PACK_PAUSE_S;
  /** -1 = ingen studs. Annars sekunder sedan rätt svar. */
  private heroBounceT = -1;
  private heroBounceBaseY: number | null = null;
  private heroBounceBaseScale: { x: number; y: number } | null = null;
  /** Stjärnor mot en räknare. Standard gör inget tills en annan del kopplar på. */
  onCorrectCelebrate: (info: StarFlyInfo) => void = () => undefined;

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
    this.store = browserStore();
    this.hud = new RewardHud(this.overlay.root);
    this.toast = new RewardToast();
    this.overlay.onOpenAlbum = () => this.openAlbum();
    this.overlay.onOpenParent = () => this.openParent();
    try {
      this.hud.render(loadRewards(this.store));
    } catch (err) {
      console.warn('Belöningar kunde inte läsas', err);
    }
  }

  get overlaySettings(): LearnOverlay {
    return this.overlay;
  }

  dispose(): void {
    this.albumOpen = false;
    this.parentOpen = false;
    this.cancel();
    this.album?.dispose();
    this.parentView?.dispose();
    this.toast.dispose();
    this.hud.dispose();
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
    return this.busy() || this.settingsOpen || this.albumOpen || this.parentOpen;
  }

  blocksInput(): boolean {
    return this.blocksMovement();
  }

  isQuestion(): boolean {
    return this.phase === 'ask';
  }

  toggleSettings(): void {
    if (this.busy()) return;
    if (this.parentView?.isOpen()) {
      this.parentView.close();
      return;
    }
    if (this.album?.isOpen()) {
      this.album.close();
      return;
    }
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
    this.clearMonsterSwing();
    this.restoreShake();
    this.restoreHeroBounce();
    this.heroFlash = 0;
    this.clearHeroHurtTint();
    this.heroShake = 0;
    this.hurtResult = null;
    this.phase = 'idle';
    this.monster = null;
    this.questions = [];
    this.overlay.hideQuiz();
    this.ai.paused = this.settingsOpen;
    const w = this.worldOrNull();
    w?.hero.clearAttack();
  }

  answer(choice: number): void {
    if (this.phase !== 'ask') return;
    const q = this.questions[this.index];
    if (!q || choice < 0 || choice > 3) return;
    const correct = choice === q.correctIndex;
    this.noteAnswer(q, correct);
    if (correct) {
      if (keepsListenText(q)) {
        this.overlay.showCorrect(q);
        this.phase = 'reveal';
        this.timer = LISTEN_REVEAL_S;
        this.ai.paused = true;
        return;
      }
      this.startCorrectFight();
      return;
    }
    this.packPause = LEARN_WRONG_PAUSE_S;
    this.phase = 'feedback';
    this.timer = WRONG_S;
    this.hurtT = 0;
    this.hurtLanded = false;
    this.hurtResult = null;
    this.overlay.showWrong(q, choice);
    this.beginWrongHurt();
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
    else if (this.phase === 'reveal') this.tickReveal(dt);
    else if (this.phase === 'pause') this.tickPause(dt);
    else if (this.phase === 'ask') this.face();
    else this.tryStart();
    this.tickHeroBounce(dt);
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
    if (this.blocksMovement() || this.blocked()) return;
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
    this.encounterCorrect = 0;
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
    this.shownAt = this.clockMs();
    this.overlay.showQuestion(q, this.index, this.questions.length);
    this.ai.paused = true;
  }

  private noteAnswer(q: (typeof this.questions)[number], correct: boolean): void {
    try {
      const durationMs = Math.max(0, Math.round(this.clockMs() - this.shownAt));
      if (correct) this.encounterCorrect += 1;
      const kind = this.monster ? encounterKindOf(this.monster) : 'normal';
      const last = this.index >= this.questions.length - 1;
      const result = recordLearnAnswer(
        {
          correct,
          kind,
          grade: q.grade,
          subject: q.subject,
          rule: q.rule,
          durationMs,
          settingsSubject: this.settings.subject,
          encounterDone: last && kind !== 'normal',
          encounterCorrect: this.encounterCorrect,
        },
        this.store,
      );
      this.hud.render(result.rewards);
      this.toast.pushAll(result.toasts);
      if (result.statsWarning) this.toast.push(result.statsWarning, true);
    } catch (err) {
      console.warn('Belöning kunde inte sparas', err);
    }
  }

  private clockMs(): number {
    const perf = globalThis.performance;
    if (perf && typeof perf.now === 'function') return perf.now();
    return Date.now();
  }

  private refreshHud(): void {
    try {
      this.hud.render(loadRewards(this.store));
    } catch (err) {
      console.warn('Belöningar kunde inte läsas', err);
    }
  }

  private openAlbum(): void {
    if (this.parentView?.isOpen()) this.parentView.close();
    this.albumOpen = true;
    this.ai.paused = true;
    this.ensureAlbum().open();
  }

  private openParent(): void {
    if (this.album?.isOpen()) this.album.close();
    this.parentOpen = true;
    this.ai.paused = true;
    this.ensureParent().open();
  }

  private ensureAlbum(): StickerAlbum {
    this.album ??= new StickerAlbum(this.store, {
      onDirty: () => this.refreshHud(),
      onClose: () => {
        this.albumOpen = false;
        this.ai.paused = this.blocksMovement();
        this.refreshHud();
      },
    });
    return this.album;
  }

  private ensureParent(): ParentView {
    this.parentView ??= new ParentView(this.store, {
      onDirty: () => this.refreshHud(),
      onClose: () => {
        this.parentOpen = false;
        this.ai.paused = this.blocksMovement();
        this.refreshHud();
      },
    });
    return this.parentView;
  }

  /** Rätt svar: göm frågan och spela den korta striden. Hörförståelse väntar först. */
  private startCorrectFight(): void {
    const spot = this.overlay.celebratePoint();
    const info: StarFlyInfo = { x: spot.x, y: spot.y, starsHint: 1 };
    const phrase = celebrateCorrect(info);
    this.onCorrectCelebrate(info);
    this.overlay.hideQuiz();
    this.w().fb.flash(phrase, '#7dff9a');
    this.packPause = LEARN_PACK_PAUSE_S;
    this.beginHeroBounce();
    this.beginFight();
  }

  private tickReveal(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.startCorrectFight();
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
      if (m && !m.dead) this.fell(m);
      return;
    }
    this.openNextQuestion();
  }

  private tickFeedback(dt: number): void {
    this.tickWrongHurt(dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    if (!this.hurtLanded) this.landHurt();
    const dealt = this.hurtResult;
    const w = this.w();
    const h = w.hero;
    const last = this.index >= this.questions.length - 1;
    const m = this.monster;
    this.clearMonsterSwing();
    if (dealt?.died) {
      h.s.playing = false;
      if (last && m && !m.dead) this.fell(m);
      this.endQuiet();
      this.onHeroDied();
      return;
    }
    if (last) {
      this.endQuiet();
      if (m && !m.dead) this.fell(m);
      return;
    }
    this.openNextQuestion();
  }

  /** Monster svingar först. Liv, siffra och blink kommer när slaget träffar. */
  private beginWrongHurt(): void {
    this.heroFlash = 0;
    this.heroShake = 0;
    const w = this.worldOrNull();
    const m = this.monster;
    const h = w?.hero;
    if (m && h) {
      m.facing = Math.atan2(h.pos.x - m.pos.x, h.pos.y - m.pos.y);
      m.moving = false;
      m.atk = ENEMY_SWING_S;
      m.view.play('attack', true);
    }
  }

  private tickWrongHurt(dt: number): void {
    this.hurtT += dt;
    const m = this.monster;
    if (m && m.atk > 0) m.atk = Math.max(0, m.atk - dt);
    if (!this.hurtLanded && this.hurtT >= HURT_LAND_AT) this.landHurt();
    const h = this.worldOrNull()?.hero;
    if (!h) return;
    if (this.heroFlash > 0) {
      this.heroFlash = Math.max(0, this.heroFlash - dt);
      if (this.heroFlash > 0) this.paintHeroHurt(h);
      else this.clearHeroHurtTint();
    }
    if (this.heroShake > 0) {
      const mag = 18;
      const flip = Math.floor(this.hurtT * 28) % 2 === 0 ? mag : -mag;
      h.view.position.x += flip;
      h.view.position.y += flip > 0 ? -8 : 7;
      this.heroShake = Math.max(0, this.heroShake - dt);
    }
  }

  private landHurt(): void {
    if (this.hurtLanded) return;
    this.hurtLanded = true;
    this.heroShake = Math.max(this.heroShake, HERO_HURT_SHAKE_S);
    this.heroFlash = Math.max(this.heroFlash, HERO_HURT_FLASH_S);
    const w = this.w();
    const h = w.hero;
    const dealt = applyWrongAnswer(h.s.hp, h.stats.maxHp);
    h.s.hp = dealt.hp;
    this.hurtResult = dealt;
    w.fb.float(h.pos, damageLabel(dealt.damage), 'hurt', 100);
    this.paintHeroHurt(h);
  }

  private paintHeroHurt(h: {
    view: { sprite: { tint: number }; applyTint?: (color: number) => void; position: { x: number; y: number } };
  }): void {
    const blink = Math.floor(this.hurtT * 14) % 2 === 0;
    const color = blink ? 0xff2020 : 0xff7070;
    h.view.sprite.tint = color;
    h.view.applyTint?.(color);
  }

  /** Återställer röd blink så hjälten inte blir kvar i skade-tint. */
  private clearHeroHurtTint(): void {
    const h = this.worldOrNull()?.hero;
    if (!h) return;
    h.view.sprite.tint = 0xffffff;
    h.view.applyTint?.(0xffffff);
  }

  private clearMonsterSwing(): void {
    const m = this.monster;
    if (m) m.atk = 0;
  }

  /** Vänta innan nästa fråga. Längre efter fel så skadan hinns ses. */
  private openNextQuestion(): void {
    this.clearMonsterSwing();
    this.restoreHeroBounce();
    this.heroFlash = 0;
    this.clearHeroHurtTint();
    this.heroShake = 0;
    this.hurtResult = null;
    this.index++;
    this.restoreShake();
    this.phase = 'pause';
    this.timer = this.packPause;
    this.overlay.hideQuiz();
    this.ai.paused = true;
  }

  private tickPause(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.showCurrent();
  }

  private fell(m: Monster): void {
    this.combat.kill(m, true);
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
    if (!m) {
      this.shake = 0;
      this.shakeBaseX = null;
      return;
    }
    if (this.shake > 0 && this.shakeBaseX === null) this.shakeBaseX = m.view.position.x;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (this.shakeBaseX === null) return;
    if (this.shake <= 0) {
      m.view.position.x = this.shakeBaseX;
      this.shakeBaseX = null;
      return;
    }
    const mag = this.shake * 22;
    const flip = Math.floor(this.fightT * 40) % 2 === 0 ? mag : -mag;
    m.view.position.x = this.shakeBaseX + flip;
  }

  private restoreShake(): void {
    const m = this.monster;
    if (m && this.shakeBaseX !== null) m.view.position.x = this.shakeBaseX;
    this.shake = 0;
    this.shakeBaseX = null;
  }

  private beginHeroBounce(): void {
    const view = this.worldOrNull()?.hero.view;
    this.heroBounceT = 0;
    this.heroBounceBaseY = view ? view.position.y : null;
    const scale = view?.scale;
    this.heroBounceBaseScale = scale ? { x: scale.x, y: scale.y } : null;
  }

  private tickHeroBounce(dt: number): void {
    if (this.heroBounceT < 0) return;
    this.heroBounceT += dt;
    if (this.heroBounceT >= HERO_BOUNCE_S) {
      this.restoreHeroBounce();
      return;
    }
    this.applyHeroBounce();
  }

  private applyHeroBounce(): void {
    const view = this.worldOrNull()?.hero.view;
    if (!view || this.heroBounceBaseY === null) return;
    const frame = heroBounceFrame(this.heroBounceT / HERO_BOUNCE_S);
    view.position.y = this.heroBounceBaseY - frame.lift;
    const base = this.heroBounceBaseScale;
    const scale = view.scale;
    if (!base || !scale) return;
    const sign = base.x < 0 ? -1 : 1;
    scale.x = sign * Math.abs(base.x) * frame.scale;
    scale.y = base.y * frame.scale;
  }

  private restoreHeroBounce(): void {
    const view = this.worldOrNull()?.hero.view;
    if (view && this.heroBounceBaseY !== null) view.position.y = this.heroBounceBaseY;
    if (view && this.heroBounceBaseScale) {
      view.scale.x = this.heroBounceBaseScale.x;
      view.scale.y = this.heroBounceBaseScale.y;
    }
    this.heroBounceT = -1;
    this.heroBounceBaseY = null;
    this.heroBounceBaseScale = null;
  }

  private endQuiet(): void {
    this.clearMonsterSwing();
    this.restoreShake();
    this.restoreHeroBounce();
    this.heroFlash = 0;
    this.clearHeroHurtTint();
    this.heroShake = 0;
    this.hurtResult = null;
    this.phase = 'idle';
    this.monster = null;
    this.questions = [];
    this.overlay.hideQuiz();
    this.ai.paused = this.settingsOpen;
  }
}

function browserStore(): KeyValueStore {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
      return new LocalStore(globalThis.localStorage);
    }
  } catch {
    /* test utan localStorage */
  }
  return new MemoryStore();
}

function keepsListenText(q: LearnQuestion): boolean {
  return q.subject === 'horforstaelse' || q.hidePassageUntilAnswered === true;
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
