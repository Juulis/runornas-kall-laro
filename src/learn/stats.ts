import { isRecord } from '../core/json';
import type { KeyValueStore } from '../core/storage';
import type { GradeId } from './types';
import { isGradeId } from './types';
import { isRewardSubject, type RewardSubject } from './rewards';
import { isIsoDate, stockholmDate, stockholmTimestamp } from './stockholm';

/** localStorage för föräldravy. Ingen nätverksskrivning. */
export const STATS_STORAGE_KEY = 'rk_laro_statistik';
export const STATS_BACKUP_KEY = 'rk_laro_statistik_bak';

export const STATS_DAY_KEEP = 14;
/** per_amne_niva som närmar sig den här storleken slår ihop sällsynta typer. */
export const STATS_TYPE_BYTES = 80_000;
export const STATS_KEY_BYTES = 100_000;
/** En glömd flik ska inte dra upp medeltiden. */
export const MAX_ANSWER_MS = 30 * 60 * 1000;

const QUOTA_TEXT = 'Kunde inte spara statistik';

export interface TypeCount {
  ratt: number;
  fel: number;
}

export interface SubjectLevelStat {
  ratt: number;
  fel: number;
  tid_ms: number;
  typer: Record<string, TypeCount>;
}

export interface DayStat {
  ratt: number;
  fel: number;
  tid_ms: number;
  langsta_streak: number;
}

export interface LearnStats {
  v: 1;
  uppdaterad: string;
  totalt: { ratt: number; fel: number; tid_ms: number };
  langsta_streak: number;
  senaste: string;
  per_amne_niva: Record<string, SubjectLevelStat>;
  per_dag: Record<string, DayStat>;
}

export interface StatsAnswerInput {
  correct: boolean;
  grade: GradeId;
  subject: RewardSubject;
  /** Frågans rule. Matte använder regelid, övriga använder bankens typ. */
  rule: string;
  durationMs: number;
  /** Streak efter svaret. Fel ger 0. */
  streak: number;
  now?: Date;
}

export interface HardType {
  typ: string;
  ratt: number;
  fel: number;
  /** Andel rätt, 0 till 1. */
  andel: number;
  niva: GradeId | null;
}

export function defaultStats(now: Date = new Date()): LearnStats {
  const stamp = stockholmTimestamp(now);
  return {
    v: 1,
    uppdaterad: stamp,
    totalt: { ratt: 0, fel: 0, tid_ms: 0 },
    langsta_streak: 0,
    senaste: '',
    per_amne_niva: {},
    per_dag: {},
  };
}

export function subjectLevelKey(subject: RewardSubject, grade: GradeId): string {
  return `${subject}:${grade}`;
}

function int(v: unknown, max = 2_000_000_000): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, Math.floor(v)));
}

export function cleanDuration(ms: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(MAX_ANSWER_MS, Math.round(ms));
}

function cleanType(rule: string): string {
  const t = rule.trim().slice(0, 64);
  if (!/^[\p{L}\p{N}_-]+$/u.test(t)) return 'okand';
  return t;
}

function emptyLevel(): SubjectLevelStat {
  return { ratt: 0, fel: 0, tid_ms: 0, typer: {} };
}

