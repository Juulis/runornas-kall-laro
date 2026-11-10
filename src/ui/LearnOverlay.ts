import { isHardQuestion } from '../learn/hardQuestion';
import { readAloudOf } from '../learn/settings';
import { canSpeak, questionUtterance, speak, cancel } from '../learn/speech';
import type { LearnQuestion, LearnSettings } from '../learn/types';
import { buildLearnFields, setLearnFieldValues } from './learnDom';
import { Scratchpad } from './Scratchpad';

const CSS = `
#rk-learn-level{position:fixed;left:14px;top:12px;z-index:16;font:18px Cinzel,serif;padding:8px 14px;border-radius:12px;border:2px solid #c7a35a;background:#1a1612;color:#efe7d2;cursor:pointer}
#rk-learn-settings{position:fixed;left:14px;top:58px;z-index:18;width:min(420px,calc(100vw - 28px));padding:16px;border-radius:16px;border:3px solid #c7a35a;background:#1c1612;color:#efe7d2;box-shadow:0 10px 28px #000}
#rk-learn-settings p{margin:8px 0 0;font-size:15px;color:#cbb994}
#rk-learn-settings .learn-setup{justify-content:flex-start}
#rk-learn-settings .learn-setup label{display:flex;flex-direction:column;gap:4px;font:16px Cinzel,serif}
#rk-learn-settings .learn-setup label.learn-read{flex-direction:row;align-items:center;gap:8px;font-size:18px}
#rk-learn-settings .learn-setup label.learn-read input{width:22px;height:22px;accent-color:#e0b060}
#rk-learn-settings select{font:20px Cinzel,serif;padding:8px 12px;background:#1a1612;color:#efe7d2;border:2px solid #c7a35a;border-radius:8px}
#rk-learn-settings .learn-links{display:flex;gap:8px;margin-top:12px}
#rk-learn-settings .learn-links button{min-height:44px;font:15px Cinzel,serif;color:#cbb994;background:transparent;border:1px solid #6b5a3e;border-radius:8px;padding:6px 12px;cursor:pointer}
#rk-learn-settings .learn-links button:hover{border-color:#c7a35a;color:#efe7d2}
#rk-learn-settings .learn-links button:focus-visible{outline:3px solid #c7a35a;outline-offset:2px}
#rk-learn-quiz{position:fixed;inset:0;z-index:35;display:flex;align-items:center;justify-content:center;background:rgba(12,8,6,.72);padding:24px}
#rk-learn-quiz.rk-with-scratch{--rk-quiz-pad:16px;align-items:stretch;justify-content:center;overflow:visible;padding:var(--rk-quiz-pad)}
#rk-learn-quiz.hidden,#rk-learn-settings.hidden{display:none}
#rk-learn.quiz-open #rk-learn-level,#rk-learn.quiz-open #rk-learn-settings{display:none}
.rk-q-card{width:min(640px,100%);background:#1c1612;border:4px solid #c7a35a;border-radius:18px;padding:28px 24px;box-shadow:0 12px 40px #000}
.rk-q-card.forskola{width:min(760px,100%);padding:36px 28px}
.rk-q-progress{font-size:18px;color:#e0b060}
.rk-q-passage{font-size:clamp(20px,3vw,28px);color:#e8dcc0;line-height:1.35;margin:12px 0 8px}
.rk-q-card.forskola .rk-q-passage{font-size:clamp(26px,4vw,40px)}
.rk-q-listen{display:block;width:100%;box-sizing:border-box;margin:8px 0 12px;min-height:56px;font-size:clamp(22px,3vw,30px);font-weight:700;letter-spacing:.04em;padding:12px 16px;border-radius:16px;border:4px solid #c7a35a;background:#3a2e18;color:#fff8e8;cursor:pointer}
.rk-q-card.forskola .rk-q-listen{min-height:88px;font-size:clamp(30px,4.4vw,46px);padding:18px;border-radius:18px}
.rk-q-listen:hover:not(:disabled){border-color:#e0b060}
.rk-q-listen:focus-visible{outline:3px solid #e0b060;outline-offset:2px}
.rk-q-listen:disabled{opacity:.55;cursor:default}
.rk-q-listen-hint{margin:8px 0 4px;font-size:clamp(18px,2.4vw,22px);line-height:1.3;color:#e0b060}
.rk-q-card.forskola .rk-q-listen-hint{font-size:clamp(22px,3vw,30px)}
.rk-q-listen-note{margin:8px 0;font-size:clamp(16px,2.2vw,20px);line-height:1.35;color:#cbb994}
.rk-q-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:12px 0 20px}
.rk-q-prompt{font-size:clamp(26px,4vw,40px);color:#fff8e8;margin:0;line-height:1.25}
.rk-q-card.forskola .rk-q-prompt{font-size:clamp(34px,5.2vw,56px)}
.rk-q-eng{display:block;text-align:center;font-size:clamp(40px,6vw,68px);color:#ffe08a;margin:0 0 16px;line-height:1.1}
.rk-q-card.forskola .rk-q-eng{font-size:clamp(48px,7vw,80px)}
.rk-q-eng[hidden],.rk-q-speak[hidden],.rk-q-passage[hidden],.rk-q-listen[hidden],.rk-q-listen-hint[hidden],.rk-q-listen-note[hidden]{display:none}
.rk-q-speak{flex:0 0 auto;font-size:36px;min-width:72px;min-height:72px;border-radius:18px;border:3px solid #c7a35a;background:#3a2e18;color:#fff8e8;cursor:pointer}
.rk-q-card.forskola .rk-q-speak{font-size:48px;min-width:88px;min-height:88px}
.rk-q-speak:hover{border-color:#e0b060}
.rk-q-choices{display:flex;flex-direction:column;gap:12px}
.rk-q-card.forskola .rk-q-choices{gap:16px}
.rk-q-choices button{font-size:clamp(22px,3vw,32px);padding:14px 16px;width:100%;border-radius:14px;border:3px solid #6b5a3e;background:#2a231c;color:#fff8e8;cursor:pointer;text-align:left}
.rk-q-card.forskola .rk-q-choices button{font-size:clamp(30px,4.4vw,46px);padding:20px 18px;border-radius:18px;border-width:4px}
.rk-q-choices button:hover:not(:disabled){border-color:#e0b060}
.rk-q-choices button.selected{border-color:#ffe08a;background:#5a4320;color:#fff;box-shadow:0 0 0 4px #e0b060;transform:scale(1.04)}
.rk-q-card.forskola .rk-q-choices button.selected{border-width:6px;padding:24px 20px;font-size:clamp(34px,5vw,52px)}
.rk-q-choices button.correct{border-color:#178a38;background:#2fbf55;color:#fff;box-shadow:0 0 0 6px #b6ff9c;transform:scale(1.08);opacity:1}
.rk-q-choices button.wrong{border-color:#c62828;background:#8f2d24;color:#fff8f6;box-shadow:0 0 0 5px #ffb0a4;opacity:1}
.rk-q-choices button:disabled{opacity:.55;cursor:default}
.rk-q-choices button.correct:disabled,.rk-q-choices button.wrong:disabled{opacity:1;cursor:default}
.rk-q-card.forskola .rk-q-choices button.correct{border-width:7px;font-size:clamp(36px,5.2vw,56px);padding:22px 18px}
.rk-q-submit{display:block;width:100%;margin-top:18px;font-size:clamp(28px,4vw,42px);font-weight:700;letter-spacing:.06em;padding:18px 16px;border-radius:18px;border:4px solid #6a5a40;background:#2c261e;color:#b5a48c;cursor:pointer}
.rk-q-submit:disabled{opacity:.5;cursor:default}
.rk-q-submit:not(:disabled){background:#2f6b3a;border-color:#8dff9a;color:#fff8e8}
.rk-q-card.forskola .rk-q-submit{font-size:clamp(40px,6vw,64px);padding:26px 18px;min-height:96px;border-width:5px;border-radius:22px}
.rk-q-choices.hidden,.rk-q-submit.hidden,.rk-q-feedback.hidden{display:none}
.rk-q-feedback{font-size:clamp(22px,3vw,32px);margin-top:8px}
.rk-q-card.forskola .rk-q-feedback{font-size:clamp(28px,4vw,40px)}
.rk-q-feedback.bad{color:#ffb089}
.rk-q-layout{display:flex;align-items:flex-start;justify-content:center;gap:16px;width:100%;min-width:0;box-sizing:border-box}
.rk-q-layout>.rk-q-card{min-width:0}
#rk-learn-quiz.rk-with-scratch>.rk-q-layout{flex:1 1 auto;align-items:stretch;width:100%;height:calc(100vh - 2 * var(--rk-quiz-pad));max-height:calc(100vh - 2 * var(--rk-quiz-pad));min-height:0}
#rk-learn-quiz.rk-with-scratch .rk-q-layout>.rk-q-card{box-sizing:border-box;flex:1 1 0;width:auto;max-width:none;min-width:0;height:auto;max-height:100%;align-self:center}
#rk-learn-quiz.rk-with-scratch .rk-q-layout>.rk-scratch{box-sizing:border-box;flex:1 1 0;width:auto;max-width:none;min-width:0;height:calc(100vh - 2 * var(--rk-quiz-pad));max-height:calc(100vh - 2 * var(--rk-quiz-pad));align-self:stretch}
@media (min-width:1001px){
  #rk-learn-quiz.rk-with-scratch .rk-q-card{padding:16px 16px}
  #rk-learn-quiz.rk-with-scratch .rk-q-head{margin:6px 0 10px}
  #rk-learn-quiz.rk-with-scratch .rk-q-prompt{font-size:clamp(22px,2.2vw,32px)}
  #rk-learn-quiz.rk-with-scratch .rk-q-speak{font-size:28px;min-width:52px;min-height:52px}
  #rk-learn-quiz.rk-with-scratch .rk-q-choices{gap:8px}
  #rk-learn-quiz.rk-with-scratch .rk-q-choices button{font-size:clamp(18px,2vw,26px);padding:10px 12px}
  #rk-learn-quiz.rk-with-scratch .rk-q-submit{font-size:clamp(22px,2.6vw,34px);padding:12px 14px;margin-top:10px}
}
@media (max-width:1000px){
  #rk-learn-quiz.rk-with-scratch{align-items:flex-start;justify-content:flex-start;overflow:auto;padding:12px}
  #rk-learn-quiz.rk-with-scratch>.rk-q-layout{flex:0 0 auto;flex-direction:column;align-items:stretch;height:auto;max-height:none}
  #rk-learn-quiz.rk-with-scratch .rk-q-layout>.rk-q-card{flex:0 0 auto;width:100%;max-width:100%;max-height:none;align-self:stretch}
  #rk-learn-quiz.rk-with-scratch .rk-q-layout>.rk-scratch{flex:0 0 auto;width:100%;max-width:100%;height:auto;max-height:none}
  .rk-q-layout{flex-direction:column;align-items:stretch}
}
`;

