import type { KeyValueStore } from '../core/storage';
import { cryptoSeed } from '../core/entropy';
import { Rng } from '../core/Rng';
import { el } from '../menu/dom';
import { GRADES, isGradeId } from '../learn/types';
import { REWARD_SUBJECTS, isRewardSubject, loadRewards, resetRewards, type RewardState, type RewardSubject } from '../learn/rewards';
import {
  avgSecondsLabel,
  formatLearnTime,
  hardestTypes,
  loadStats,
  percentCorrect,
  resetStats,
  type DayStat,
  type LearnStats,
} from '../learn/stats';
import { formatStockholmStamp, recentStockholmDates, weekdayLetter } from '../learn/stockholm';

const CSS = `
.rk-parent{position:fixed;inset:0;z-index:70;overflow:auto;background:#f7f1e4;color:#2a241c;font:500 15px/1.35 Nunito,"Segoe UI",sans-serif;padding:28px 32px 48px}
.rk-parent.is-hidden{display:none}
.rk-parent-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.rk-parent h1{display:flex;align-items:center;gap:8px;margin:0;font:800 28px/1.2 Nunito,sans-serif}
.rk-parent h2{margin:0 0 10px;font:800 20px/1.25 Nunito,sans-serif}
.rk-parent .runa{font:700 22px Cinzel,serif;color:#4a6a7a}
.rk-parent .muted{color:#6b5e4e;margin:4px 0 0}
.rk-parent button,.rk-parent input,.rk-parent select{font:700 15px/1.35 Nunito,"Segoe UI",sans-serif;color:#2a241c}
.rk-parent button{min-height:44px;border-radius:12px;border:2px solid #c7a35a;background:#fffdf8;padding:8px 14px;cursor:pointer}
.rk-parent button.primary{background:#f2c46b;border-color:#c7a35a}
.rk-parent button:focus-visible,.rk-parent input:focus-visible,.rk-parent select:focus-visible{outline:3px solid #c7a35a;outline-offset:2px}
.rk-parent input,.rk-parent select{min-height:44px;border-radius:12px;border:2px solid #e5d6b8;background:#fffdf8;padding:8px 12px}
.rk-parent-body{display:flex;flex-direction:column;gap:16px;max-width:960px}
.rk-card{background:#fffdf8;border:2px solid #e5d6b8;border-radius:18px;padding:14px 16px;box-shadow:0 8px 24px rgba(42,36,28,.12)}
.rk-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.rk-overview .rk-card b{display:block;font:800 18px/1.2 Nunito,sans-serif;margin-top:4px}
.rk-subjects{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.rk-amne-head{display:flex;align-items:center;gap:8px}
.rk-amne-head h2{margin:0;flex:1}
.rk-prick{width:14px;height:14px;border-radius:50%;flex:0 0 auto}
.rk-pct{font:800 18px Nunito,sans-serif}
.rk-bar-row{display:flex;align-items:center;gap:8px;margin:8px 0}
.rk-bar{flex:1;display:flex;height:22px;border-radius:12px;overflow:hidden;background:#f7f1e4}
.rk-bar-ok{background:#3d8b6e;height:100%}
.rk-bar-bad{background:#c45a4a;height:100%}
.rk-bar-label{white-space:nowrap;color:#6b5e4e}
.rk-gate{max-width:420px}
.rk-gate .sum{font:800 28px Nunito,sans-serif;margin:8px 0}
.rk-error{color:#c45a4a;min-height:1.2em}
.rk-hard ol{margin:8px 0 0;padding-left:1.2em}
.rk-hard li{margin:8px 0}
.rk-hard small{display:block;color:#6b5e4e}
.rk-days-chart{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:4px;align-items:end;height:96px;margin-top:8px}
.rk-day{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.rk-day i{display:block;width:100%;max-width:18px;background:#f2c46b;border-radius:6px 6px 2px 2px;border:1px solid #c7a35a}
.rk-day span{font-size:12px;color:#6b5e4e}
.rk-days table{width:100%;border-collapse:collapse;margin-top:12px}
.rk-days th,.rk-days td{text-align:left;padding:6px 4px;border-bottom:1px solid #e5d6b8}
.rk-check{display:flex;align-items:center;gap:8px;min-height:44px}
.rk-actions{display:flex;flex-wrap:wrap;gap:8px}
@media (max-width:720px){
  .rk-parent{padding:16px 16px 32px}
  .rk-parent h1{font-size:22px}
  .rk-parent h2{font-size:16px}
  .rk-days thead{display:none}
  .rk-days tr{display:block;margin:0 0 8px;padding:8px;border:2px solid #e5d6b8;border-radius:12px}
  .rk-days td{display:flex;justify-content:space-between;gap:8px;border:0;padding:2px 0}
  .rk-days td::before{content:attr(data-label);color:#6b5e4e}
}
`;

