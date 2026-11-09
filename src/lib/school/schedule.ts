// Jadwal pelajaran dari portal sekolah (tabel Day, Begin, End, Room, Subject, Teacher(s)) yang dikirim ekstensi browser.
// Ekstensi sudah meratakan sel yang menyatu antar baris (hari) dan memisahkan nama mapel dua bahasa dengan " | ".

import { parsePeriod, type RawTable } from "./parse";

export interface Lesson {
  /** Unik per pelajaran: periode, hari, dan jam mulai. */
  key: string;
  /** Hari menurut Date.getDay(): 0 Minggu sampai 6 Sabtu. */
  day: number;
  /** "HH:MM". */
  begin: string;
  end: string;
  room: string;
  /** Nama mapel dalam bahasa Inggris bila ada (sama dengan nama di tabel nilai), selain itu apa adanya. */
  subject: string;
  /** Nama mapel dalam bahasa portal (mis. Indonesia). */
  subjectLocal: string;
  teachers: string[];
  period: string;
  grade: string;
  term: string;
  year: string;
}

const DAYS: Record<string, number> = {
  sunday: 0, minggu: 0, monday: 1, senin: 1, tuesday: 2, selasa: 2, wednesday: 3, rabu: 3,
  thursday: 4, kamis: 4, friday: 5, jumat: 5, "jum'at": 5, saturday: 6, sabtu: 6,
};

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const hhmm = (t: string): string | null => {
  const m = TIME.exec(t.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};

const col = (headers: string[], words: string[]) => headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));

/** Baca semua tabel jadwal pada kiriman; tabel lain diabaikan. Baris "No schedule" (Sabtu dan Minggu) dilewati. */
export function parseSchedule(tables: RawTable[], periodText = ""): Lesson[] {
  const period = parsePeriod(periodText);
  const out = new Map<string, Lesson>();
  for (const t of tables) {
    const c = {
      day: col(t.headers, ["day", "hari"]),
      begin: col(t.headers, ["begin", "start", "mulai"]),
      end: col(t.headers, ["end", "selesai"]),
      room: col(t.headers, ["room", "ruang"]),
      subject: col(t.headers, ["subject", "mata pelajaran", "mapel"]),
      teacher: col(t.headers, ["teacher", "guru"]),
    };
    if (c.day < 0 || c.begin < 0 || c.end < 0 || c.subject < 0) continue;
    for (const row of t.rows) {
      const day = DAYS[(row[c.day] ?? "").trim().toLowerCase()];
      const begin = hhmm(row[c.begin] ?? "");
      const end = hhmm(row[c.end] ?? "");
      if (day === undefined || !begin || !end) continue;
      const parts = (row[c.subject] ?? "").split("|").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const subjectLocal = parts[0];
      const subject = parts[parts.length - 1];
      const lesson: Lesson = {
        key: [period.label, day, begin].join("|"),
        day,
        begin,
        end,
        room: c.room >= 0 ? (row[c.room] ?? "").trim() : "",
        subject,
        subjectLocal,
        teachers: c.teacher >= 0 ? (row[c.teacher] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [],
        period: period.label,
        grade: period.grade,
        term: period.term,
        year: period.year,
      };
      out.set(lesson.key, lesson);
    }
  }
  return [...out.values()].sort((a, b) => a.day - b.day || a.begin.localeCompare(b.begin));
}

/** Gabungkan: tiap periode di kiriman baru menggantikan isi lamanya; periode lain dipertahankan. */
export function mergeLessons(old: Lesson[], fresh: Lesson[]): Lesson[] {
  const replaced = new Set(fresh.map((l) => l.period));
  return [...old.filter((l) => !replaced.has(l.period)), ...fresh].sort((a, b) => a.day - b.day || a.begin.localeCompare(b.begin));
}

/** Periode jadwal yang dipakai sekarang: tahun ajaran terbaru, lalu semester yang terakhir muncul menurut urutan data (Second di atas First). */
export function currentPeriod(lessons: Lesson[]): string | null {
  const periods = [...new Set(lessons.map((l) => l.period))];
  if (!periods.length) return null;
  const rank = (p: string) => {
    const l = lessons.find((x) => x.period === p)!;
    const termRank = /second|genap|2/i.test(l.term) ? 2 : 1;
    return `${l.year}-${termRank}`;
  };
  return periods.sort((a, b) => rank(b).localeCompare(rank(a)))[0];
}

/** Pelajaran pada tanggal tertentu, urut jam. */
export function lessonsOn(lessons: Lesson[], period: string | null, date: Date): Lesson[] {
  if (!period) return [];
  return lessons.filter((l) => l.period === period && l.day === date.getDay()).sort((a, b) => a.begin.localeCompare(b.begin));
}

/** Waktu (ms) pelajaran pada tanggal itu. */
export function lessonTimes(l: Lesson, date: Date): { start: number; end: number } {
  const at = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime();
  };
  return { start: at(l.begin), end: at(l.end) };
}
