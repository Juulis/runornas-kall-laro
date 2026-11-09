import { readAloudOf } from '../learn/settings';
import { questionUtterance, speak, cancel } from '../learn/speech';
import type { LearnQuestion, LearnSettings } from '../learn/types';
import { buildLearnFields, setLearnFieldValues } from './learnDom';

const CSS = `
#rk-learn-level{position:fixed;left:14px;top:12px;z-index:16;font:18px Cinzel,serif;padding:8px 14px;border-radius:12px;border:2px solid #c7a35a;background:#1a1612;color:#efe7d2;cursor:pointer}
#rk-learn-settings{position:fixed;left:14px;top:58px;z-index:18;width:min(420px,calc(100vw - 28px));padding:16px;border-radius:16px;border:3px solid #c7a35a;background:#1c1612;color:#efe7d2;box-shadow:0 10px 28px #000}
#rk-learn-settings p{margin:8px 0 0;font-size:15px;color:#cbb994}
#rk-learn-settings .learn-setup{justify-content:flex-start}
#rk-learn-settings .learn-setup label{display:flex;flex-direction:column;gap:4px;font:16px Cinzel,serif}
#rk-learn-settings .learn-setup label.learn-read{flex-direction:row;align-items:center;gap:8px;font-size:18px}
#rk-learn-settings .learn-setup label.learn-read input{width:22px;height:22px;accent-color:#e0b060}
#rk-learn-settings select{font:20px Cinzel,serif;padding:8px 12px;background:#1a1612;color:#efe7d2;border:2px solid #c7a35a;border-radius:8px}
#rk-learn-quiz{position:fixed;inset:0;z-index:35;display:flex;align-items:center;justify-content:center;background:rgba(12,8,6,.72);padding:24px}
#rk-learn-quiz.hidden,#rk-learn-settings.hidden{display:none}
#rk-learn.quiz-open #rk-learn-level,#rk-learn.quiz-open #rk-learn-settings{display:none}
.rk-q-card{width:min(640px,100%);background:#1c1612;border:4px solid #c7a35a;border-radius:18px;padding:28px 24px;box-shadow:0 12px 40px #000}
.rk-q-card.forskola{width:min(760px,100%);padding:36px 28px}
.rk-q-progress{font-size:18px;color:#e0b060}
.rk-q-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:12px 0 20px}
.rk-q-prompt{font-size:clamp(26px,4vw,40px);color:#fff8e8;margin:0;line-height:1.25}
.rk-q-card.forskola .rk-q-prompt{font-size:clamp(34px,5.2vw,56px)}
.rk-q-eng{display:block;text-align:center;font-size:clamp(40px,6vw,68px);color:#ffe08a;margin:0 0 16px;line-height:1.1}
.rk-q-card.forskola .rk-q-eng{font-size:clamp(48px,7vw,80px)}
.rk-q-eng[hidden],.rk-q-speak[hidden]{display:none}
.rk-q-speak{flex:0 0 auto;font-size:36px;min-width:72px;min-height:72px;border-radius:18px;border:3px solid #c7a35a;background:#3a2e18;color:#fff8e8;cursor:pointer}
.rk-q-card.forskola .rk-q-speak{font-size:48px;min-width:88px;min-height:88px}
.rk-q-speak:hover{border-color:#e0b060}
.rk-q-choices{display:flex;flex-direction:column;gap:12px}
.rk-q-card.forskola .rk-q-choices{gap:16px}
.rk-q-choices button{font-size:clamp(22px,3vw,32px);padding:14px 16px;width:100%;border-radius:14px;border:3px solid #6b5a3e;background:#2a231c;color:#fff8e8;cursor:pointer;text-align:left}
.rk-q-card.forskola .rk-q-choices button{font-size:clamp(30px,4.4vw,46px);padding:20px 18px;border-radius:18px;border-width:4px}
.rk-q-choices button:hover:not(:disabled){border-color:#e0b060}
.rk-q-choices button:disabled{opacity:.55;cursor:default}
.rk-q-feedback{font-size:clamp(22px,3vw,32px);margin-top:8px}
.rk-q-card.forskola .rk-q-feedback{font-size:clamp(28px,4vw,40px)}
.rk-q-feedback.bad{color:#ffb089}
`;

/** Frågeruta och nivåknapp. Ingen innerHTML: allt sätts med textContent. */
export class LearnOverlay {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly quiz: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly engWord: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private readonly choiceRow: HTMLDivElement;
  private readonly speakBtn: HTMLButtonElement;
  private readonly choices: HTMLButtonElement[] = [];
  private readonly settingsPanel: HTMLDivElement;
  private readonly fields: HTMLDivElement;
  private settings: LearnSettings;
  private current: LearnQuestion | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClick = false;
  onAnswer: (index: number) => void = () => undefined;
  onToggleSettings: () => void = () => undefined;
  onSettings: (settings: LearnSettings) => void = () => undefined;

