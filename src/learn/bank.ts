import engelska from '../data/fragor_engelska.json';
import svenska from '../data/fragor_svenska.json';
import type { Rng } from '../core/Rng';
import { multipleChoice } from './choices';
import { isGradeId, type GradeId, type LearnQuestion, type QuestionSubject } from './types';

interface RawQuestion {
  id: string;
  niva: string;
  typ: string;
  fraga: string;
  ratt: string;
  fel: string[];
}

interface RawFile {
  amne: string;
  fragor: RawQuestion[];
}

function asRaw(data: unknown, subject: QuestionSubject): RawQuestion[] {
  const file = data as RawFile;
  if (!file || file.amne !== subject || !Array.isArray(file.fragor)) throw new Error(`Ogiltig frågefil för ${subject}`);
  return file.fragor;
}

function validRaw(row: RawQuestion): row is RawQuestion & { niva: GradeId } {
  if (!row || typeof row.id !== 'string' || !isGradeId(row.niva)) return false;
  if (typeof row.fraga !== 'string' || !row.fraga.trim()) return false;
  if (typeof row.ratt !== 'string' || !row.ratt.trim()) return false;
  if (!Array.isArray(row.fel) || row.fel.length < 3) return false;
  const wrongs = row.fel.filter((w) => typeof w === 'string' && w.trim() && w !== row.ratt);
  return new Set(wrongs).size >= 3;
}

const SVENSKA = asRaw(svenska, 'svenska').filter((row) => validRaw(row));
const ENGELSKA = asRaw(engelska, 'engelska').filter((row) => validRaw(row));

export function bankQuestions(subject: 'svenska' | 'engelska', grade: GradeId): readonly RawQuestion[] {
  const pool = subject === 'svenska' ? SVENSKA : ENGELSKA;
  return pool.filter((row) => row.niva === grade);
}

export function bankCount(subject: 'svenska' | 'engelska', grade: GradeId): number {
  return bankQuestions(subject, grade).length;
}

/** Plockar en bankfråga och blandar alternativen. */
export function nextBankQuestion(rng: Rng, subject: 'svenska' | 'engelska', grade: GradeId, index: number, idPrefix: string, avoid: Set<string>): LearnQuestion {
  const pool = bankQuestions(subject, grade);
  if (!pool.length) throw new Error(`Ingen ${subject}-fråga för ${grade}`);
  const fresh = pool.filter((row) => !avoid.has(row.id));
  const row = rng.pick(fresh.length ? fresh : pool);
  const wrongs = row.fel.filter((w) => w !== row.ratt);
  const mc = multipleChoice(rng, row.ratt, wrongs);
  avoid.add(row.id);
  return {
    id: `${idPrefix}:${subject}:${row.id}:${index}`,
    prompt: row.fraga,
    choices: mc.choices,
    correctIndex: mc.correctIndex,
    answer: row.ratt,
    subject,
    grade,
    rule: row.typ,
  };
}
