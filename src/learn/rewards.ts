import { isRecord } from '../core/json';
import type { KeyValueStore } from '../core/storage';
import { questionCount, type EncounterKind, type GradeId, type SubjectId } from './types';
import { isIsoDate, stockholmDate } from './stockholm';

/** localStorage. rk_laro (nivå och ämne) rörs inte. */
export const REWARD_STORAGE_KEY = 'rk_laro_beloning';
export const REWARD_BACKUP_KEY = 'rk_laro_beloning_bak';

export const DAILY_GOAL = 10;
export const DAILY_BONUS = 3;

/** Ämnen som räknas i belöningar (inkl. lasforstaelse från fragor_lasforstaelse.json). */
export const REWARD_SUBJECTS = ['matte', 'svenska', 'engelska', 'lasforstaelse'] as const;
export type RewardSubject = (typeof REWARD_SUBJECTS)[number];

export function isRewardSubject(v: unknown): v is RewardSubject {
  return typeof v === 'string' && (REWARD_SUBJECTS as readonly string[]).includes(v);
}

export const STICKER_IDS = [
  'forsta_ratt',
  'streak_5',
  'streak_10',
  'streak_20',
  'matte_ak1',
  'svenska_ak1',
  'engelska_ak1',
  'las_ak1',
  'forskola_stjarna',
  'champion_3',
  'boss_1',
  'blandat_50',
  'dag_7',
  'las_ak3',
  'alla_amnen',
] as const;

export type StickerId = (typeof STICKER_IDS)[number];

/**
 * Fallback-alias till äldre klistermarke_* filer (leverans.md).
 * Primär grafik använder spec-id-filerna i rewardArt.stickerIdUrl.
 */
export const STICKER_MOTIF = {
  forsta_ratt: 'runsten',
  streak_5: 'ekorre',
  streak_10: 'rav',
  streak_20: 'vargvalp',
  matte_ak1: 'runsten',
  svenska_ak1: 'uggla',
  engelska_ak1: 'korp',
  las_ak1: 'alg',
  forskola_stjarna: 'igelkott',
  champion_3: 'alg',
  boss_1: 'uggla',
  blandat_50: 'igelkott',
  dag_7: 'ekorre',
  las_ak3: 'vargvalp',
  alla_amnen: 'korp',
} as const satisfies Record<StickerId, string>;

export interface StickerDef {
  id: StickerId;
  namn: string;
  hint: string;
}

export const STICKERS: readonly StickerDef[] = [
  { id: 'forsta_ratt', namn: 'Första stjärnan', hint: 'Svara rätt en gång' },
  { id: 'streak_5', namn: 'Fem i rad', hint: 'Fem rätt i rad' },
  { id: 'streak_10', namn: 'Tio i rad', hint: 'Tio rätt i rad' },
  { id: 'streak_20', namn: 'Tjugo i rad', hint: 'Tjugo rätt i rad' },
  { id: 'matte_ak1', namn: 'Räknare', hint: 'Tjugo rätt i matte, åk 1' },
  { id: 'svenska_ak1', namn: 'Ordvän', hint: 'Tjugo rätt i svenska, åk 1' },
  { id: 'engelska_ak1', namn: 'Word friend', hint: 'Tjugo rätt i engelska, åk 1' },
  { id: 'las_ak1', namn: 'Läsare', hint: 'Tjugo rätt i läsning, åk 1' },
  { id: 'forskola_stjarna', namn: 'Förskoleljus', hint: 'Femton rätt i förskolan' },
  { id: 'champion_3', namn: 'Championvän', hint: 'Tre champions, minst tre av fyra rätt' },
  { id: 'boss_1', namn: 'Bosskämpe', hint: 'En boss, minst fem av sex rätt' },
  { id: 'blandat_50', namn: 'Blandmästare', hint: 'Femtio rätt när ämnet är blandat' },
  { id: 'dag_7', namn: 'Veckovanör', hint: 'Klara dagens mål sju dagar' },
  { id: 'las_ak3', namn: 'Bokorm', hint: 'Trettio rätt i läsning, åk 3' },
  { id: 'alla_amnen', namn: 'Allvetare', hint: 'Tio rätt i varje ämne' },
];

const STICKER_SET = new Set<string>(STICKER_IDS);

export function isStickerId(v: unknown): v is StickerId {
  return typeof v === 'string' && STICKER_SET.has(v);
}

export function stickerName(id: StickerId): string {
  return STICKERS.find((s) => s.id === id)?.namn ?? id;
}