const SUBJECT_COLOR: Record<RewardSubject, string> = {
  matte: '#3d8b6e',
  svenska: '#c46a3a',
  engelska: '#4a6a7a',
  lasforstaelse: '#7a5ca8',
};

const GRADE_ORDER = new Map<string, number>(GRADES.map((g, i) => [g.id, i]));
const SUBJECT_ORDER = new Map<string, number>(REWARD_SUBJECTS.map((s, i) => [s, i]));

export interface ParentHooks {
  onDirty?: () => void;
  onClose?: () => void;
}

function unref(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
}

function subjectLabel(id: string): string {
  if (id === 'lasforstaelse') return 'Läsförståelse';
  if (id === 'matte') return 'Matte';
  if (id === 'svenska') return 'Svenska';
  if (id === 'engelska') return 'Engelska';
  return id;
}

function gradeLabel(id: string): string {
  return GRADES.find((g) => g.id === id)?.label ?? id;
}

function shortDate(iso: string): string {
  const dt = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' }).format(dt);
}

/** Föräldraspärr och lokal statistik. Ingen data lämnar enheten. */
export class ParentView {
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly style: HTMLStyleElement;
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private opened = false;
  private misses = 0;
  private lockedUntil = 0;
  private a = 6;
  private b = 6;
  private gateMode: 'enter' | 'reset' = 'enter';
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hardest: RewardSubject | 'alla' = 'alla';
  private banner = '';

  constructor(
    private readonly store: KeyValueStore,
    private readonly hooks: ParentHooks = {},
    rng?: Rng,
    now?: () => number,
  ) {
    this.rng = rng ?? new Rng(cryptoSeed());
    this.now = now ?? (() => Date.now());
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.root = el('div', {
      class: 'rk-parent is-hidden',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'rk-parent-title',
    });
    const title = el(
      'h1',
      { id: 'rk-parent-title' },
      el('span', { class: 'runa', 'aria-hidden': 'true', text: 'ᚱ' }),
      el('span', { text: 'Förälder' }),
    );
    const close = el('button', { type: 'button', text: 'Stäng' });
    close.addEventListener('click', () => this.close());
    const head = el(
      'header',
      { class: 'rk-parent-head' },
      el('div', {}, title, el('p', { class: 'muted', text: 'Allt stannar på den här enheten.' })),
      close,
    );
    this.body = el('div', { class: 'rk-parent-body' });
    this.root.append(head, this.body);
    document.body.append(this.root);
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.banner = '';
    this.root.classList.remove('is-hidden');
    if (this.now() < this.lockedUntil) this.renderCooldown();
    else this.renderGate('enter');
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.clearTick();
    this.root.classList.add('is-hidden');
    this.hooks.onClose?.();
  }

  dispose(): void {
    this.opened = false;
    this.clearTick();
    this.root.remove();
    this.style.remove();
  }

