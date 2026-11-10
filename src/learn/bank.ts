import { isRecord } from '../core/json';
import type { Rng } from '../core/Rng';
import { multipleChoice } from './choices';
import { isGradeId, type GradeId, type LearnQuestion, type LearnSettings, type QuestionSubject, type SpeakLang } from './types';

export type BankSubject = 'svenska' | 'engelska' | 'lasforstaelse' | 'horforstaelse';

interface RawQuestion {
  id: string;
  niva: string;
  typ: string;
  fraga: string;
  ratt: string;
  fel: unknown;
  /** Engelskt ord som läses upp. Saknas på äldre rader. */
  eng?: unknown;
  /** Emoji för det rätta svenska ordet. */
  emoji?: unknown;
  /** Emoji i samma ordning som fel, när fel är strängar. */
  fel_emoji?: unknown;
  /** Läs- eller lyssningstext. Krävs för läs- och hörförståelse. */
  text?: unknown;
  /** Hörförståelse: sv eller en. Svenska och engelska blandas i samma ämne. */
  sprak?: unknown;
  /** Förskolan ber att texten läses upp. Overlay avgör när det sker. */
  las_upp?: unknown;
}

interface RawFile {
  amne: string;
  fragor: RawQuestion[];
}

interface WrongPart {
  text: string;
  emoji: string | null;
}

type BankImporter = () => Promise<unknown>;

const defaultImporters: Record<BankSubject, BankImporter> = {
  svenska: () => import('../data/fragor_svenska.json'),
  engelska: () => import('../data/fragor_engelska.json'),
  lasforstaelse: () => import('../data/fragor_lasforstaelse.json'),
  horforstaelse: () => import('../data/fragor_horforstaelse.json'),
};

const importers: Record<BankSubject, BankImporter> = { ...defaultImporters };
const pools = new Map<BankSubject, RawQuestion[]>();
const pending = new Map<BankSubject, Promise<RawQuestion[]>>();

/** Test: byt ut den dynamiska importen. null återställer den vanliga. */
export function setBankImporterForTests(subject: BankSubject, importer: BankImporter | null): void {
  importers[subject] = importer ?? defaultImporters[subject];
}

/** Tömmer cache så ett nytt anrop hämtar igen. Utan ämne töms alla. */
export function clearBankCache(subject?: BankSubject): void {
  if (!subject) {
    pools.clear();
    pending.clear();
    return;
  }
  pools.delete(subject);
  pending.delete(subject);
}

export function bankSubjectsFor(subject: LearnSettings['subject']): BankSubject[] {
  if (subject === 'matte') return [];
  if (subject === 'blandat') return ['svenska', 'engelska', 'lasforstaelse', 'horforstaelse'];
  if (subject === 'lasforstaelse') return ['lasforstaelse'];
  if (subject === 'horforstaelse') return ['horforstaelse'];
  if (subject === 'svenska' || subject === 'engelska') return [subject];
  return [];
}

function unwrapModule(mod: unknown): unknown {
  if (isRecord(mod) && 'default' in mod && isRecord(mod.default) && Array.isArray(mod.default.fragor)) return mod.default;
  return mod;
}

function asRaw(data: unknown, subject: QuestionSubject): RawQuestion[] {
  const file = data as RawFile;
  if (!file || file.amne !== subject || !Array.isArray(file.fragor)) throw new Error(`Ogiltig frågefil för ${subject}`);
  return file.fragor;
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Tre unika felsvar. Strängar eller {ord, emoji}. Äldre rader utan emoji fungerar. */
function wrongParts(row: RawQuestion): WrongPart[] {
  if (!Array.isArray(row.fel)) return [];
  const emojiList = Array.isArray(row.fel_emoji) ? row.fel_emoji : [];
  const out: WrongPart[] = [];
  const seen = new Set<string>();
  const answer = textOf(row.ratt);
  for (let i = 0; i < row.fel.length; i++) {
    const w = row.fel[i];
    let text = '';
    let emoji: string | null = null;
    if (typeof w === 'string') {
      text = w.trim();
      emoji = textOf(emojiList[i]) || null;
    } else if (isRecord(w)) {
      text = textOf(w.ord);
      emoji = textOf(w.emoji) || textOf(emojiList[i]) || null;
    }
    if (!text || text === answer || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, emoji });
  }
  return out;
}

function validRaw(row: RawQuestion): row is RawQuestion & { niva: GradeId } {
  if (!row || typeof row.id !== 'string' || !isGradeId(row.niva)) return false;
  if (typeof row.fraga !== 'string' || !row.fraga.trim()) return false;
  if (typeof row.ratt !== 'string' || !row.ratt.trim()) return false;
  if (row.eng !== undefined && !textOf(row.eng)) return false;
  if (row.emoji !== undefined && typeof row.emoji !== 'string') return false;
  if (row.fel_emoji !== undefined && !Array.isArray(row.fel_emoji)) return false;
  if (row.las_upp !== undefined && typeof row.las_upp !== 'boolean') return false;
  return wrongParts(row).length >= 3;
}

/** Läsförståelse kräver en icke-tom läsningstext. */
function validLas(row: RawQuestion): row is RawQuestion & { niva: GradeId } {
  return validRaw(row) && textOf(row.text).length > 0;
}