export const COSMETIC_IDS = [
  'hatt_ull',
  'hatt_rune',
  'hatt_champion',
  'mantel_gron',
  'mantel_natt',
  'mantel_boss',
  'hatt_forskola',
] as const;

export type CosmeticId = (typeof COSMETIC_IDS)[number];
export type CosmeticSlot = 'hatt' | 'mantel';

export interface CosmeticDef {
  id: CosmeticId;
  typ: CosmeticSlot;
  namn: string;
  /** Saknas när märket låser upp plagget utan kostnad. */
  kostnad?: number;
  marke?: StickerId;
  emoji: string;
}

export const COSMETICS: readonly CosmeticDef[] = [
  { id: 'hatt_ull', typ: 'hatt', namn: 'Ullmössa', kostnad: 15, emoji: '🧢' },
  { id: 'hatt_rune', typ: 'hatt', namn: 'Runhuva', kostnad: 40, emoji: '🧙' },
  { id: 'hatt_champion', typ: 'hatt', namn: 'Championfjäder', marke: 'champion_3', emoji: '🪶' },
  { id: 'mantel_gron', typ: 'mantel', namn: 'Grön vandringsmantel', kostnad: 25, emoji: '🧥' },
  { id: 'mantel_natt', typ: 'mantel', namn: 'Nattmantel', kostnad: 60, emoji: '🌙' },
  { id: 'mantel_boss', typ: 'mantel', namn: 'Bossmantel', marke: 'boss_1', emoji: '👑' },
  { id: 'hatt_forskola', typ: 'hatt', namn: 'Ljuslykta-hatt', marke: 'forskola_stjarna', emoji: '🏮' },
];

const COSMETIC_SET = new Set<string>(COSMETIC_IDS);

export function isCosmeticId(v: unknown): v is CosmeticId {
  return typeof v === 'string' && COSMETIC_SET.has(v);
}

export function cosmeticById(id: string): CosmeticDef | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export interface DailyProgress {
  datum: string;
  ratt: number;
  mal_klart: boolean;
}

export interface SubjectCorrect {
  ratt: number;
}

export interface RewardState {
  v: 1;
  stjarnor: number;
  streak: number;
  langsta_streak: number;
  ratt_totalt: number;
  klistermarken: StickerId[];
  upplast: CosmeticId[];
  aktiv_hatt: CosmeticId | null;
  aktiv_mantel: CosmeticId | null;
  dagligt: DailyProgress;
  dagar_mal_klart: string[];
  per_amne_niva: Record<string, SubjectCorrect>;
  champions_ok: number;
  bossar_ok: number;
  /**
   * Rätt medan inställningen är blandat. Frågan själv sparas på sitt riktiga ämne,
   * så den här räknaren behövs för märket blandat_50.
   */
  blandat_ratt: number;
}

export function defaultRewardState(now: Date = new Date()): RewardState {
  return {
    v: 1,
    stjarnor: 0,
    streak: 0,
    langsta_streak: 0,
    ratt_totalt: 0,
    klistermarken: [],
    upplast: [],
    aktiv_hatt: null,
    aktiv_mantel: null,
    dagligt: { datum: stockholmDate(now), ratt: 0, mal_klart: false },
    dagar_mal_klart: [],
    per_amne_niva: {},
    champions_ok: 0,
    bossar_ok: 0,
    blandat_ratt: 0,
  };
}

export function starsPerCorrect(kind: EncounterKind): number {
  if (kind === 'boss') return 3;
  if (kind === 'champion') return 2;
  return 1;
}

/** 1–2 liten, 3–6 mellan, 7+ stor. Noll ger ingen flamma. */
export function streakFlameKind(streak: number): 'liten' | 'mellan' | 'stor' | null {
  if (streak <= 0) return null;
  if (streak <= 2) return 'liten';
  if (streak <= 6) return 'mellan';
  return 'stor';
}

export function subjectGradeKey(subject: RewardSubject, grade: GradeId): string {
  return `${subject}:${grade}`;
}

export function correctAt(state: RewardState, subject: RewardSubject, grade: GradeId): number {
  return state.per_amne_niva[subjectGradeKey(subject, grade)]?.ratt ?? 0;
}

export function correctOnGrade(state: RewardState, grade: GradeId): number {
  const suffix = `:${grade}`;
  let n = 0;
  for (const [key, bucket] of Object.entries(state.per_amne_niva)) {
    if (key.endsWith(suffix)) n += bucket.ratt;
  }
  return n;
}