/** Ren uppdatering. Muterar inte `stats`. Äldre dagar än 14 tas bort. */
export function applyStatsAnswer(stats: LearnStats, input: StatsAnswerInput): LearnStats {
  const now = input.now ?? new Date();
  const next = structuredClone(stats);
  const tid = cleanDuration(input.durationMs);
  const day = stockholmDate(now);
  next.uppdaterad = stockholmTimestamp(now);
  next.senaste = next.uppdaterad;
  next.totalt.tid_ms += tid;
  if (input.correct) next.totalt.ratt += 1;
  else next.totalt.fel += 1;
  next.langsta_streak = Math.max(next.langsta_streak, int(input.streak));

  const key = subjectLevelKey(input.subject, input.grade);
  const bucket = next.per_amne_niva[key] ?? emptyLevel();
  bucket.tid_ms += tid;
  if (input.correct) bucket.ratt += 1;
  else bucket.fel += 1;
  const typ = cleanType(input.rule);
  const typeRow = bucket.typer[typ] ?? { ratt: 0, fel: 0 };
  if (input.correct) typeRow.ratt += 1;
  else typeRow.fel += 1;
  bucket.typer[typ] = typeRow;
  next.per_amne_niva[key] = bucket;

  const dayRow = next.per_dag[day] ?? { ratt: 0, fel: 0, tid_ms: 0, langsta_streak: 0 };
  dayRow.tid_ms += tid;
  if (input.correct) dayRow.ratt += 1;
  else dayRow.fel += 1;
  dayRow.langsta_streak = Math.max(dayRow.langsta_streak, int(input.streak));
  next.per_dag[day] = dayRow;

  return compactStats(next);
}

export function trimPerDag(per: Record<string, DayStat>, keep = STATS_DAY_KEEP): Record<string, DayStat> {
  const keys = Object.keys(per)
    .filter((k) => isIsoDate(k))
    .sort();
  const drop = keys.length - keep;
  const out: Record<string, DayStat> = {};
  const kept = drop > 0 ? keys.slice(drop) : keys;
  for (const key of kept) {
    const row = per[key];
    if (row) out[key] = row;
  }
  return out;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Slår ihop typer med färre än tre försök till `_ovrigt` när ämneskartan är stor. */
export function mergeRareTypes(stats: LearnStats): void {
  for (const bucket of Object.values(stats.per_amne_niva)) {
    let extraRatt = 0;
    let extraFel = 0;
    const kept: Record<string, TypeCount> = {};
    for (const [typ, row] of Object.entries(bucket.typer)) {
      if (typ !== '_ovrigt' && row.ratt + row.fel < 3) {
        extraRatt += row.ratt;
        extraFel += row.fel;
        continue;
      }
      kept[typ] = row;
    }
    if (extraRatt === 0 && extraFel === 0) continue;
    const rest = kept._ovrigt ?? { ratt: 0, fel: 0 };
    rest.ratt += extraRatt;
    rest.fel += extraFel;
    kept._ovrigt = rest;
    bucket.typer = kept;
  }
}

export function compactStats(stats: LearnStats, typeBytes = STATS_TYPE_BYTES): LearnStats {
  const next = structuredClone(stats);
  next.per_dag = trimPerDag(next.per_dag);
  if (jsonBytes(next.per_amne_niva) > typeBytes) mergeRareTypes(next);
  return next;
}

function attempts(row: TypeCount): number {
  return row.ratt + row.fel;
}

/**
 * Tre typer med lägst andel rätt. Minst fem försök.
 * `subject` utelämnat betyder totalt över alla ämnen.
 */
export function hardestTypes(stats: LearnStats, subject?: RewardSubject): HardType[] {
  const grouped = new Map<string, { ratt: number; fel: number; grades: Map<GradeId, TypeCount> }>();
  for (const [key, bucket] of Object.entries(stats.per_amne_niva)) {
    const split = key.indexOf(':');
    if (split <= 0) continue;
    const sub = key.slice(0, split);
    const grade = key.slice(split + 1);
    if (!isRewardSubject(sub) || !isGradeId(grade)) continue;
    if (subject && sub !== subject) continue;
    for (const [typ, row] of Object.entries(bucket.typer)) {
      if (typ === '_ovrigt') continue;
      const g = grouped.get(typ) ?? { ratt: 0, fel: 0, grades: new Map<GradeId, TypeCount>() };
      g.ratt += row.ratt;
      g.fel += row.fel;
      const prev = g.grades.get(grade) ?? { ratt: 0, fel: 0 };
      prev.ratt += row.ratt;
      prev.fel += row.fel;
      g.grades.set(grade, prev);
      grouped.set(typ, g);
    }
  }

  const rows: HardType[] = [];
  for (const [typ, g] of grouped) {
    const n = g.ratt + g.fel;
    if (n < 5) continue;
    let niva: GradeId | null = null;
    let bestAttempts = -1;
    let bestAndel = 2;
    for (const [grade, row] of g.grades) {
      const a = attempts(row);
      const andel = a > 0 ? row.ratt / a : 1;
      if (a > bestAttempts || (a === bestAttempts && andel < bestAndel)) {
        bestAttempts = a;
        bestAndel = andel;
        niva = grade;
      }
    }
    rows.push({ typ, ratt: g.ratt, fel: g.fel, andel: g.ratt / n, niva });
  }
  rows.sort((a, b) => a.andel - b.andel || b.fel - a.fel || a.typ.localeCompare(b.typ, 'sv'));
  return rows.slice(0, 3);
}

export function percentCorrect(ratt: number, fel: number): number {
  const n = ratt + fel;
  if (n <= 0) return 0;
  return Math.round((100 * ratt) / n);
}

export function avgSecondsLabel(tidMs: number, count: number): string {
  if (count <= 0) return '0,0';
  return (tidMs / count / 1000).toFixed(1).replace('.', ',');
}

export function formatLearnTime(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const hourWord = hours === 1 ? 'timme' : 'timmar';
  const minuteWord = minutes === 1 ? 'minut' : 'minuter';
  if (hours === 0) return `${minutes} ${minuteWord}`;
  return `${hours} ${hourWord} ${minutes} ${minuteWord}`;
}

const TYPE_RE = /^[\p{L}\p{N}_-]+$/u;
const LEVEL_RE = /^(matte|svenska|engelska|lasforstaelse):(forskola|ak1|ak2|ak3|ak4_6|ak7_9|gymnasiet|vuxen)$/;

function parseTypeMap(v: unknown): Record<string, TypeCount> {
  if (!isRecord(v)) return {};
  const out: Record<string, TypeCount> = {};
  for (const [typ, raw] of Object.entries(v)) {
    if (!TYPE_RE.test(typ) || typ.length > 64 || !isRecord(raw)) continue;
    const ratt = int(raw.ratt);
    const fel = int(raw.fel);
    if (ratt + fel <= 0) continue;
    out[typ] = { ratt, fel };
  }
  return out;
}

function parseLevels(v: unknown): Record<string, SubjectLevelStat> {
  if (!isRecord(v)) return {};
  const out: Record<string, SubjectLevelStat> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!LEVEL_RE.test(key) || !isRecord(raw)) continue;
    const ratt = int(raw.ratt);
    const fel = int(raw.fel);
    const tid_ms = int(raw.tid_ms);
    const typer = parseTypeMap(raw.typer);
    if (ratt + fel <= 0 && tid_ms <= 0 && Object.keys(typer).length === 0) continue;
    out[key] = { ratt, fel, tid_ms, typer };
  }
  return out;
}

