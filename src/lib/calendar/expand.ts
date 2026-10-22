// Memperluas acara buatan pengguna menjadi kemunculan di sebuah rentang waktu.
// Pengulangan dihitung dengan tanggal lokal, jadi jam dinding acara tetap sama saat jam musim panas berganti.

import { addDays, parseDayKey, startOfDay } from "./dates";
import type { CalEvent, Occurrence } from "./types";

const MAX_STEPS = 20_000;

export function eventStartMs(e: Pick<CalEvent, "start" | "allDay">): number | null {
  if (e.allDay) return parseDayKey(e.start);
  const t = Date.parse(e.start);
  return Number.isNaN(t) ? null : t;
}

function eventEndMs(e: CalEvent, start: number): number | null {
  if (!e.end) return null;
  // Sehari penuh: tanggal selesai di formulir termasuk hari itu, jadi akhirnya eksklusif (tengah malam sesudahnya),
  // sama seperti ICS.
  const raw = e.allDay ? parseDayKey(e.end) : Date.parse(e.end);
  if (raw === null || Number.isNaN(raw)) return null;
  const end = e.allDay ? addDays(raw, 1) : raw;
  return end > start || (!e.allDay && end === start) ? end : null;
}

/** Waktu mulai kemunculan ke-`n` (n = 0 adalah acara aslinya), dengan jam dinding lokal yang sama. */
function nthStart(first: Date, repeat: CalEvent["repeat"], n: number): number {
  const h = first.getHours(), mi = first.getMinutes(), s = first.getSeconds(), ms = first.getMilliseconds();
  let y = first.getFullYear(), mo = first.getMonth(), d = first.getDate();
  switch (repeat) {
    case "daily": d += n; break;
    case "weekly": d += 7 * n; break;
    case "monthly": {
      mo += n;
      const last = new Date(y, mo + 1, 0).getDate(); // hari terakhir bulan tujuan (31 Jan menjadi 28 Feb)
      d = Math.min(d, last);
      break;
    }
    case "yearly": {
      y += n;
      d = Math.min(d, new Date(y, mo + 1, 0).getDate()); // 29 Feb menjadi 28 Feb di tahun biasa
      break;
    }
    default: break;
  }
  return new Date(y, mo, d, h, mi, s, ms).getTime();
}

/** Kemunculan `e` yang beririsan dengan [from, to] (ms), terurut. */
export function expandEvent(e: CalEvent, from: number, to: number): Occurrence[] {
  const start0 = eventStartMs(e);
  if (start0 === null) return [];
  const end0 = eventEndMs(e, start0);
  const length = end0 === null ? 0 : end0 - start0;
  const until = e.repeatUntil ? parseDayKey(e.repeatUntil) : null;
  const first = new Date(start0);
  const out: Occurrence[] = [];

  const push = (start: number) => {
    // Panjang acara dihitung ulang di tanggal baru supaya acara beberapa hari tetap utuh saat jam berganti.
    const end = end0 === null ? null : e.allDay ? addDays(start, Math.round(length / 864e5)) : start + length;
    if ((end ?? start) < from || start > to) return;
    out.push({
      key: `${e.id}@${start}`, title: e.title, start, end, allDay: e.allDay, origin: "local", calendar: null,
      color: e.color, eventId: e.id, meeting: null, notes: e.notes, remindMin: e.remindMin,
    });
  };

  if (e.repeat === "none") {
    push(start0);
    return out;
  }
  for (let n = 0; n < MAX_STEPS; n++) {
    const start = nthStart(first, e.repeat, n);
    if (start > to) break;
    if (until !== null && startOfDay(start) > until) break;
    push(start);
  }
  return out;
}
