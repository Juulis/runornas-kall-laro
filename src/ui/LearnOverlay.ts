import type { LearnQuestion, LearnSettings } from '../learn/types';
import { buildLearnFields, setLearnFieldValues } from './learnDom';

const CSS = `
#rk-learn-level{position:fixed;left:14px;top:12px;z-index:16;font:18px Cinzel,serif;padding:8px 14px;border-radius:12px;border:2px solid #c7a35a;background:#1a1612;color:#efe7d2;cursor:pointer}
#rk-learn-settings{position:fixed;left:14px;top:58px;z-index:18;width:min(420px,calc(100vw - 28px));padding:16px;border-radius:16px;border:3px solid #c7a35a;background:#1c1612;color:#efe7d2;box-shadow:0 10px 28px #000}
#rk-learn-settings p{margin:8px 0 0;font-size:15px;color:#cbb994}
#rk-learn-settings .learn-setup{justify-content:flex-start}
#rk-learn-settings .learn-setup label{display:flex;flex-direction:column;gap:4px;font:16px Cinzel,serif}
#rk-learn-settings select{font:20px Cinzel,serif;padding:8px 12px;background:#1a1612;color:#efe7d2;border:2px solid #c7a35a;border-radius:8px}
#rk-learn-quiz{position:fixed;inset:0;z-index:35;display:flex;align-items:center;justify-content:center;background:rgba(12,8,6,.72);padding:24px}
#rk-learn-quiz.hidden,#rk-learn-settings.hidden{display:none}
#rk-learn.quiz-open #rk-learn-level,#rk-learn.quiz-open #rk-learn-settings{display:none}
.rk-q-card{width:min(640px,100%);background:#1c1612;border:4px solid #c7a35a;border-radius:18px;padding:28px 24px;box-shadow:0 12px 40px #000}
.rk-q-progress{font-size:18px;color:#e0b060}
.rk-q-prompt{font-size:clamp(26px,4vw,40px);color:#fff8e8;margin:12px 0 20px;line-height:1.25}
.rk-q-choices{display:flex;flex-direction:column;gap:12px}
.rk-q-choices button{font-size:clamp(22px,3vw,32px);padding:14px 16px;width:100%;border-radius:14px;border:3px solid #6b5a3e;background:#2a231c;color:#fff8e8;cursor:pointer;text-align:left}
.rk-q-choices button:hover:not(:disabled){border-color:#e0b060}
.rk-q-choices button:disabled{opacity:.55;cursor:default}
.rk-q-feedback{font-size:clamp(22px,3vw,32px);margin-top:8px}
.rk-q-feedback.bad{color:#ffb089}
`;

/** Frågeruta och nivåknapp. Ingen innerHTML: allt sätts med textContent. */
export class LearnOverlay {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly quiz: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private readonly choiceRow: HTMLDivElement;
  private readonly choices: HTMLButtonElement[] = [];
  private readonly settingsPanel: HTMLDivElement;
  private readonly fields: HTMLDivElement;
  onAnswer: (index: number) => void = () => undefined;
  onToggleSettings: () => void = () => undefined;
  onSettings: (settings: LearnSettings) => void = () => undefined;

  constructor(initial: LearnSettings) {
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
    this.fields = buildLearnFields(initial, (s) => this.onSettings(s));
    const hint = document.createElement('p');
    hint.textContent = 'Gäller nästa monster.';
    this.settingsPanel.append(this.fields, hint);
    this.quiz = document.createElement('div');
    this.quiz.id = 'rk-learn-quiz';
    this.quiz.classList.add('hidden');
    const card = document.createElement('div');
    card.className = 'rk-q-card';
    this.progress = document.createElement('div');
    this.progress.className = 'rk-q-progress';
    this.prompt = document.createElement('div');
    this.prompt.className = 'rk-q-prompt';
    this.choiceRow = document.createElement('div');
    this.choiceRow.className = 'rk-q-choices';
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.disableChoices();
        this.onAnswer(i);
      });
      this.choices.push(btn);
      this.choiceRow.append(btn);
    }
    this.feedback = document.createElement('div');
    this.feedback.className = 'rk-q-feedback bad hidden';
    card.append(this.progress, this.prompt, this.choiceRow, this.feedback);
    this.quiz.append(card);
    this.root.append(levelBtn, this.settingsPanel, this.quiz);
    document.body.append(this.root);
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }

  setSettings(settings: LearnSettings): void {
    setLearnFieldValues(this.fields, settings);
  }

  setSettingsOpen(open: boolean): void {
    this.settingsPanel.classList.toggle('hidden', !open);
  }

  showQuestion(q: LearnQuestion, index: number, total: number): void {
    this.root.classList.add('quiz-open');
    this.quiz.classList.remove('hidden');
    this.progress.textContent = `Fråga ${index + 1} av ${total}`;
    this.prompt.textContent = q.prompt;
    this.feedback.textContent = '';
    this.feedback.classList.add('hidden');
    this.choiceRow.classList.remove('hidden');
    q.choices.forEach((choice, i) => {
      const btn = this.choices[i];
      if (!btn) return;
      btn.textContent = choice;
      btn.disabled = false;
    });
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
    this.quiz.classList.add('hidden');
    this.root.classList.remove('quiz-open');
  }
}
