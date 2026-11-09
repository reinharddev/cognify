// Perhitungan nilai sekolah: murni hitungan, tanpa tampilan. Semua angka dibulatkan satu desimal.

import type { SchoolItem } from "./parse";

export interface Filter {
  /** Tahun ajaran ("2026-2027") atau "" untuk semua. */
  year: string;
  /** Semester ("First") atau "" untuk semua. */
  term: string;
}

/** Penjurusan: kelas umum sampai `fromLevel - 1`, lalu sejak `fromLevel` murid punya jurusan dengan mapel peminatan. */
export interface MajorSettings {
  /** Sudah berjurusan (kelas mulai ke atas punya mapel peminatan). */
  enabled: boolean;
  /** Nama jurusan, hanya label ("IPA", "Bahasa", ...); boleh kosong. */
  name: string;
  /** Mapel peminatan dideteksi otomatis dari struktur mapel kelas; false bila pengguna mengubahnya sendiri. */
  auto: boolean;
  /** Kelas pertama yang berjurusan (di Indonesia umumnya 11). */
  fromLevel: number;
  /** Mapel peminatan jurusan ini, huruf besar kecil diabaikan. */
  subjects: string[];
  /** Pengali bobot mapel peminatan dalam rata-rata keseluruhan (1 = sama dengan mapel umum). */
  boost: number;
}

/** Pengaturan hitungan yang bisa diubah pengguna (halaman Nilai > Hitungan). */
export interface CalcSettings {
  /** Batas lulus (KKM). Di bawah ini dihitung kurang. */
  passMark: number;
  /** Target rata-rata yang ingin dicapai. */
  target: number;
  /** Bobot per jenis penilaian untuk rata-rata berbobot; jenis yang tidak terdaftar berbobot 1. */
  weights: Record<string, number>;
  major: MajorSettings;
  /** Batas kehadiran minimum dalam persen; di bawah ini sekolah biasanya menganggap tidak memenuhi syarat. */
  minAttendance: number;
}

export const DEFAULT_CALC: CalcSettings = {
  passMark: 70,
  target: 85,
  weights: { Assignment: 1, "Daily Exam": 2, "Mid Exam": 3, "Final Exam": 3 },
  major: { enabled: false, name: "", auto: true, fromLevel: 11, subjects: [], boost: 1.5 },
  minAttendance: 75,
};

/** Kelas dari nama kelas portal: "12.2" → 12, "Kelas 10.1" → 10; null bila tidak terbaca. */
export function levelOf(grade: string): number | null {
  const m = /(\d{1,2})(?:\.\d+)?/.exec(grade);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 13 ? n : null;
}

/** Penilaian ini termasuk mapel peminatan: jurusan sudah dipilih, kelasnya sudah berjurusan, dan mapelnya terdaftar. */
export function inMajor(item: SchoolItem, s: CalcSettings): boolean {
  const m = s.major;
  if (!m.enabled || !m.subjects.length) return false;
  const level = levelOf(item.grade);
  if (level !== null && level < m.fromLevel) return false; // kelas umum
  const subject = item.subject.toLowerCase();
  return m.subjects.some((x) => x.toLowerCase() === subject);
}

export const weightOf = (s: CalcSettings, kind: string) => {
  const w = s.weights[kind];
  return typeof w === "number" && w >= 0 ? w : 1;
};

export const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
type Scored = SchoolItem & { score: number };
export const scored = (items: SchoolItem[]) => items.filter((i) => i.score !== null) as Scored[];
const byDue = (a: SchoolItem, b: SchoolItem) => (a.due ?? Infinity) - (b.due ?? Infinity);

// ---------- Filter periode ----------

export function years(items: SchoolItem[]): string[] {
  return [...new Set(items.map((i) => i.year).filter(Boolean))].sort().reverse();
}

