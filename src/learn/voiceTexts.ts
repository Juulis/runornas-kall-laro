import { ensureBank, type BankSubject } from './bank';
import { nextMathQuestion } from './mathQuestions';
import { questionUtterances, type SpeakPart } from './speech';
import { Rng } from '../core/Rng';
import { GRADES, isGradeId, type GradeId, type LearnQuestion, type SpeakLang } from './types';

interface BankRow {
  id: string;
  niva: string;
  typ: string;
  fraga: string;
  ratt: string;
  eng?: unknown;
  text?: unknown;
  sprak?: unknown;
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Bygger en lärfråga från en bankrad, med samma speak-fält som nextBankQuestion.
 * Alternativen behöver inte blandas; de läses inte upp.
 */
export function learnQuestionFromBankRow(subject: BankSubject, row: BankRow): LearnQuestion | null {
  if (!isGradeId(row.niva)) return null;
  const grade: GradeId = row.niva;
  const passage = subject === 'lasforstaelse' || subject === 'horforstaelse' ? textOf(row.text) : '';
  const base: LearnQuestion = {
    id: row.id,
    prompt: row.fraga,
    choices: [row.ratt, '_', '_', '_'],
    correctIndex: 0,
    answer: row.ratt,
    subject,
    grade,
    rule: row.typ,
    ...(passage ? { passage } : {}),
  };
  if (subject === 'horforstaelse') {
    const lang: SpeakLang = row.sprak === 'en' ? 'en-US' : 'sv-SE';
    return {
      ...base,
      speakText: `${passage} ${row.fraga.trim()}`.trim(),
      speakLang: lang,
      speakPrompt: false,
      hidePassageUntilAnswered: true,
    };
  }
  if (passage) {
    return { ...base, speakText: `${passage} ${row.fraga.trim()}`.trim(), speakLang: 'sv-SE', speakPrompt: false };
  }
  const eng = textOf(row.eng);
  if (eng) {
    return { ...base, speakText: eng, speakLang: 'en-US', speakPrompt: true };
  }
  return base;
}

const BANK_SUBJECTS: BankSubject[] = ['svenska', 'engelska', 'lasforstaelse', 'horforstaelse'];

/** Alla unika stycken som bankfrågorna läser upp (efter questionUtterances, inte uppdelade). */
export async function collectBankSpeakParts(): Promise<SpeakPart[]> {
  const seen = new Set<string>();
  const out: SpeakPart[] = [];
  for (const subject of BANK_SUBJECTS) {
    const rows = await ensureBank(subject);
    for (const row of rows) {
      const q = learnQuestionFromBankRow(subject, row);
      if (!q) continue;
      for (const part of questionUtterances(q)) {
        const text = part.text.trim();
        if (!text) continue;
        const key = `${part.lang}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text, lang: part.lang });
      }
    }
  }
  return out;
}

/**
 * Unika mattestycken från många dragningar. Matte skapas slumpmässigt,
 * så det här är ett urval; resten faller tillbaka på talsyntesen.
 */
export function collectMathSpeakParts(drawsPerGrade = 400): SpeakPart[] {
  const seen = new Set<string>();
  const out: SpeakPart[] = [];
  for (const grade of GRADES) {
    for (let seed = 0; seed < drawsPerGrade; seed++) {
      const rng = new Rng((seed * 7919 + grade.id.length * 13) >>> 0);
      try {
        const q = nextMathQuestion(rng, grade.id, seed % 7, 'voice');
        for (const part of questionUtterances(q)) {
          const text = part.text.trim();
          if (!text) continue;
          const key = `${part.lang}|${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ text, lang: part.lang });
        }
      } catch {
        /* vissa kombinationer kan sakna giltig fråga */
      }
    }
  }
  return out;
}

export async function collectAllSpeakParts(): Promise<SpeakPart[]> {
  const bank = await collectBankSpeakParts();
  const seen = new Set(bank.map((p) => `${p.lang}|${p.text}`));
  const out = [...bank];
  for (const part of collectMathSpeakParts()) {
    const key = `${part.lang}|${part.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}
