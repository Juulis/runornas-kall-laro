import { Rng } from '../core/Rng';
import { nextBankQuestion } from './bank';
import { nextMathQuestion } from './mathQuestions';
import {
  isValidQuestion,
  questionCount,
  type EncounterKind,
  type GradeId,
  type LearnQuestion,
  type QuestionSubject,
  type SubjectId,
} from './types';

const LAS_GRADES: ReadonlySet<GradeId> = new Set(['forskola', 'ak1', 'ak2', 'ak3']);

/** Blandat tar med läsförståelse bara på nivåer som har egna frågor i banken. */
function subjectFor(rng: Rng, subject: SubjectId, grade: GradeId): QuestionSubject {
  if (subject !== 'blandat') return subject;
  const choices: QuestionSubject[] = ['matte', 'svenska', 'engelska'];
  if (LAS_GRADES.has(grade)) choices.push('lasforstaelse');
  return rng.pick(choices);
}

function oneQuestion(rng: Rng, grade: GradeId, subject: SubjectId, index: number, idPrefix: string, avoid: Set<string>): LearnQuestion {
  const picked = subjectFor(rng, subject, grade);
  let last: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const q =
        picked === 'matte' ? nextMathQuestion(rng, grade, index, idPrefix) : nextBankQuestion(rng, picked, grade, index, idPrefix, avoid);
      if (!isValidQuestion(q) || q.grade !== grade || q.subject !== picked) throw new Error(`ogiltig fråga ${q.id}`);
      return q;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('kunde inte skapa fråga');
}

/** count frågor för nivå och ämne. Samma seed ger samma frågor. */
export function generateQuestions(opts: {
  count: number;
  grade: GradeId;
  subject: SubjectId;
  seed: number;
  idPrefix: string;
}): LearnQuestion[] {
  const rng = new Rng(opts.seed >>> 0);
  const avoid = new Set<string>();
  const out: LearnQuestion[] = [];
  for (let i = 0; i < opts.count; i++) out.push(oneQuestion(rng, opts.grade, opts.subject, i, opts.idPrefix, avoid));
  return out;
}

/**
 * Frågor för ett möte. Bossar är alltid samma fem frågor för samma boss-id, nivå och ämne
 * (seedat, oberoende av mötets slumpseed).
 */
export function questionsForEncounter(opts: {
  kind: EncounterKind;
  monsterId: string;
  grade: GradeId;
  subject: SubjectId;
  seed: number;
}): LearnQuestion[] {
  const count = questionCount(opts.kind);
  const seed = opts.kind === 'boss' ? Rng.hash('boss', opts.monsterId, opts.grade, opts.subject) : opts.seed;
  return generateQuestions({
    count,
    grade: opts.grade,
    subject: opts.subject,
    seed,
    idPrefix: opts.kind === 'boss' ? `boss:${opts.monsterId}` : opts.monsterId,
  });
}