  private clearTick(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private roll(): void {
    this.a = this.rng.int([6, 9]);
    this.b = this.rng.int([6, 9]);
  }

  private renderCooldown(): void {
    const left = Math.max(0, Math.ceil((this.lockedUntil - this.now()) / 1000));
    const card = el(
      'section',
      { class: 'rk-card rk-gate' },
      el('h2', { text: 'Vänta en stund' }),
      el('p', { text: `För många fel. Ny chans om ${left} sekunder.` }),
    );
    this.body.replaceChildren(card);
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      if (!this.opened) return;
      if (this.now() >= this.lockedUntil) {
        this.renderGate('enter');
        return;
      }
      this.renderCooldown();
    }, 1000);
    unref(this.tickTimer);
  }

  private renderGate(mode: 'enter' | 'reset', error = ''): void {
    this.clearTick();
    this.gateMode = mode;
    this.roll();
    const title = mode === 'reset' ? 'Nollställ statistik' : 'För vuxna';
    const lead = mode === 'reset' ? 'Svara först, sedan kan du nollställa.' : 'En vuxen får öppna den här sidan.';
    const input = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Svar' }) as HTMLInputElement;
    const err = el('p', { class: 'rk-error', role: 'alert', text: error });
    const submit = el('button', { type: 'button', class: 'primary', text: 'Svara' });
    const send = (): void => this.submitGate(input.value);
    submit.addEventListener('click', send);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') send();
    });
    const card = el(
      'section',
      { class: 'rk-card rk-gate' },
      el('h2', { text: title }),
      el('p', { text: lead }),
      el('p', { class: 'sum', text: `Vad är ${this.a} × ${this.b}?` }),
      el('p', { class: 'muted', text: `Försök ${this.misses + 1} av 3` }),
      input,
      err,
      submit,
    );
    this.body.replaceChildren(card);
    input.focus();
  }

  private submitGate(raw: string): void {
    const n = Number(raw.trim().replace(',', '.'));
    if (Number.isInteger(n) && n === this.a * this.b) {
      this.misses = 0;
      if (this.gateMode === 'reset') this.renderResetForm();
      else this.renderDash();
      return;
    }
    this.misses += 1;
    if (this.misses >= 3) {
      this.misses = 0;
      this.lockedUntil = this.now() + 30_000;
      this.close();
      return;
    }
    this.renderGate(this.gateMode, `Fel svar. ${3 - this.misses} försök kvar.`);
  }

  private renderResetForm(error = '', draft = '', alsoRewards = false): void {
    this.clearTick();
    const input = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Skriv NOLLSTÄLL' }) as HTMLInputElement;
    input.value = draft;
    const box = el('input', { type: 'checkbox' }) as HTMLInputElement;
    box.checked = alsoRewards;
    const err = el('p', { class: 'rk-error', role: 'alert', text: error });
    const go = el('button', { type: 'button', class: 'primary', text: 'Nollställ' });
    const back = el('button', { type: 'button', text: 'Avbryt' });
    const run = (): void => this.confirmReset(input.value, box.checked);
    go.addEventListener('click', run);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') run();
    });
    back.addEventListener('click', () => this.renderDash());
    const card = el(
      'section',
      { class: 'rk-card rk-gate' },
      el('h2', { text: 'Nollställ statistik' }),
      el('p', { text: 'Skriv NOLLSTÄLL för att tömma statistiken.' }),
      input,
      el('label', { class: 'rk-check' }, box, el('span', { text: 'Nollställ även stjärnor och klistermärken' })),
      el('p', { class: 'muted', text: 'Om du inte kryssar i behålls stjärnor, märken och kläder.' }),
      err,
      el('div', { class: 'rk-actions' }, go, back),
    );
    this.body.replaceChildren(card);
    input.focus();
  }

  private confirmReset(text: string, alsoRewards: boolean): void {
    if (text.trim() !== 'NOLLSTÄLL') {
      this.renderResetForm('Skriv ordet NOLLSTÄLL.', text, alsoRewards);
      return;
    }
    resetStats(this.store);
    if (alsoRewards) resetRewards(this.store);
    this.banner = alsoRewards ? 'Statistik och belöningar är nollställda.' : 'Statistiken är nollställd. Stjärnor och märken är kvar.';
    this.hooks.onDirty?.();
    this.renderDash();
  }

  private renderDash(): void {
    this.clearTick();
    const stats = loadStats(this.store);
    const rewards = loadRewards(this.store);
    const parts: Node[] = [];
    if (this.banner) parts.push(el('p', { class: 'rk-card', text: this.banner }));
    parts.push(
      this.overview(stats, rewards),
      this.subjects(stats),
      this.hardSection(stats),
      this.timeSection(stats),
      this.days(stats),
      this.actions(),
    );
    this.body.replaceChildren(...parts);
  }

  private overview(stats: LearnStats, rewards: RewardState): HTMLElement {
    const senaste = stats.senaste ? formatStockholmStamp(stats.senaste) : 'Ingen aktivitet ännu';
    const andel = `${percentCorrect(stats.totalt.ratt, stats.totalt.fel)}%`;
    const langst = Math.max(rewards.langsta_streak, stats.langsta_streak);
    const daily = `${rewards.dagligt.ratt}/10 · ${rewards.dagligt.mal_klart ? 'Klart' : 'Inte klart'}`;
    const grid = el('div', { class: 'rk-overview' });
    const cells: Array<[string, string]> = [
      ['Senaste', senaste],
      ['Rätt', String(stats.totalt.ratt)],
      ['Fel', String(stats.totalt.fel)],
      ['Andel rätt', andel],
      ['Streak nu', String(rewards.streak)],
      ['Längsta streak', String(langst)],
      ['Stjärnor', String(rewards.stjarnor)],
      ['Dagens mål', daily],
    ];
    for (const [label, value] of cells) {
      grid.append(el('div', { class: 'rk-card' }, el('span', { class: 'muted', text: label }), el('b', { text: value })));
    }
    const wrap = el('section', {}, el('h2', { text: 'Översikt' }), grid);
    const emptyStats = stats.totalt.ratt + stats.totalt.fel === 0;
    if (emptyStats && (rewards.stjarnor > 0 || rewards.ratt_totalt > 0)) {
      wrap.append(el('p', { class: 'muted', text: 'Statistiken är tom. Stjärnor och streak finns kvar.' }));
    }
    return wrap;
  }

  private subjects(stats: LearnStats): HTMLElement {
    const wrap = el('section', {}, el('h2', { text: 'Per ämne och nivå' }));
    const keys = Object.keys(stats.per_amne_niva).sort((a, b) => {
      const as = a.split(':');
      const bs = b.split(':');
      const sa = SUBJECT_ORDER.get(as[0] ?? '') ?? 9;
      const sb = SUBJECT_ORDER.get(bs[0] ?? '') ?? 9;
      if (sa !== sb) return sa - sb;
      return (GRADE_ORDER.get(as[1] ?? '') ?? 9) - (GRADE_ORDER.get(bs[1] ?? '') ?? 9);
    });
    if (keys.length === 0) {
      wrap.append(el('p', { class: 'muted', text: 'Inga svar ännu. Spela en stund så syns det här.' }));
      return wrap;
    }
    const grid = el('div', { class: 'rk-subjects' });
    for (const key of keys) {
      const row = stats.per_amne_niva[key];
      if (!row) continue;
      const [subject, grade] = key.split(':');
      if (!subject || !grade) continue;
      const count = row.ratt + row.fel;
      const color = isRewardSubject(subject) ? SUBJECT_COLOR[subject] : '#6b5e4e';
      const card = el('article', { class: 'rk-card' });
      card.append(
        el(
          'div',
          { class: 'rk-amne-head' },
          el('span', { class: 'rk-prick', style: `background:${color}`, 'aria-hidden': 'true' }),
          el('h2', { text: `${subjectLabel(subject)} · ${gradeLabel(grade)}` }),
          el('span', { class: 'rk-pct', text: `${percentCorrect(row.ratt, row.fel)}%` }),
        ),
        this.bar(row.ratt, row.fel),
        el('p', { class: 'muted', text: `${count} frågor · ${avgSecondsLabel(row.tid_ms, count)} s i snitt` }),
      );
      grid.append(card);
    }
    wrap.append(grid);
    return wrap;
  }

  private bar(ratt: number, fel: number): HTMLDivElement {
    const n = ratt + fel;
    const ok = n === 0 ? 0 : (100 * ratt) / n;
    const bad = n === 0 ? 0 : 100 - ok;
    const track = el('div', { class: 'rk-bar', role: 'img', 'aria-label': `${ratt} rätt, ${fel} fel` });
    if (ratt > 0) track.append(el('span', { class: 'rk-bar-ok', style: `width:${ok}%` }));
    if (fel > 0) track.append(el('span', { class: 'rk-bar-bad', style: `width:${bad}%` }));
    return el('div', { class: 'rk-bar-row' }, track, el('span', { class: 'rk-bar-label', text: `${ratt} rätt · ${fel} fel` }));
  }

  private hardSection(stats: LearnStats): HTMLElement {
    const wrap = el('section', { class: 'rk-card rk-hard' }, el('h2', { text: 'Svåraste typerna' }));
    const sel = el('select', { 'aria-label': 'Ämne för svåraste typer' });
    sel.append(el('option', { value: 'alla', text: 'Totalt' }));
    for (const subject of REWARD_SUBJECTS) sel.append(el('option', { value: subject, text: subjectLabel(subject) }));
    sel.value = this.hardest;
    sel.addEventListener('change', () => {
      this.hardest = isRewardSubject(sel.value) ? sel.value : 'alla';
      this.renderDash();
      const next = this.body.querySelector('select');
      if (next instanceof HTMLSelectElement) next.focus();
    });
    wrap.append(sel);
    const rows = hardestTypes(stats, this.hardest === 'alla' ? undefined : this.hardest);
    if (rows.length === 0) {
      wrap.append(el('p', { class: 'muted', text: 'För få svar ännu. Minst fem försök behövs.' }));
      return wrap;
    }
    const list = el('ol');
    for (const row of rows) {
      const felkvot = percentCorrect(row.fel, row.ratt);
      const andel = percentCorrect(row.ratt, row.fel);
      const niva = row.niva && isGradeId(row.niva) ? gradeLabel(row.niva) : 'Flera nivåer';
      list.append(
        el(
          'li',
          {},
          el('strong', { text: row.typ }),
          el('small', { text: `Felkvot ${felkvot}% · ${niva}` }),
          el('span', { text: `${row.ratt} rätt · ${row.fel} fel · ${andel}%` }),
        ),
      );
    }
    wrap.append(list);
    return wrap;
  }

  private timeSection(stats: LearnStats): HTMLElement {
    return el(
      'section',
      { class: 'rk-card' },
      el('h2', { text: 'Tid' }),
      el('p', {}, el('span', { class: 'muted', text: 'Total lärtid' }), el('b', { text: ` ${formatLearnTime(stats.totalt.tid_ms)}` })),
      el('p', { class: 'muted', text: 'Tiden är hur länge frågan var framme. Pauser mellan frågor räknas inte.' }),
    );
  }

  private days(stats: LearnStats): HTMLElement {
    const dates = recentStockholmDates(new Date(), 14);
    const counts = dates.map((date) => {
      const row = stats.per_dag[date];
      return (row?.ratt ?? 0) + (row?.fel ?? 0);
    });
    const max = Math.max(1, ...counts);
    const chart = el('div', { class: 'rk-days-chart', role: 'img', 'aria-label': 'Rätt och fel de senaste 14 dagarna' });
    dates.forEach((date, i) => {
      const row = stats.per_dag[date];
      const n = counts[i] ?? 0;
      const h = n === 0 ? 4 : Math.max(8, Math.round((n / max) * 72));
      const letter = weekdayLetter(date);
      const bar = el('i', { style: `height:${h}px` });
      const cell = el('div', {
        class: 'rk-day',
        title: this.dayTitle(date, row),
        'aria-label': this.dayTitle(date, row),
      });
      cell.append(bar, el('span', { text: letter }));
      chart.append(cell);
    });
    const table = el('table');
    const head = el('thead');
    const hr = el('tr');
    for (const label of ['Dag', 'Rätt', 'Fel', 'Andel', 'Medeltid', 'Streak']) hr.append(el('th', { scope: 'col', text: label }));
    head.append(hr);
    const body = el('tbody');
    let any = false;
    for (const date of dates) {
      const row = stats.per_dag[date];
      if (!row || (row.ratt === 0 && row.fel === 0 && row.tid_ms === 0)) continue;
      any = true;
      const count = row.ratt + row.fel;
      const tr = el('tr');
      const cells = [
        shortDate(date),
        String(row.ratt),
        String(row.fel),
        `${percentCorrect(row.ratt, row.fel)}%`,
        `${avgSecondsLabel(row.tid_ms, count)} s`,
        String(row.langsta_streak),
      ];
      const labels = ['Dag', 'Rätt', 'Fel', 'Andel', 'Medeltid', 'Streak'];
      cells.forEach((text, i) => tr.append(el('td', { 'data-label': labels[i] ?? '', text })));
      body.append(tr);
    }
    table.append(head, body);
    const wrap = el('section', { class: 'rk-card rk-days' }, el('h2', { text: 'Senaste 14 dagarna' }), chart);
    wrap.append(any ? table : el('p', { class: 'muted', text: 'Inga dagar sparade ännu.' }));
    return wrap;
  }

  private dayTitle(date: string, row: DayStat | undefined): string {
    const ratt = row?.ratt ?? 0;
    const fel = row?.fel ?? 0;
    return `${shortDate(date)}: ${ratt} rätt, ${fel} fel`;
  }

  private actions(): HTMLElement {
    const btn = el('button', { type: 'button', text: 'Nollställ statistik' });
    btn.addEventListener('click', () => this.renderGate('reset'));
    return el('section', { class: 'rk-card' }, el('h2', { text: 'Åtgärder' }), el('div', { class: 'rk-actions' }, btn));
  }
}
