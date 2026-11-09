/** Kalender i Europe/Stockholm. Dagligt mål och per_dag följer den, inte UTC. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** YYYY-MM-DD för ett ögonblick, i Stockholm. */
export function stockholmDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** ISO-lik tid med offset, t.ex. 2026-11-09T22:00:00+01:00. */
export function stockholmTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00';
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  const off = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    timeZoneName: 'longOffset',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}T${hour}:${pick('minute')}:${pick('second')}${offsetLabel(off)}`;
}

function offsetLabel(raw: string | undefined): string {
  if (!raw || raw === 'GMT') return '+00:00';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(raw);
  if (!m) return '+00:00';
  const sign = m[1] ?? '+';
  const hh = (m[2] ?? '0').padStart(2, '0');
  const mm = (m[3] ?? '00').padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Flytta ett kalenderdatum utan att blanda in sommartid. */
export function addCalendarDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta, 12, 0, 0));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const WEEKDAY_LETTER: Record<string, string> = {
  mån: 'M',
  tis: 'T',
  ons: 'O',
  tor: 'T',
  fre: 'F',
  lör: 'L',
  sön: 'S',
};

/** En bokstav: M T O T F L S. */
export function weekdayLetter(isoDate: string): string {
  if (!isIsoDate(isoDate)) return '';
  const dt = new Date(`${isoDate}T12:00:00Z`);
  const short = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'short' }).format(dt);
  return WEEKDAY_LETTER[short.slice(0, 3)] ?? short.slice(0, 1).toUpperCase();
}

/** Läsbar tid för vårdnadshavare, fortfarande i Stockholm. */
export function formatStockholmStamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dt);
  return `${date} kl. ${time}`;
}

/** Senaste `count` kalenderdagar, äldst först, som slutar på Stockholms datum för `now`. */
export function recentStockholmDates(now: Date, count: number): string[] {
  const today = stockholmDate(now);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addCalendarDays(today, -i));
  return out;
}