const NO_AUDIO_NOTE = 'Din webbläsare kan inte läsa upp ljud, så texten visas i stället.';
const LISTEN_HINT = 'Lyssna på texten och svara på frågan.';

function hidesPassage(q: LearnQuestion): boolean {
  return q.subject === 'horforstaelse' || q.hidePassageUntilAnswered === true;
}

function passageLang(q: LearnQuestion): 'sv' | 'en' {
  if (q.speakLang === 'en-US' || q.speakLang === 'en-GB') return 'en';
  return 'sv';
}

/** Frågeruta och nivåknapp. Ingen innerHTML: allt sätts med textContent. */
export class LearnOverlay {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly quiz: HTMLDivElement;
  private readonly layout: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly scratch: Scratchpad;
  private readonly progress: HTMLDivElement;
  private readonly passage: HTMLDivElement;
  private readonly listenHint: HTMLParagraphElement;
  private readonly listenNote: HTMLParagraphElement;
  private readonly listenBtn: HTMLButtonElement;
  private readonly prompt: HTMLDivElement;
  private readonly engWord: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private readonly choiceRow: HTMLDivElement;
  private readonly speakBtn: HTMLButtonElement;
  private readonly choices: HTMLButtonElement[] = [];
  private readonly submitBtn: HTMLButtonElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly fields: HTMLDivElement;
  private settings: LearnSettings;
  private current: LearnQuestion | null = null;
  private selectedIndex = -1;
  onAnswer: (index: number) => void = () => undefined;
  onToggleSettings: () => void = () => undefined;
  onSettings: (settings: LearnSettings) => void = () => undefined;
  onOpenAlbum: () => void = () => undefined;
  onOpenParent: () => void = () => undefined;

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
    const links = document.createElement('div');
    links.className = 'learn-links';
    const albumBtn = document.createElement('button');
    albumBtn.type = 'button';
    albumBtn.textContent = 'Samling';
    albumBtn.addEventListener('click', () => this.onOpenAlbum());
    const parentBtn = document.createElement('button');
    parentBtn.type = 'button';
    parentBtn.textContent = 'Förälder';
    parentBtn.addEventListener('click', () => this.onOpenParent());
    links.append(albumBtn, parentBtn);
    this.settingsPanel.append(this.fields, hint, links);
    this.quiz = document.createElement('div');
    this.quiz.id = 'rk-learn-quiz';
    this.quiz.classList.add('hidden');
    this.card = document.createElement('div');
    this.card.className = 'rk-q-card';
    this.progress = document.createElement('div');
    this.progress.className = 'rk-q-progress';
    this.passage = document.createElement('div');
    this.passage.className = 'rk-q-passage';
    this.passage.hidden = true;
    this.listenHint = document.createElement('p');
    this.listenHint.className = 'rk-q-listen-hint';
    this.listenHint.hidden = true;
    this.listenNote = document.createElement('p');
    this.listenNote.className = 'rk-q-listen-note';
    this.listenNote.hidden = true;
    this.listenBtn = document.createElement('button');
    this.listenBtn.type = 'button';
    this.listenBtn.className = 'rk-q-listen';
    this.listenBtn.hidden = true;
    this.setListenLabel('Lyssna');
    this.listenBtn.addEventListener('click', () => this.onListen());
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
    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.className = 'rk-q-submit';
    this.submitBtn.textContent = 'SVARA';
    this.submitBtn.disabled = true;
    this.submitBtn.addEventListener('click', () => {
      if (this.submitBtn.disabled || this.selectedIndex < 0) return;
      const index = this.selectedIndex;
      this.disableChoices();
      this.onAnswer(index);
    });
    this.feedback = document.createElement('div');
    this.feedback.className = 'rk-q-feedback bad hidden';
    this.card.append(
      this.progress,
      this.listenHint,
      this.listenNote,
      this.listenBtn,
      this.passage,
      head,
      this.engWord,
      this.choiceRow,
      this.submitBtn,
      this.feedback,
    );
    this.layout = document.createElement('div');
    this.layout.className = 'rk-q-layout';
    this.scratch = new Scratchpad();
    this.scratch.setVisible(false);
    this.layout.append(this.card, this.scratch.root);
    this.quiz.append(this.layout);
    this.root.append(levelBtn, this.settingsPanel, this.quiz);
    document.body.append(this.root);
  }

  dispose(): void {
    cancel();
    this.scratch.dispose();
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
    this.current = q;
    this.selectedIndex = -1;
    this.root.classList.add('quiz-open');
    this.quiz.classList.remove('hidden');
    this.card.classList.toggle('forskola', q.grade === 'forskola');
    this.progress.textContent = `Fråga ${index + 1} av ${total}`;
    const listening = hidesPassage(q);
    const passage = q.passage?.trim() ?? '';
    if (listening && !canSpeak()) {
      this.fillPassage(q, passage);
      this.listenHint.hidden = true;
      this.listenHint.textContent = '';
      this.listenNote.hidden = false;
      this.listenNote.textContent = NO_AUDIO_NOTE;
      this.listenBtn.hidden = true;
      this.listenBtn.disabled = true;
    } else if (listening) {
      this.fillPassage(q, '');
      this.listenHint.hidden = false;
      this.listenHint.textContent = LISTEN_HINT;
      this.listenNote.hidden = true;
      this.listenNote.textContent = '';
      this.listenBtn.hidden = false;
      this.listenBtn.disabled = false;
      this.setListenLabel('Lyssna');
    } else {
      this.fillPassage(q, passage);
      this.listenHint.hidden = true;
      this.listenHint.textContent = '';
      this.listenNote.hidden = true;
      this.listenNote.textContent = '';
      this.listenBtn.hidden = true;
      this.listenBtn.disabled = false;
      this.setListenLabel('Lyssna');
    }
    this.prompt.textContent = q.prompt;
    const showEng = !listening && (q.speakLang === 'en-US' || q.speakLang === 'en-GB');
    const eng = showEng ? (q.speakText ?? '') : '';
    this.engWord.textContent = eng;
    this.engWord.hidden = !eng;
    this.feedback.textContent = '';
    this.feedback.classList.add('hidden');
    this.choiceRow.classList.remove('hidden');
    this.submitBtn.classList.remove('hidden');
    this.submitBtn.disabled = true;
    const showSpeaker = !listening && (q.grade === 'forskola' || readAloudOf(this.settings));
    this.speakBtn.hidden = !showSpeaker;
    q.choices.forEach((choice, i) => {
      const btn = this.choices[i];
      if (!btn) return;
      btn.textContent = choice;
      btn.disabled = false;
      btn.classList.remove('selected', 'correct', 'wrong');
      btn.setAttribute('aria-pressed', 'false');
    });
    // Frågan läses aldrig upp av sig själv (#24). Lyssna-knappen eller högtalaren läser när barnet trycker.
    const hard = isHardQuestion(q);
    this.quiz.classList.toggle('rk-with-scratch', hard);
    this.scratch.clear();
    this.scratch.setVisible(hard);
  }

  /** Visar lyssningstexten efter svar. Hjälptexten tas bort så den inte ligger kvar bredvid texten. */
  revealPassage(): void {
    const q = this.current;
    if (!q) return;
    this.fillPassage(q, q.passage?.trim() ?? '');
    this.listenHint.hidden = true;
    this.listenHint.textContent = '';
  }

  /** Rätt svar på hörförståelse: texten visas och det rätta valet markeras innan striden. */
  showCorrect(q: LearnQuestion): void {
    this.current = q;
    this.disableChoices();
    this.choices.forEach((btn, i) => {
      btn.classList.toggle('correct', i === q.correctIndex);
      btn.classList.remove('selected', 'wrong');
    });
    this.revealPassage();
  }

  /** Fel svar: valen stannar kvar och rätt alternativ blir grönt. Inget tal, bara ljudknappen eller Lyssna. */
  showWrong(q: LearnQuestion, chosenIndex: number): void {
    this.current = q;
    this.disableChoices();
    this.revealPassage();
    this.feedback.classList.remove('hidden');
    this.feedback.textContent = `Rätt svar var: ${q.answer}`;
    this.choices.forEach((btn, i) => {
      const correct = i === q.correctIndex;
      btn.classList.toggle('correct', correct);
      btn.classList.toggle('wrong', i === chosenIndex && !correct);
      btn.classList.remove('selected');
    });
  }

  /** Punkt nära frågekortet, så en senare stjärna kan flyga därifrån. */
  celebratePoint(): { x: number; y: number } {
    const rect = this.card.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const w = typeof window === 'undefined' ? 0 : window.innerWidth;
    const h = typeof window === 'undefined' ? 0 : window.innerHeight;
    if (w > 0 || h > 0) return { x: w / 2, y: h * 0.4 };
    return { x: 0, y: 0 };
  }

  disableChoices(): void {
    for (const btn of this.choices) btn.disabled = true;
    this.submitBtn.disabled = true;
  }

  hideQuiz(): void {
    cancel();
    this.current = null;
    this.selectedIndex = -1;
    this.quiz.classList.add('hidden');
    this.root.classList.remove('quiz-open');
  }

  private fillPassage(q: LearnQuestion, passage: string): void {
    this.passage.textContent = passage;
    this.passage.hidden = passage.length === 0;
    if (passage) this.passage.lang = passageLang(q);
    else this.passage.removeAttribute('lang');
  }

  private setListenLabel(label: 'Lyssna' | 'Lyssna igen'): void {
    this.listenBtn.textContent = label;
    this.listenBtn.setAttribute('aria-label', label);
  }

  private onListen(): void {
    const q = this.current;
    if (!q || this.listenBtn.disabled || this.listenBtn.hidden) return;
    this.readQuestion(q);
    this.setListenLabel('Lyssna igen');
  }

  private readQuestion(q: LearnQuestion): void {
    const uttered = questionUtterance(q);
    speak(uttered.text, uttered.lang);
  }

  /** Markerar valet tyst. Tal kommer bara från ljudknappen eller Lyssna. */
  private selectChoice(index: number): void {
    const btn = this.choices[index];
    if (!btn || btn.disabled) return;
    this.selectedIndex = index;
    this.choices.forEach((choice, i) => {
      const on = i === index;
      choice.classList.toggle('selected', on);
      choice.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.submitBtn.disabled = false;
  }

  private bindChoice(btn: HTMLButtonElement, index: number): void {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.selectChoice(index);
    });
  }
}
