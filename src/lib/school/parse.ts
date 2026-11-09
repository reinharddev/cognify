// Tabel tugas dan ujian dari portal sekolah (dikirim ekstensi browser) menjadi daftar yang bisa dipakai Cognify.
// Hanya membaca bentuk tabelnya: judul kolom dikenali dengan kata kunci, tanpa alamat atau akun tertentu.

export interface RawTable {
  headers: string[];
  rows: string[][];
}

export interface SchoolItem {
  /** Unik per tugas: jenis, mata pelajaran, deskripsi, dan tenggat. */
  key: string;
  /** Jenis apa adanya dari portal ("Assignment", "Daily Exam", ...). */
  kind: string;
  subject: string;
  description: string;
  /** Waktu diberikan dan tenggat, epoch ms; null bila kosong. */
  given: number | null;
  due: number | null;
  /** Nilai 0 sampai 100; null bila belum dinilai ("N/A", kosong). */
  score: number | null;
  /** Nilai bertanda bintang di portal ("70 *"): disesuaikan, mis. diangkat ke batas lulus. */
  adjusted: boolean;
  /** Periode dari portal, mis. "12.2 / First / 2026-2027"; dipecah jadi kelas, semester, dan tahun ajaran. Kosong bila tidak diketahui. */
  period: string;
  grade: string;
  term: string;
  year: string;
}

export interface Period {
  label: string;
  grade: string;
  term: string;
  year: string;
}

/** Nilai di bawah angka ini ditandai merah di portal (70 lulus, 68 tidak); dipakai untuk hitungan "di bawah batas". */
export const PASS_MARK = 70;

/** "12.2 / First / 2026-2027" → kelas, semester, tahun ajaran. Bagian yang tidak ada dibiarkan kosong. */
export function parsePeriod(text: string): Period {
  const label = text.replace(/\s+/g, " ").trim();
  const year = /(\d{4})\s*-\s*(\d{4})/.exec(label);
  const parts = label.split("/").map((p) => p.trim()).filter(Boolean);
  const rest = parts.filter((p) => !/\d{4}\s*-\s*\d{4}/.test(p));
  return { label, grade: rest[0] ?? "", term: rest[1] ?? "", year: year ? `${year[1]}-${year[2]}` : "" };
}

const COLUMNS: Record<"kind" | "subject" | "description" | "given" | "due" | "score", string[]> = {
  kind: ["type", "jenis", "tipe"],
  subject: ["subject", "mata pelajaran", "mapel", "pelajaran"],
  description: ["description", "deskripsi", "keterangan", "judul"],
  given: ["time given", "given", "diberikan", "tanggal diberikan"],
  due: ["due time", "due", "tenggat", "batas waktu", "dikumpulkan"],
  score: ["competency", "score", "nilai", "achievement"],
};

function indexOfColumn(headers: string[], words: string[]): number {
  return headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));
}

/** "2026-11-04 14:00:00" (waktu setempat) → epoch ms. */
export function parseWhen(text: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
  return Number.isFinite(t) ? t : null;
}

export function parseScore(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d+))?\s*\*?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(`${m[1]}.${m[2] ?? "0"}`);
  return n >= 0 && n <= 100 ? n : null;
}

/** Ambil semua baris tugas dari tabel-tabel yang dikenali; tabel lain (mis. jadwal) diabaikan. */
export function parseTables(tables: RawTable[], periodText = ""): SchoolItem[] {
  const period = parsePeriod(periodText);
  const out = new Map<string, SchoolItem>();
  for (const t of tables) {
    const seen = new Map<string, number>(); // baris kembar dalam satu tabel diberi nomor supaya tidak saling menimpa
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, w]) => [k, indexOfColumn(t.headers, w)])) as Record<keyof typeof COLUMNS, number>;
    if (col.subject < 0 || col.due < 0) continue;
    for (const row of t.rows) {
      const cell = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
      const subject = cell(col.subject);
      // Baris judul yang terselip di antara data bukan tugas.
      if (!subject || subject.toLowerCase() === t.headers[col.subject]?.trim().toLowerCase()) continue;
      const item: SchoolItem = {
        key: "",
        kind: cell(col.kind) || "Assignment",
        subject,
        description: cell(col.description),
        given: parseWhen(cell(col.given)),
        due: parseWhen(cell(col.due)),
        score: parseScore(cell(col.score)),
        adjusted: /\*\s*$/.test(cell(col.score)),
        period: period.label,
        grade: period.grade,
        term: period.term,
        year: period.year,
      };
      const base = [item.period, item.kind, item.subject, item.description, item.due ?? ""].join("|");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      item.key = n === 1 ? base : `${base}#${n}`;
      out.set(item.key, item);
    }
  }
  return [...out.values()];
}

/**
 * Gabungkan hasil baru dengan yang tersimpan. Tiap periode yang ada di kiriman baru MENGGANTIKAN isi lamanya
 * (mapel dan penilaian yang sudah tidak ada di portal ikut hilang); periode lain dipertahankan.
 */
export function mergeItems(old: SchoolItem[], fresh: SchoolItem[]): SchoolItem[] {
  const replaced = new Set(fresh.map((i) => i.period));
  const kept = old.filter((i) => !replaced.has(i.period));
  const map = new Map(kept.map((i) => [i.key, i]));
  for (const i of fresh) map.set(i.key, i);
  return [...map.values()].sort((a, b) => (b.due ?? 0) - (a.due ?? 0));
}

export interface SubjectSummary {
  subject: string;
  average: number | null;
  graded: number;
  total: number;
}

/** Rata-rata nilai per mata pelajaran (hanya yang sudah dinilai), mata pelajaran A-Z. */
export function summarize(items: SchoolItem[]): SubjectSummary[] {
  const by = new Map<string, SchoolItem[]>();
  for (const i of items) by.set(i.subject, [...(by.get(i.subject) ?? []), i]);
  return [...by.entries()]
    .map(([subject, list]) => {
      const scores = list.map((i) => i.score).filter((s): s is number => s !== null);
      return {
        subject,
        average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
        graded: scores.length,
        total: list.length,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}