export function correctInSubject(state: RewardState, subject: RewardSubject): number {
  const prefix = `${subject}:`;
  let n = 0;
  for (const [key, bucket] of Object.entries(state.per_amne_niva)) {
    if (key.startsWith(prefix)) n += bucket.ratt;
  }
  return n;
}

const EARNED: Record<StickerId, (s: RewardState) => boolean> = {
  forsta_ratt: (s) => s.ratt_totalt >= 1,
  streak_5: (s) => s.langsta_streak >= 5,
  streak_10: (s) => s.langsta_streak >= 10,
  streak_20: (s) => s.langsta_streak >= 20,
  matte_ak1: (s) => correctAt(s, 'matte', 'ak1') >= 20,
  svenska_ak1: (s) => correctAt(s, 'svenska', 'ak1') >= 20,
  engelska_ak1: (s) => correctAt(s, 'engelska', 'ak1') >= 20,
  las_ak1: (s) => correctAt(s, 'lasforstaelse', 'ak1') >= 20,
  forskola_stjarna: (s) => correctOnGrade(s, 'forskola') >= 15,
  champion_3: (s) => s.champions_ok >= 3,
  boss_1: (s) => s.bossar_ok >= 1,
  blandat_50: (s) => s.blandat_ratt >= 50,
  dag_7: (s) => s.dagar_mal_klart.length >= 7,
  las_ak3: (s) => correctAt(s, 'lasforstaelse', 'ak3') >= 30,
  alla_amnen: (s) => REWARD_SUBJECTS.every((subject) => correctInSubject(s, subject) >= 10),
};

export function isStickerEarned(state: RewardState, id: StickerId): boolean {
  return EARNED[id](state);
}

/** Lägger nya märken sist i listan. Returnerar bara de som just låstes upp. */
export function unlockNewStickers(state: RewardState): StickerId[] {
  const have = new Set(state.klistermarken);
  const fresh: StickerId[] = [];
  for (const sticker of STICKERS) {
    if (have.has(sticker.id)) continue;
    if (!EARNED[sticker.id](state)) continue;
    state.klistermarken.push(sticker.id);
    fresh.push(sticker.id);
  }
  return fresh;
}

/** Andel rätt som krävs för att ett champion- eller bossmöte räknas (designens 2/3 och 4/5). */
const PASS_RATIO: Record<EncounterKind, number> = { normal: 0, champion: 2 / 3, boss: 4 / 5 };

/** Minsta antal rätt i mötet för att det ska räknas. Följer antalet frågor: champion 3 av 4, boss 5 av 6. */
export function encounterPassThreshold(kind: EncounterKind): number {
  return Math.ceil(questionCount(kind) * PASS_RATIO[kind] - 1e-9);
}

export interface AnswerRewardInput {
  correct: boolean;
  kind: EncounterKind;
  grade: GradeId;
  subject: RewardSubject;
  /** Inställningens ämne. blandat räknas till blandat_50. */
  settingsSubject?: SubjectId;
  /** Sant på sista frågan i champion eller boss. */
  encounterDone?: boolean;
  /** Antal rätt i mötet efter den här frågan. */
  encounterCorrect?: number;
  now?: Date;
}

export interface AnswerRewardEffect {
  state: RewardState;
  starsGained: number;
  streak: number;
  unlockedStickers: StickerId[];
  toasts: string[];
  dailyDone: boolean;
}

function milestone(streak: number): { stars: number; toast: string } | null {
  if (streak === 5) return { stars: 2, toast: 'Fem i rad!' };
  if (streak === 10) return { stars: 5, toast: 'Tio i rad!' };
  if (streak === 20) return { stars: 10, toast: 'Tjugo i rad!' };
  return null;
}