/** Semester pada tahun ajaran itu (atau semua tahun bila kosong), urut menurut kemunculan paling awal. */
export function terms(items: SchoolItem[], year: string): string[] {
  const seen = new Map<string, number>();
  for (const i of items) {
    if (!i.term || (year && i.year !== year)) continue;
    seen.set(i.term, Math.min(seen.get(i.term) ?? Infinity, i.due ?? Infinity));
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

export function applyFilter(items: SchoolItem[], f: Filter): SchoolItem[] {
  return items.filter((i) => (!f.year || i.year === f.year) && (!f.term || i.term === f.term));
}

// ---------- Ringkasan ----------

export interface Overview {
  average: number | null;
  weighted: number | null;
  /** Rata-rata berbobot hanya mapel peminatan dan hanya mapel umum (tanpa pengali); null bila tidak ada jurusan. */
  majorAverage: number | null;
  generalAverage: number | null;
  graded: number;
  total: number;
  gradedPct: number | null;
  belowMark: number;
  highest: number | null;
  lowest: number | null;
}

/** Rata-rata berbobot: tiap nilai dikali bobot jenisnya, dibagi jumlah bobot. */
export function weightedMean(items: SchoolItem[], s: CalcSettings, useBoost = true): number | null {
  let sum = 0;
  let w = 0;
  for (const i of scored(items)) {
    const wi = weightOf(s, i.kind) * (useBoost && inMajor(i, s) ? s.major.boost : 1);
    sum += i.score * wi;
    w += wi;
  }
  return w > 0 ? round1(sum / w) : null;
}

export function overview(items: SchoolItem[], s: CalcSettings = DEFAULT_CALC): Overview {
  const v = scored(items).map((i) => i.score);
  const hasMajor = items.some((i) => inMajor(i, s));
  return {
    average: mean(v),
    weighted: weightedMean(items, s),
    majorAverage: hasMajor ? weightedMean(items.filter((i) => inMajor(i, s)), s, false) : null,
    generalAverage: hasMajor ? weightedMean(items.filter((i) => !inMajor(i, s)), s, false) : null,
    graded: v.length,
    total: items.length,
    gradedPct: items.length ? Math.round((v.length / items.length) * 100) : null,
    belowMark: v.filter((n) => n < s.passMark).length,
    highest: v.length ? Math.max(...v) : null,
    lowest: v.length ? Math.min(...v) : null,
  };
}

// ---------- Per mata pelajaran ----------

/** strong: kuat; ok: aman; improve: perlu ditingkatkan; risk: di bawah batas lulus; nodata: belum ada nilai. */
export type Status = "strong" | "ok" | "improve" | "risk" | "nodata";

export interface Bucket {
  label: string;
  average: number | null;
  count: number;
}

export interface SubjectStat {
  subject: string;
  total: number;
  graded: number;
  average: number | null;
  weighted: number | null;
  median: number | null;
  /** Simpangan baku: kecil berarti nilainya stabil, besar berarti naik turun. */
  stdev: number | null;
  min: number | null;
  max: number | null;
  below: number;
  /** Selisih rata-rata nilai terbaru terhadap yang sebelumnya (positif naik); null bila nilainya kurang dari 3. */
  trend: number | null;
  /** Selisih rata-rata berbobot mapel ini terhadap rata-rata berbobot semua mapel. */
  gap: number | null;
  kinds: Bucket[];
  status: Status;
  /** Mapel peminatan jurusan (false = mapel umum atau belum berjurusan). */
  major: boolean;
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function stdev(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return round1(Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length));
}

/** Rata-rata nilai terbaru (maksimal 3) dikurangi rata-rata nilai sebelumnya, urut tenggat. */
export function trendOf(items: SchoolItem[]): number | null {
  const v = scored(items).sort(byDue).map((i) => i.score);
  if (v.length < 3) return null;
  const k = Math.min(3, Math.floor(v.length / 2));
  const recent = v.slice(-k);
  const prior = v.slice(0, -k);
  return round1(recent.reduce((a, b) => a + b, 0) / recent.length - prior.reduce((a, b) => a + b, 0) / prior.length);
}

export function statusOf(weighted: number | null, trend: number | null, s: CalcSettings): Status {
  if (weighted === null) return "nodata";
  if (weighted < s.passMark) return "risk";
  if (weighted >= s.target && (trend === null || trend > -5)) return "strong";
  if (weighted < s.passMark + 7 || (trend !== null && trend <= -5)) return "improve";
  return "ok";
}

export function kindBuckets(items: SchoolItem[]): Bucket[] {
  const by = new Map<string, number[]>();
  for (const i of scored(items)) by.set(i.kind, [...(by.get(i.kind) ?? []), i.score]);
  return [...by.entries()].map(([label, v]) => ({ label, average: mean(v), count: v.length })).sort((a, b) => b.count - a.count);
}

export function subjectStats(items: SchoolItem[], s: CalcSettings = DEFAULT_CALC): SubjectStat[] {
  const overall = weightedMean(items, s, false); // selisih dibandingkan tanpa pengali supaya adil antar mapel
  const by = new Map<string, SchoolItem[]>();
  for (const i of items) by.set(i.subject, [...(by.get(i.subject) ?? []), i]);
  return [...by.entries()]
    .map(([subject, list]) => {
      const v = scored(list).map((i) => i.score);
      const weighted = weightedMean(list, s);
      const trend = trendOf(list);
      return {
        subject,
        total: list.length,
        graded: v.length,
        average: mean(v),
        weighted,
        median: median(v),
        stdev: stdev(v),
        min: v.length ? Math.min(...v) : null,
        max: v.length ? Math.max(...v) : null,
        below: v.filter((n) => n < s.passMark).length,
        trend,
        gap: weighted !== null && overall !== null ? round1(weighted - overall) : null,
        kinds: kindBuckets(list),
        status: statusOf(weighted, trend, s),
        major: list.some((i) => inMajor(i, s)),
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** Urutan dari yang paling perlu ditingkatkan (nilai berbobot terendah) ke yang terkuat; mapel tanpa nilai di akhir. */
export const ranked = (stats: SubjectStat[]) => [...stats].filter((x) => x.weighted !== null).sort((a, b) => (a.weighted ?? 0) - (b.weighted ?? 0));

/**
 * Rata-rata yang harus didapat dari `extra` penilaian berikutnya supaya rata-rata sederhana mencapai `target`.
 * null bila belum ada nilai; hasil di atas 100 berarti target tidak tercapai dengan jumlah penilaian itu.
 */
export function neededAverage(items: SchoolItem[], target: number, extra: number): number | null {
  const v = scored(items).map((i) => i.score);
  if (!v.length || extra < 1) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return round1((target * (v.length + extra) - sum) / extra);
}

// ---------- Statistik umum ----------

/** Rata-rata per bulan (menurut tenggat), urut waktu; untuk melihat naik turunnya nilai. */
export function monthly(items: SchoolItem[]): Bucket[] {
  const by = new Map<string, number[]>();
  for (const i of scored(items)) {
    if (i.due === null) continue;
    const d = new Date(i.due);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    by.set(key, [...(by.get(key) ?? []), i.score]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, average: mean(v), count: v.length }));
}

export const byKind = kindBuckets;

/** Rata-rata tiap periode (tahun ajaran + semester), untuk membandingkan semester. */
export function byPeriod(items: SchoolItem[]): Bucket[] {
  const by = new Map<string, { v: number[]; first: number }>();
  for (const i of scored(items)) {
    const key = [i.year, i.term].filter(Boolean).join(" / ") || "?";
    const cur = by.get(key) ?? { v: [], first: Infinity };
    cur.v.push(i.score);
    cur.first = Math.min(cur.first, i.due ?? Infinity);
    by.set(key, cur);
  }
  return [...by.entries()].sort((a, b) => a[1].first - b[1].first).map(([label, { v }]) => ({ label, average: mean(v), count: v.length }));
}

/** Sebaran nilai: berapa banyak di tiap rentang, termasuk yang di bawah batas lulus. */
export function distribution(items: SchoolItem[], s: CalcSettings = DEFAULT_CALC): Bucket[] {
  const v = scored(items).map((i) => i.score);
  const edges: [string, number, number][] = [
    [`< ${s.passMark}`, -1, s.passMark],
    [`${s.passMark} - 79`, s.passMark, 80],
    ["80 - 89", 80, 90],
    ["90 - 100", 90, 101],
  ].filter((e) => (e[1] as number) < (e[2] as number)) as [string, number, number][];
  return edges.map(([label, lo, hi]) => ({ label, average: null, count: v.filter((n) => n >= lo && n < hi).length }));
}