function parseDays(v: unknown): Record<string, DayStat> {
  if (!isRecord(v)) return {};
  const out: Record<string, DayStat> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!isIsoDate(key) || !isRecord(raw)) continue;
    out[key] = {
      ratt: int(raw.ratt),
      fel: int(raw.fel),
      tid_ms: int(raw.tid_ms),
      langsta_streak: int(raw.langsta_streak),
    };
  }
  return out;
}

function parseTotals(v: unknown): LearnStats['totalt'] {
  if (!isRecord(v)) return { ratt: 0, fel: 0, tid_ms: 0 };
  return { ratt: int(v.ratt), fel: int(v.fel), tid_ms: int(v.tid_ms) };
}

/** null när v saknas eller är okänd. */
export function parseStats(raw: unknown): LearnStats | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const uppdaterad = typeof raw.uppdaterad === 'string' ? raw.uppdaterad : '';
  const senaste = typeof raw.senaste === 'string' ? raw.senaste : '';
  return {
    v: 1,
    uppdaterad,
    totalt: parseTotals(raw.totalt),
    langsta_streak: int(raw.langsta_streak),
    senaste,
    per_amne_niva: parseLevels(raw.per_amne_niva),
    per_dag: parseDays(raw.per_dag),
  };
}

export function serializeStats(stats: LearnStats): LearnStats {
  return {
    v: 1,
    uppdaterad: stats.uppdaterad,
    totalt: { ...stats.totalt },
    langsta_streak: stats.langsta_streak,
    senaste: stats.senaste,
    per_amne_niva: structuredClone(stats.per_amne_niva),
    per_dag: structuredClone(stats.per_dag),
  };
}

