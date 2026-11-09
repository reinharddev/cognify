// Kehadiran harian dari portal sekolah. Ekstensi mengubah JSON kalender portal jadi baris [tanggal, status, jam masuk,
// jam pulang]; di sini dibaca, dihitung per semester, dan dihitung sisa jatah absennya.

import type { RawTable } from "./parse";

export type AttendanceKind = "present" | "late" | "permit" | "sick" | "absent" | "other";

export interface AttendanceDay {
  /** "YYYY-MM-DD". */
  date: string;
  /** Status apa adanya dari portal ("Present", "Permitted", ...). */
  status: string;
  kind: AttendanceKind;
  checkIn: string;
  checkOut: string;
}

/** Status portal (Inggris dan Indonesia) → jenis. Yang tidak dikenal jadi "other" supaya tetap terlihat, tidak hilang. */
export function classify(status: string): AttendanceKind {
  const s = status.trim().toLowerCase();
  if (/present|hadir/.test(s)) return "present";
  if (/late|terlambat|telat/.test(s)) return "late";
  if (/permit|izin|ijin/.test(s)) return "permit";
  if (/sick|sakit/.test(s)) return "sick";
  if (/absent|alpha|alpa|mangkir|tanpa keterangan/.test(s)) return "absent";
  return "other";
}

export function parseAttendance(tables: RawTable[]): AttendanceDay[] {
  const out = new Map<string, AttendanceDay>();
  for (const t of tables) {
    const date = t.headers.findIndex((h) => /date|tanggal/i.test(h));
    const status = t.headers.findIndex((h) => /status/i.test(h));
    if (date < 0 || status < 0) continue;
    const inI = t.headers.findIndex((h) => /check ?in|masuk/i.test(h));
    const outI = t.headers.findIndex((h) => /check ?out|pulang/i.test(h));
    for (const row of t.rows) {
      const d = (row[date] ?? "").trim();
      const st = (row[status] ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !st) continue;
      out.set(d, { date: d, status: st, kind: classify(st), checkIn: inI >= 0 ? (row[inI] ?? "").trim() : "", checkOut: outI >= 0 ? (row[outI] ?? "").trim() : "" });
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Tiap hari di kiriman baru menggantikan hari yang sama; hari lain dipertahankan. */
export function mergeAttendance(old: AttendanceDay[], fresh: AttendanceDay[]): AttendanceDay[] {
  const map = new Map(old.map((d) => [d.date, d]));
  for (const d of fresh) map.set(d.date, d);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Semester dari tanggal: Juli sampai Desember = First tahun ajaran y-(y+1); Januari sampai Juni = Second tahun ajaran (y-1)-y. */
export function semesterOf(date: string): { year: string; term: "First" | "Second" } {
  const [y, m] = date.split("-").map(Number);
  return m >= 7 ? { year: `${y}-${y + 1}`, term: "First" } : { year: `${y - 1}-${y}`, term: "Second" };
}

export interface AttendanceSummary {
  /** Hari yang tercatat (semua status). */
  recorded: number;
  present: number;
  late: number;
  permit: number;
  sick: number;
  absent: number;
  other: number;
  /** Persen hadir (hadir dan terlambat) dari hari yang tercatat; null bila belum ada data. */
  pct: number | null;
  /** Berapa hari lagi boleh tidak hadir tanpa turun di bawah batas; 0 bila sudah di bawah batas. */
  canMiss: number;
  /** Berapa hari hadir berturut-turut yang dibutuhkan untuk kembali ke batas; 0 bila sudah di atasnya. */
  needPresent: number;
  /** Jam masuk rata-rata ("HH:MM"), bila ada datanya. */
  avgCheckIn: string | null;
}

export function summarizeAttendance(days: AttendanceDay[], minPct = 75): AttendanceSummary {
  const n = (k: AttendanceKind) => days.filter((d) => d.kind === k).length;
  const present = n("present");
  const late = n("late");
  const attended = present + late;
  const f = Math.min(0.99, Math.max(0.01, minPct / 100));
  const recorded = days.length;
  const mins = days
    .map((d) => /^(\d{1,2}):(\d{2})/.exec(d.checkIn))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
  const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null;
  return {
    recorded,
    present,
    late,
    permit: n("permit"),
    sick: n("sick"),
    absent: n("absent"),
    other: n("other"),
    pct: recorded ? Math.round((attended / recorded) * 1000) / 10 : null,
    canMiss: recorded ? Math.max(0, Math.floor(attended / f - recorded + 1e-9)) : 0,
    needPresent: recorded && attended / recorded < f ? Math.ceil((f * recorded - attended) / (1 - f) - 1e-9) : 0,
    avgCheckIn: avg === null ? null : `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
  };
}