/** Hörförståelse kräver text och språk sv eller en. */
function validHor(row: RawQuestion): row is RawQuestion & { niva: GradeId } {
  return validLas(row) && (row.sprak === 'sv' || row.sprak === 'en');
}

function acceptRow(subject: BankSubject, row: RawQuestion): boolean {
  if (subject === 'horforstaelse') return validHor(row);
  if (subject === 'lasforstaelse') return validLas(row);
  return validRaw(row);
}

function poolOf(subject: BankSubject): readonly RawQuestion[] {
  const pool = pools.get(subject);
  if (!pool) throw new Error(`Frågebanken för ${subject} är inte laddad`);
  return pool;
}

/** Laddar och cachar en frågebank. Samma pågående anrop delas. Matte har ingen bank. */
export function ensureBank(subject: BankSubject): Promise<readonly RawQuestion[]> {
  const hit = pools.get(subject);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(subject);
  if (inflight) return inflight;
  const job = importers[subject]()
    .then((mod) => {
      const rows = asRaw(unwrapModule(mod), subject).filter((row) => acceptRow(subject, row));
      pools.set(subject, rows);
      pending.delete(subject);
      return rows;
    })
    .catch((err: unknown) => {
      pending.delete(subject);
      throw err;
    });
  pending.set(subject, job);
  return job;
}

/** Laddar de banker ämnet behöver. Matte gör inget. Progress är 0–1 när varje bank är klar. */
export async function preloadLearnBanks(settings: Pick<LearnSettings, 'subject'>, onProgress?: (ratio: number) => void): Promise<void> {
  const subjects = bankSubjectsFor(settings.subject);
  if (!subjects.length) {
    onProgress?.(1);
    return;
  }
  let done = 0;
  onProgress?.(0);
  await Promise.all(
    subjects.map(async (subject) => {
      await ensureBank(subject);
      done += 1;
      onProgress?.(done / subjects.length);
    }),
  );
}

export function bankQuestions(subject: BankSubject, grade: GradeId): readonly RawQuestion[] {
  return poolOf(subject).filter((row) => row.niva === grade);
}

export function bankCount(subject: BankSubject, grade: GradeId): number {
  return bankQuestions(subject, grade).length;
}

function withSpeech(q: LearnQuestion, text: string | undefined, lang: SpeakLang | undefined): LearnQuestion {
  if (!text) return q;
  return { ...q, speakText: text, ...(lang ? { speakLang: lang } : {}) };
}

/** Plockar en bankfråga och blandar alternativen. Kräver att ensureBank redan lösts. */
export function nextBankQuestion(
  rng: Rng,
  subject: BankSubject,
  grade: GradeId,
  index: number,
  idPrefix: string,
  avoid: Set<string>,
): LearnQuestion {
  let pool = bankQuestions(subject, grade);
  // Läsförståelse finns bara t.o.m. åk 3. Högre nivåer använder åk 3-poolen,
  // men grade på frågan förblir den valda nivån så att spelet inte kraschar.
  // Hörförståelse har frågor på varje nivå och faller inte tillbaka.
  if (!pool.length && subject === 'lasforstaelse') pool = bankQuestions(subject, 'ak3');
  if (!pool.length) throw new Error(`Ingen ${subject}-fråga för ${grade}`);
  const fresh = pool.filter((row) => !avoid.has(row.id));
  const row = rng.pick(fresh.length ? fresh : pool);
  const parts = wrongParts(row);
  const mc = multipleChoice(
    rng,
    row.ratt,
    parts.map((p) => p.text),
  );
  avoid.add(row.id);
  const emojiFor = new Map<string, string | null>();
  const rightEmoji = textOf(row.emoji) || null;
  if (rightEmoji) emojiFor.set(row.ratt, rightEmoji);
  for (const p of parts) emojiFor.set(p.text, p.emoji);
  const choiceEmojis = mc.choices.map((c) => emojiFor.get(c) ?? null);
  const hasEmoji = choiceEmojis.some((e) => e);
  const choices = mc.choices.map((c, i) => {
    const emoji = choiceEmojis[i];
    return emoji ? `${emoji} ${c}` : c;
  }) as [string, string, string, string];
  const eng = textOf(row.eng) || undefined;
  const passage = subject === 'lasforstaelse' || subject === 'horforstaelse' ? textOf(row.text) : '';
  const base: LearnQuestion = {
    id: `${idPrefix}:${subject}:${row.id}:${index}`,
    prompt: row.fraga,
    choices,
    correctIndex: mc.correctIndex,
    answer: row.ratt,
    subject,
    grade,
    rule: row.typ,
    ...(passage ? { passage } : {}),
    ...(hasEmoji ? { choiceEmojis } : {}),
  };
  if (subject === 'horforstaelse') {
    const lang: SpeakLang = row.sprak === 'en' ? 'en-US' : 'sv-SE';
    return {
      ...base,
      speakText: `${passage} ${row.fraga.trim()}`,
      speakLang: lang,
      speakPrompt: false,
      hidePassageUntilAnswered: true,
    };
  }
  if (passage) {
    return { ...base, speakText: `${passage} ${row.fraga.trim()}`, speakLang: 'sv-SE', speakPrompt: false };
  }
  if (eng) return withSpeech(base, eng, 'en-US');
  return base;
}
