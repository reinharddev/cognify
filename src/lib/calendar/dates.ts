// Pembantu tanggal untuk Kalender. Semua perhitungan hari memakai zona waktu lokal.

export const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const WEEKDAYS_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Nama hari singkat menurut hari pertama pekan (1 = Senin, 0 = Minggu). */
export const weekdayLabels = (weekStart: 0 | 1): string[] =>
  weekStart === 1 ? WEEKDAYS_SHORT : [WEEKDAYS_SHORT[6], ...WEEKDAYS_SHORT.slice(0, 6)];

export const startOfDay = (ms: number): number => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

export const addDays = (ms: number, n: number): number => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);

/** "2026-10-22" dari tanggal lokal. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Tengah malam lokal dari "YYYY-MM-DD"; null bila bentuknya salah. */
export function parseDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d.getTime() : null;
}

/**
 * Sel bulan untuk tampilan kalender: selalu 6 pekan (42 hari), pekan mulai Senin (atau Minggu, `weekStart` 0), termasuk hari dari
 * bulan sebelum dan sesudahnya. `month` berbasis 0.
 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1 = 1): { ms: number; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7; // hari pertama pekan = 0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { ms: d.getTime(), inMonth: d.getMonth() === month };
  });
}

export const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", ".");

export const longDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Nilai untuk `<input type="date">` dan `<input type="time">` dari waktu lokal. */
export const inputDate = (ms: number): string => dayKey(ms);
export const inputTime = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Gabungkan tanggal dan jam lokal dari isian formulir menjadi ms; null bila salah. */
export function fromInputs(date: string, time: string): number | null {
  const day = parseDayKey(date);
  const m = /^(\d{2}):(\d{2})$/.exec(time || "00:00");
  if (day === null || !m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(day);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}
