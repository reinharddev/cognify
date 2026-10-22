import { dateLocale, i18n, tr } from "$lib/i18n.svelte";
// Rentang waktu untuk blok kalender di dokumen: pilihan siap pakai atau tanggal sendiri.
import { monthName, addDays, parseDayKey, startOfDay } from "./dates";

export type RangeKind = "today" | "week" | "month" | "next7" | "next14" | "next30" | "custom";

const RANGE_ID: Record<RangeKind, string> = {
  today: "Hari ini",
  week: "Pekan ini",
  month: "Bulan ini",
  next7: "7 hari ke depan",
  next14: "14 hari ke depan",
  next30: "30 hari ke depan",
  custom: "Pilih tanggal sendiri",
};
const RANGE_EN: Record<RangeKind, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  next7: "Next 7 days",
  next14: "Next 14 days",
  next30: "Next 30 days",
  custom: "Pick your own dates",
};
export const rangeLabel = (k: RangeKind) => (i18n.lang === "en" ? RANGE_EN[k] : RANGE_ID[k]);

export interface RangeAttrs {
  range: RangeKind;
  /** "YYYY-MM-DD", dipakai bila range = custom. */
  from: string;
  to: string;
}

/** Awal dan akhir (ms, akhir = sebelum tengah malam hari terakhir) untuk rentang yang dipilih. */
export function resolveRange(a: RangeAttrs, now = Date.now(), weekStart: 0 | 1 = 1): { from: number; to: number } {
  const today = startOfDay(now);
  const end = (lastDay: number) => addDays(lastDay, 1) - 1;
  switch (a.range) {
    case "today":
      return { from: today, to: end(today) };
    case "week": {
      const dow = new Date(today).getDay(); // 0 = Minggu
      const back = weekStart === 1 ? (dow + 6) % 7 : dow;
      const from = addDays(today, -back);
      return { from, to: end(addDays(from, 6)) };
    }
    case "month": {
      const d = new Date(today);
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      return { from, to: end(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime()) };
    }
    case "next7":
      return { from: today, to: end(addDays(today, 6)) };
    case "next14":
      return { from: today, to: end(addDays(today, 13)) };
    case "next30":
      return { from: today, to: end(addDays(today, 29)) };
    case "custom": {
      const f = parseDayKey(a.from) ?? today;
      const t = parseDayKey(a.to) ?? f;
      return { from: Math.min(f, t), to: end(Math.max(f, t)) };
    }
  }
}

/** Judul pendek rentang, misalnya "Oktober 2026" atau "12 Okt sampai 18 Okt 2026". */
export function describeRange(a: RangeAttrs, weekStart: 0 | 1 = 1): string {
  const { from, to } = resolveRange(a, Date.now(), weekStart);
  if (a.range === "month") return `${monthName(new Date(from).getMonth())} ${new Date(from).getFullYear()}`;
  const fmt = (ms: number, year: boolean) => new Date(ms).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const last = startOfDay(to);
  return from === last ? fmt(from, true) : `${fmt(from, false)} ${tr("sampai", "to")} ${fmt(last, true)}`;
}