function backupOnce(store: KeyValueStore, raw: string): void {
  try {
    if (store.get(STATS_BACKUP_KEY)) return;
    store.set(STATS_BACKUP_KEY, raw);
  } catch {
    /* en misslyckad backup får inte stoppa spelet */
  }
}

let quotaNoted = false;

/** Texten visas högst en gång per sidladdning. */
export function noteStatsQuota(): string | null {
  if (quotaNoted) return null;
  quotaNoted = true;
  return QUOTA_TEXT;
}

export function resetStatsQuotaWarning(): void {
  quotaNoted = false;
}

function isQuota(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String(err.name) : '';
  const message = err instanceof Error ? err.message : '';
  return name === 'QuotaExceededError' || message.includes('QuotaExceeded');
}

export interface SaveStatsResult {
  ok: boolean;
  warning: string | null;
}

/** Skriver statistik. Vid för stor payload eller QuotaExceeded tappas äldsta dagar först. */
export function saveStats(store: KeyValueStore, stats: LearnStats, typeBytes = STATS_TYPE_BYTES): SaveStatsResult {
  const prepared = compactStats(stats, typeBytes);
  let days = Object.keys(prepared.per_dag).sort();
  let warning: string | null = null;
  const warn = (): void => {
    const text = noteStatsQuota();
    if (text) warning = text;
  };
  for (let guard = 0; guard < 40; guard++) {
    const per_dag: Record<string, DayStat> = {};
    for (const day of days) {
      const row = prepared.per_dag[day];
      if (row) per_dag[day] = row;
    }
    const body = serializeStats({ ...prepared, per_dag });
    const json = JSON.stringify(body);
    const tooBig = json.length > STATS_KEY_BYTES && days.length > 1;
    if (tooBig) {
      days = days.slice(1);
      continue;
    }
    try {
      store.set(STATS_STORAGE_KEY, json);
      return { ok: true, warning };
    } catch (err) {
      if (!isQuota(err)) return { ok: false, warning };
      warn();
      if (days.length === 0) return { ok: false, warning };
      days = days.slice(1);
    }
  }
  return { ok: false, warning };
}

export function loadStats(store: KeyValueStore, now: Date = new Date()): LearnStats {
  let raw: string | null;
  try {
    raw = store.get(STATS_STORAGE_KEY);
  } catch {
    return defaultStats(now);
  }
  if (!raw) return defaultStats(now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    backupOnce(store, raw);
    const fresh = defaultStats(now);
    saveStats(store, fresh);
    return fresh;
  }
  const stats = parseStats(parsed);
  if (!stats) {
    backupOnce(store, raw);
    const fresh = defaultStats(now);
    saveStats(store, fresh);
    return fresh;
  }
  const compact = compactStats(stats);
  const before = Object.keys(stats.per_dag).length;
  const after = Object.keys(compact.per_dag).length;
  const typesBefore = jsonBytes(stats.per_amne_niva);
  if (before !== after || typesBefore > STATS_TYPE_BYTES) saveStats(store, compact);
  return compact;
}

export function recordAnswer(store: KeyValueStore, input: StatsAnswerInput): { stats: LearnStats; warning: string | null } {
  const stats = applyStatsAnswer(loadStats(store, input.now), input);
  const saved = saveStats(store, stats);
  return { stats, warning: saved.warning };
}

export function resetStats(store: KeyValueStore, now: Date = new Date()): LearnStats {
  const fresh = defaultStats(now);
  saveStats(store, fresh);
  return fresh;
}