/** Ren uppdatering. Muterar inte `state`. */
export function applyLearnAnswer(state: RewardState, input: AnswerRewardInput): AnswerRewardEffect {
  const now = input.now ?? new Date();
  const today = stockholmDate(now);
  const next = structuredClone(state);
  if (next.dagligt.datum !== today) {
    next.dagligt = { datum: today, ratt: 0, mal_klart: false };
  }

  const toasts: string[] = [];
  let starsGained = 0;
  let dailyDone = false;

  if (input.correct) {
    const gain = starsPerCorrect(input.kind);
    next.stjarnor += gain;
    starsGained += gain;
    next.streak += 1;
    next.ratt_totalt += 1;
    if (next.streak > next.langsta_streak) next.langsta_streak = next.streak;

    const key = subjectGradeKey(input.subject, input.grade);
    const bucket = next.per_amne_niva[key] ?? { ratt: 0 };
    bucket.ratt += 1;
    next.per_amne_niva[key] = bucket;
    if (input.settingsSubject === 'blandat') next.blandat_ratt += 1;

    next.dagligt.ratt += 1;
    const bonus = milestone(next.streak);
    if (bonus) {
      next.stjarnor += bonus.stars;
      starsGained += bonus.stars;
      toasts.push(bonus.toast);
    }
    if (!next.dagligt.mal_klart && next.dagligt.ratt >= DAILY_GOAL) {
      next.dagligt.mal_klart = true;
      next.stjarnor += DAILY_BONUS;
      starsGained += DAILY_BONUS;
      dailyDone = true;
      if (!next.dagar_mal_klart.includes(today)) next.dagar_mal_klart.push(today);
      toasts.push('Dagens mål är klart!');
    }
  } else {
    next.streak = 0;
  }

  if (input.encounterDone) {
    const got = input.encounterCorrect ?? 0;
    if (input.kind === 'champion' && got >= encounterPassThreshold('champion')) next.champions_ok += 1;
    if (input.kind === 'boss' && got >= encounterPassThreshold('boss')) next.bossar_ok += 1;
  }

  const unlockedStickers = unlockNewStickers(next);
  for (const id of unlockedStickers) toasts.push(`Nytt märke: ${stickerName(id)}!`);

  return { state: next, starsGained, streak: next.streak, unlockedStickers, toasts, dailyDone };
}

export type BuyReason = 'okand' | 'redan' | 'stjarnor' | 'marke';

export function buyCosmetic(
  state: RewardState,
  id: string,
): { ok: true; state: RewardState } | { ok: false; state: RewardState; reason: BuyReason } {
  if (!isCosmeticId(id)) return { ok: false, state, reason: 'okand' };
  const item = cosmeticById(id);
  if (!item) return { ok: false, state, reason: 'okand' };
  if (state.upplast.includes(id)) return { ok: false, state, reason: 'redan' };
  if (item.marke) {
    if (!state.klistermarken.includes(item.marke)) return { ok: false, state, reason: 'marke' };
    return { ok: true, state: { ...state, upplast: [...state.upplast, id] } };
  }
  const cost = item.kostnad ?? 0;
  if (state.stjarnor < cost) return { ok: false, state, reason: 'stjarnor' };
  return { ok: true, state: { ...state, stjarnor: state.stjarnor - cost, upplast: [...state.upplast, id] } };
}

/** På igen tar av. Annars byts samma plats gratis. */
export function equipCosmetic(state: RewardState, id: CosmeticId): RewardState {
  const item = cosmeticById(id);
  if (!item || !state.upplast.includes(id)) return state;
  if (item.typ === 'hatt') {
    return { ...state, aktiv_hatt: state.aktiv_hatt === id ? null : id };
  }
  return { ...state, aktiv_mantel: state.aktiv_mantel === id ? null : id };
}

function int(v: unknown, max = 1_000_000_000): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, Math.floor(v)));
}

