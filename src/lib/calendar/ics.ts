// Pembaca kalender iCalendar (.ics) secukupnya (disalin dari Cognify Notch untuk Windows; tesnya ada di ics.test.ts): acara tunggal, zona waktu (TZID dan UTC), acara sehari
// penuh, dan pengulangan sederhana (harian, mingguan dengan BYDAY, bulanan, tahunan; INTERVAL, UNTIL,
// COUNT, EXDATE). Pengulangan yang lebih rumit hanya diambil kemunculan pertamanya.

export interface AgendaEvent {
  id: string;
  title: string;
  start: number;
  end: number | null;
  allDay: boolean;
  meeting: string | null;
}

const MEETING = /https:\/\/[^\s<>"']*(zoom\.us\/(j|my|w|s)\/|meet\.google\.com\/[a-z]|teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|webex\.com\/(meet|join|[a-z0-9.-]+\/j\.php))[^\s<>"']*/i;

export const meetingUrl = (...texts: (string | undefined)[]) => {
  for (const t of texts) {
    const m = t && MEETING.exec(t);
    if (m) return m[0].replace(/[.,;)>]+$/, '');
  }
  return null;
};

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

interface Prop { name: string; params: Record<string, string>; value: string }

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const [name, ...rest] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const r of rest) { const [k, v] = r.split('='); if (k && v) params[k.toUpperCase()] = v.replace(/"/g, ''); }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

// Selisih zona waktu (ms) pada saat tertentu, lewat Intl.
function zoneOffset(at: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at / 1000) * 1000;
  } catch {
    return -new Date(at).getTimezoneOffset() * 60_000;
  }
}

function parseDate(p: Prop): { t: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (m[4] === undefined) return { t: new Date(y, mo, d).getTime(), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[7]) return { t: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  if (p.params.TZID) {
    const guess = Date.UTC(y, mo, d, h, mi, s);
    return { t: guess - zoneOffset(guess - zoneOffset(guess, p.params.TZID), p.params.TZID), allDay: false };
  }
  return { t: new Date(y, mo, d, h, mi, s).getTime(), allDay: false };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Kemunculan acara berulang di dalam [from, to]. */
function occurrences(start: number, rule: string, exdates: Set<number>, from: number, to: number): number[] {
  const r: Record<string, string> = {};
  for (const part of rule.split(';')) { const [k, v] = part.split('='); if (k) r[k] = v; }
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const until = r.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: r.UNTIL.length === 8 ? r.UNTIL : r.UNTIL })?.t ?? Infinity : Infinity;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const first = new Date(start);
  const byday = (r.BYDAY ?? '').split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((i) => i >= 0);
  const weekStart = new Date(first); weekStart.setDate(first.getDate() - ((first.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0);
  const found: number[] = [];
  let n = 0;
  const day = new Date(first);
  for (let i = 0; i < 4000 && day.getTime() <= Math.min(to, until); i++, day.setDate(day.getDate() + 1)) {
    const diffDays = Math.round((new Date(day).setHours(0, 0, 0, 0) - new Date(first).setHours(0, 0, 0, 0)) / 864e5);
    let hit = false;
    switch (r.FREQ) {
      case 'DAILY': hit = diffDays % interval === 0; break;
      case 'WEEKLY': {
        const weeks = Math.floor((new Date(day).setHours(0, 0, 0, 0) - weekStart.getTime()) / (7 * 864e5));
        hit = weeks % interval === 0 && (byday.length ? byday : [first.getDay()]).includes(day.getDay());
        break;
      }
      case 'MONTHLY': hit = day.getDate() === first.getDate() && ((day.getFullYear() - first.getFullYear()) * 12 + day.getMonth() - first.getMonth()) % interval === 0; break;
      case 'YEARLY': hit = day.getDate() === first.getDate() && day.getMonth() === first.getMonth() && (day.getFullYear() - first.getFullYear()) % interval === 0; break;
      default: return [start];
    }
    if (!hit) continue;
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), first.getHours(), first.getMinutes(), first.getSeconds()).getTime();
    if (t < start) continue;
    if (++n > count) break;
    if (t >= from && !exdates.has(t)) found.push(t);
  }
  return found;
}

/** Acara yang berlangsung atau mulai di antara `from` dan `to` (ms), urut waktu. */
export function parseIcs(text: string, from: number, to: number): AgendaEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: AgendaEvent[] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT' && cur) {
      const get = (n: string) => cur!.find((p) => p.name === n);
      const s = get('DTSTART') && parseDate(get('DTSTART')!);
      if (s && get('STATUS')?.value !== 'CANCELLED') {
        const e = get('DTEND') && parseDate(get('DTEND')!);
        const length = e ? e.t - s.t : s.allDay ? 864e5 : 0;
        const title = unescape(get('SUMMARY')?.value ?? '(tanpa judul)');
        const meeting = meetingUrl(get('URL')?.value, unescape(get('LOCATION')?.value ?? ''), unescape(get('DESCRIPTION')?.value ?? ''));
        const uid = get('UID')?.value ?? title;
        const ex = new Set(cur.filter((p) => p.name === 'EXDATE').flatMap((p) => p.value.split(',').map((v) => parseDate({ ...p, value: v })?.t ?? 0)));
        const rule = get('RRULE')?.value;
        const starts = rule ? occurrences(s.t, rule, ex, from - length, to) : [s.t];
        for (const t of starts) {
          if (t + length < from || t > to) continue;
          events.push({ id: `${uid}@${t}`, title, start: t, end: length ? t + length : null, allDay: s.allDay, meeting });
        }
      }
      cur = null;
      continue;
    }
    if (cur) { const p = parseLine(line); if (p) cur.push(p); }
  }
  return events.sort((a, b) => a.start - b.start);
}