  constructor(initial: LearnSettings) {
    this.settings = { grade: initial.grade, subject: initial.subject, readAloud: readAloudOf(initial) };
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.id = 'rk-learn';
    const levelBtn = document.createElement('button');
    levelBtn.id = 'rk-learn-level';
    levelBtn.type = 'button';
    levelBtn.textContent = 'Nivå';
    levelBtn.addEventListener('click', () => this.onToggleSettings());
    this.settingsPanel = document.createElement('div');
    this.settingsPanel.id = 'rk-learn-settings';
    this.settingsPanel.classList.add('hidden');
    this.fields = buildLearnFields(initial, (s) => {
      this.settings = { grade: s.grade, subject: s.subject, readAloud: readAloudOf(s) };
      this.onSettings(s);
    });
    const hint = document.createElement('p');
    hint.textContent = 'Gäller nästa monster.';
    this.settingsPanel.append(this.fields, hint);
    this.quiz = document.createElement('div');
    this.quiz.id = 'rk-learn-quiz';
    this.quiz.classList.add('hidden');
    this.card = document.createElement('div');
    this.card.className = 'rk-q-card';
    this.progress = document.createElement('div');
    this.progress.className = 'rk-q-progress';
    const head = document.createElement('div');
    head.className = 'rk-q-head';
    this.prompt = document.createElement('div');
    this.prompt.className = 'rk-q-prompt';
    this.speakBtn = document.createElement('button');
    this.speakBtn.type = 'button';
    this.speakBtn.className = 'rk-q-speak';
    this.speakBtn.setAttribute('aria-label', 'Läs upp');
    this.speakBtn.textContent = '🔊';
    this.speakBtn.hidden = true;
    this.speakBtn.addEventListener('click', () => {
      if (this.current) this.readQuestion(this.current);
    });
    head.append(this.prompt, this.speakBtn);
    this.engWord = document.createElement('div');
    this.engWord.className = 'rk-q-eng';
    this.engWord.lang = 'en';
    this.engWord.hidden = true;
    this.choiceRow = document.createElement('div');
    this.choiceRow.className = 'rk-q-choices';
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      this.bindChoice(btn, i);
      this.choices.push(btn);
      this.choiceRow.append(btn);
    }
    this.feedback = document.createElement('div');
    this.feedback.className = 'rk-q-feedback bad hidden';
    this.card.append(this.progress, head, this.engWord, this.choiceRow, this.feedback);
    this.quiz.append(this.card);
    this.root.append(levelBtn, this.settingsPanel, this.quiz);
    document.body.append(this.root);
  }

  dispose(): void {
    this.clearPress();
    cancel();
    this.root.remove();
    this.style.remove();
  }

  setSettings(settings: LearnSettings): void {
    this.settings = { grade: settings.grade, subject: settings.subject, readAloud: readAloudOf(settings) };
    setLearnFieldValues(this.fields, this.settings);
  }

  setSettingsOpen(open: boolean): void {
    this.settingsPanel.classList.toggle('hidden', !open);
  }

  showQuestion(q: LearnQuestion, index: number, total: number): void {
    this.clearPress();
    this.current = q;
    this.root.classList.add('quiz-open');
    this.quiz.classList.remove('hidden');
    this.card.classList.toggle('forskola', q.grade === 'forskola');
    this.progress.textContent = `Fråga ${index + 1} av ${total}`;
    this.prompt.textContent = q.prompt;
    const eng = q.speakLang === 'en-US' || q.speakLang === 'en-GB' ? (q.speakText ?? '') : '';
    this.engWord.textContent = eng;
    this.engWord.hidden = !eng;
    this.feedback.textContent = '';
    this.feedback.classList.add('hidden');
    this.choiceRow.classList.remove('hidden');
    const showSpeaker = q.grade === 'forskola' || readAloudOf(this.settings);
    this.speakBtn.hidden = !showSpeaker;
    q.choices.forEach((choice, i) => {
      const btn = this.choices[i];
      if (!btn) return;
      btn.textContent = choice;
      btn.disabled = false;
    });
    if (readAloudOf(this.settings)) this.readQuestion(q);
  }

  showWrong(answer: string): void {
    this.disableChoices();
    this.choiceRow.classList.add('hidden');
    this.feedback.classList.remove('hidden');
    this.feedback.textContent = `Rätt svar var: ${answer}`;
  }

  disableChoices(): void {
    for (const btn of this.choices) btn.disabled = true;
  }

  hideQuiz(): void {
    this.clearPress();
    cancel();
    this.current = null;
    this.quiz.classList.add('hidden');
    this.root.classList.remove('quiz-open');
  }

  private readQuestion(q: LearnQuestion): void {
    const uttered = questionUtterance(q);
    speak(uttered.text, uttered.lang);
  }

  private speakChoice(index: number): void {
    const q = this.current;
    if (!q || (q.grade !== 'forskola' && !readAloudOf(this.settings))) return;
    const choice = q.choices[index];
    if (!choice) return;
    const emoji = q.choiceEmojis?.[index];
    const text = emoji && choice.startsWith(emoji) ? choice.slice(emoji.length).trim() : choice;
    if (!text) return;
    speak(text, 'sv-SE');
  }

  private bindChoice(btn: HTMLButtonElement, index: number): void {
    btn.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType === 'touch') return;
      this.speakChoice(index);
    });
    btn.addEventListener('pointerdown', () => {
      this.clearPress();
      this.suppressClick = false;
      this.pressTimer = setTimeout(() => {
        this.suppressClick = true;
        this.speakChoice(index);
      }, 450);
    });
    const end = (): void => this.clearPress();
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      if (btn.disabled) return;
      this.disableChoices();
      this.onAnswer(index);
    });
  }

  private clearPress(): void {
    if (this.pressTimer === null) return;
    clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }
}