function uniqueStickers(v: unknown): StickerId[] {
  if (!Array.isArray(v)) return [];
  const out: StickerId[] = [];
  for (const item of v) {
    if (!isStickerId(item) || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

function uniqueCosmetics(v: unknown): CosmeticId[] {
  if (!Array.isArray(v)) return [];
  const out: CosmeticId[] = [];
  for (const item of v) {
    if (!isCosmeticId(item) || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

function uniqueDates(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !isIsoDate(item) || out.includes(item)) continue;
    out.push(item);
  }
  out.sort();
  if (out.length > 4000) return out.slice(-4000);
  return out;
}

const BUCKET_RE = /^(matte|svenska|engelska|lasforstaelse):(forskola|ak1|ak2|ak3|ak4_6|ak7_9|gymnasiet|vuxen)$/;

function parseBuckets(v: unknown): Record<string, SubjectCorrect> {
  if (!isRecord(v)) return {};
  const out: Record<string, SubjectCorrect> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!BUCKET_RE.test(key) || !isRecord(raw)) continue;
    const ratt = int(raw.ratt);
    if (ratt <= 0) continue;
    out[key] = { ratt };
  }
  return out;
}

function parseDaily(v: unknown, today: string): DailyProgress {
  if (!isRecord(v) || typeof v.datum !== 'string' || !isIsoDate(v.datum)) {
    return { datum: today, ratt: 0, mal_klart: false };
  }
  return { datum: v.datum, ratt: int(v.ratt, 100_000), mal_klart: v.mal_klart === true };
}

function ownedSlot(id: unknown, owned: readonly CosmeticId[], slot: CosmeticSlot): CosmeticId | null {
  if (!isCosmeticId(id) || !owned.includes(id)) return null;
  return cosmeticById(id)?.typ === slot ? id : null;
}

/** Nollställer dagens räknare när kalenderdagen i Stockholm har bytts. */
export function rollToToday(state: RewardState, now: Date = new Date()): RewardState {
  const today = stockholmDate(now);
  if (state.dagligt.datum === today) return state;
  return { ...state, dagligt: { datum: today, ratt: 0, mal_klart: false } };
}

/** null när v saknas eller är okänd. v:1 tvättas till en giltig struktur. */
export function parseRewards(raw: unknown, now: Date = new Date()): RewardState | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const today = stockholmDate(now);
  const upplast = uniqueCosmetics(raw.upplast);
  const streak = int(raw.streak);
  const langsta = Math.max(int(raw.langsta_streak), streak);
  return {
    v: 1,
    stjarnor: int(raw.stjarnor),
    streak,
    langsta_streak: langsta,
    ratt_totalt: int(raw.ratt_totalt),
    klistermarken: uniqueStickers(raw.klistermarken),
    upplast,
    aktiv_hatt: ownedSlot(raw.aktiv_hatt, upplast, 'hatt'),
    aktiv_mantel: ownedSlot(raw.aktiv_mantel, upplast, 'mantel'),
    dagligt: parseDaily(raw.dagligt, today),
    dagar_mal_klart: uniqueDates(raw.dagar_mal_klart),
    per_amne_niva: parseBuckets(raw.per_amne_niva),
    champions_ok: int(raw.champions_ok),
    bossar_ok: int(raw.bossar_ok),
    blandat_ratt: int(raw.blandat_ratt),
  };
}

export function serializeRewards(state: RewardState): RewardState {
  return {
    v: 1,
    stjarnor: state.stjarnor,
    streak: state.streak,
    langsta_streak: state.langsta_streak,
    ratt_totalt: state.ratt_totalt,
    klistermarken: [...state.klistermarken],
    upplast: [...state.upplast],
    aktiv_hatt: state.aktiv_hatt,
    aktiv_mantel: state.aktiv_mantel,
    dagligt: { ...state.dagligt },
    dagar_mal_klart: [...state.dagar_mal_klart],
    per_amne_niva: structuredClone(state.per_amne_niva),
    champions_ok: state.champions_ok,
    bossar_ok: state.bossar_ok,
    blandat_ratt: state.blandat_ratt,
  };
}

function backupOnce(store: KeyValueStore, key: string, raw: string): void {
  try {
    if (store.get(key)) return;
    store.set(key, raw);
  } catch {
    /* backup är bäst att försöka, inte värt att krascha lärläget */
  }
}

export function saveRewards(store: KeyValueStore, state: RewardState): boolean {
  try {
    store.set(REWARD_STORAGE_KEY, JSON.stringify(serializeRewards(state)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Läser rk_laro_beloning. Okänd eller trasig version sparas en gång i *_bak
 * och ersätts med tom struktur. rk_laro lämnas orörd.
 */
export function loadRewards(store: KeyValueStore, now: Date = new Date()): RewardState {
  let raw: string | null;
  try {
    raw = store.get(REWARD_STORAGE_KEY);
  } catch {
    return defaultRewardState(now);
  }
  if (!raw) return defaultRewardState(now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    backupOnce(store, REWARD_BACKUP_KEY, raw);
    const fresh = defaultRewardState(now);
    saveRewards(store, fresh);
    return fresh;
  }
  const state = parseRewards(parsed, now);
  if (!state) {
    backupOnce(store, REWARD_BACKUP_KEY, raw);
    const fresh = defaultRewardState(now);
    saveRewards(store, fresh);
    return fresh;
  }
  const rolled = rollToToday(state, now);
  if (rolled !== state) saveRewards(store, rolled);
  return rolled;
}

export function resetRewards(store: KeyValueStore, now: Date = new Date()): RewardState {
  const fresh = defaultRewardState(now);
  saveRewards(store, fresh);
  return fresh;
}
