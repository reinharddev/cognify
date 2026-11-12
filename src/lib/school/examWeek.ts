// Jadwal pekan ujian (STS, SAS, dan sejenisnya) dari PDF yang diunggah. Berbeda dari jadwal induk: tiap hari punya tanggal,
// tiap kelas satu kolom (tanpa kolom guru), dan sel ujian ("STS (Fisika)") sering menyatu lintas kelas dan baris.
// Selama pekan ujian, jadwal ini menggantikan jadwal biasa pada tanggal-tanggalnya (pelajaran sesudah ujian ikut tertulis
// di tabel bila ada; di SAS biasanya tidak ada).
//
// Murni: masukannya potongan teks beserta posisinya (`PdfItem`), seperti `timetable.ts`.

import type { Lesson } from "./schedule";
import { KNOWN_SUBJECTS, subjectName, titleCase, type PdfItem } from "./timetable";

export interface ExamSlot {
  cls: string;
  begin: string;
  end: string;
  /** Mis. "STS Fisika" atau "Bahasa Indonesia". */
  title: string;
  /** Ujian (judul diawali STS, SAS, dst.), bukan pelajaran atau kegiatan biasa. */
  exam: boolean;
}

export interface ExamDay {
  /** "YYYY-MM-DD". */
  date: string;
  slots: ExamSlot[];
}

export interface ExamSchedule {
  /** Unik: label dan tanggal pertama. Mengunggah ulang jadwal yang sama menggantikannya. */
  id: string;
  /** Mis. "STS 1". */
  label: string;
  year: string;
  classes: string[];
  days: ExamDay[];
  name: string;
  at: number;
}

const EXAM_WORD = /^(STS|SAS|UTS|UAS|PTS|PAS)\b/i;
const EXAM_ANYWHERE = /\b(STS|SAS|UTS|UAS|PTS|PAS)\b\s*(\d+)?/i;
const TIME = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})\/?$/;
const BRACKET_TIME = /\(\s*(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})\s*\)/;
const ONLY_TIME = /^\(?\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}\s*\)?$/;
const CLASS_LABEL = /^\d{1,2}\.\d{1,2}$/;
const DATE = /^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/;
const SKIP = /^break$|istirahat|persiapan/i;

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
const center = (i: PdfItem) => i.x + i.w / 2;

/** Nama lain untuk kode mapel di tabel. */
const ALIAS: Record<string, string> = {
  "B.INDONESIA": "B.IND", "B.INGGRIS": "B.ING", "INGGRIS LJT": "ING LNJT", "INGGRIS LNJT": "ING LNJT", "MTK LJT": "MTK LNJT",
  "SENI MUSIK": "MUSIK", PJOK: "OR", MANDARIN: "MND", KIMIA: "KIM", FISIKA: "FIS", BIOLOGI: "BIO", EKONOMI: "EKO",
  SOSIOLOGI: "SOS", SEJARAH: "SEJ", GEOGRAFI: "GEO", MATEMATIKA: "MTK", INFORMATIKA: "TIK", "B.SUNDA": "B.SUN",
};
const EVENT_TITLES: Record<string, string> = { PPALSILEAD: "P.Pals / I Lead", BINAIMAN: "Bina Iman", INTEREST: "Interest" };

const normKey = (t: string) => t.trim().toUpperCase().replace(/\.\s+/g, ".").replace(/\s+/g, " ");

/** Nama mapel yang rapi dari tulisan di tabel; kegiatan dan yang tidak dikenal dirapikan hurufnya saja. */
export function examSubjectName(text: string): string {
  const key = normKey(text);
  const code = ALIAS[key] ?? key;
  if (KNOWN_SUBJECTS.has(code)) return subjectName(code).id;
  return EVENT_TITLES[key.replace(/[^A-Z]/g, "")] ?? titleCase(text.trim());
}

const isKnownLesson = (text: string) => {
  const key = normKey(text);
  return KNOWN_SUBJECTS.has(ALIAS[key] ?? key) || key === "NUMERASI" || key === "LITERASI";
};

/** Potongan teks sebaris yang bersambung rapat (mis. "(Geogra", "fi", ")") digabung jadi satu. */
function mergeFragments(items: PdfItem[]): PdfItem[] {
  const sorted = items.filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const out: PdfItem[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - it.y) < 0.8 && it.x - (last.x + last.w) < 1.2 && it.x >= last.x) {
      last.s += it.s;
      last.w = it.x + it.w - last.x;
    } else out.push({ ...it });
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

interface Block {
  text: string;
  cx: number;
  y: number;
  used: PdfItem[];
}

export type ParsedExam = Omit<ExamSchedule, "name" | "at">;

/** Baca satu halaman jadwal pekan ujian. Melempar galat berbahasa Indonesia bila bentuknya tidak dikenali. */
export function parseExamWeek(rawItems: PdfItem[]): ParsedExam {
  const all = mergeFragments(rawItems);

  // 1. Kelas: baris judul pertama; kolom guru piket di tengah (celah lebar) dan di kanan tidak ikut.
  const labels = all.filter((i) => CLASS_LABEL.test(i.s.trim()));
  const rowsByY = new Map<number, PdfItem[]>();
  for (const l of labels) rowsByY.set(Math.round(l.y), [...(rowsByY.get(Math.round(l.y)) ?? []), l]);
  const headerRows = [...rowsByY.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => b[0] - a[0]);
  if (!headerRows.length) throw new Error("Judul kelas (mis. 10.1, 12.2) tidak ditemukan di PDF ini.");
  const head = headerRows[0][1].sort((a, b) => a.x - b.x);
  const centers = head.map(center);
  const spacing = median(centers.slice(1).map((c, i) => c - centers[i]));
  const cols = head.map((h, i) => ({ cls: h.s.trim(), cx: centers[i], left: centers[i] - spacing / 2, right: centers[i] + spacing / 2, gapAfter: i < centers.length - 1 && centers[i + 1] - centers[i] > spacing * 1.5 }));
  // Posisi "maya": tiap kelas satu petak, dan celah guru piket satu petak kosong (null).
  const slotsV: (number | null)[] = [];
  const vpOfClass: number[] = [];
  cols.forEach((c, i) => {
    vpOfClass.push(slotsV.length);
    slotsV.push(i);
    if (c.gapAfter) slotsV.push(null);
  });
  const virtualPos = (x: number) => {
    let i = cols.findIndex((c, k) => x < (cols[k + 1]?.cx ?? Infinity));
    if (i < 0) i = cols.length - 1;
    const next = cols[i + 1];
    if (!next) return vpOfClass[i] + (x - cols[i].cx) / spacing;
    return vpOfClass[i] + ((x - cols[i].cx) / (next.cx - cols[i].cx)) * (vpOfClass[i + 1] - vpOfClass[i]);
  };
  const tableLeft = cols[0].left;
  const classAt = (x: number) => cols.findIndex((c) => x >= c.left && x < c.right);

  // 2. Hari: tiap blok dimulai dari baris judul "Hari"; tanggalnya ada di kolom Hari ("21 Sept 2026").
  const headers = all.filter((i) => /^hari$/i.test(i.s.trim()) && i.x < tableLeft).map((i) => i.y).sort((a, b) => b - a);
  if (!headers.length) throw new Error("Kolom Hari tidak ditemukan di PDF ini.");
  const blockOf = (y: number) => headers.filter((h) => h + 4 >= y).length - 1;
  const dates = new Map<number, string>();
  for (const it of all) {
    const m = DATE.exec(it.s.trim());
    if (!m || it.x >= tableLeft) continue;
    const month = MONTHS[m[2].toLowerCase()];
    const b = blockOf(it.y);
    if (month && b >= 0) dates.set(b, `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  if (!dates.size) throw new Error("Tanggal ujian (mis. \"21 Sept 2026\") tidak ditemukan di PDF ini.");

  // 3. Baris waktu per hari.
  interface Row { y: number; begin: string; end: string; block: number }
  const rows: Row[] = all
    .filter((i) => TIME.test(i.s.trim()) && i.x < tableLeft)
    .map((i) => {
      const m = TIME.exec(i.s.trim())!;
      return { y: i.y, begin: hhmm(m[1], m[2]), end: hhmm(m[3], m[4]), block: blockOf(i.y) };
    })
    .filter((r) => r.block >= 0)
    .sort((a, b) => b.y - a.y);
  if (!rows.length) throw new Error("Kolom Waktu (mis. 07.30 - 09.30) tidak ditemukan di PDF ini.");

  const days: ExamDay[] = [];
  for (const [block, date] of [...dates.entries()].sort((a, b) => a[0] - b[0])) {
    const mine = rows.filter((r) => r.block === block);
    if (!mine.length) continue;
    const top = headers[block];
    const bottom = headers[block + 1] ?? -Infinity;
    // Isi sel hari ini: dalam rentang kolom kelas; kolom guru piket, "BREAK", dan baris persiapan dilewati.
    const cells = all.filter((i) => i.y < top && i.y > bottom && classAt(center(i)) >= 0 && !TIME.test(i.s.trim()) && !CLASS_LABEL.test(i.s.trim()) && !SKIP.test(i.s.trim()) && !/^(kelas|guru piket|ged\.?)/i.test(i.s.trim()));

    // Sel ujian: "STS" diikuti baris berikutnya yang diawali "(" di tengah yang sama (mapel, jam sendiri).
    const used = new Set<PdfItem>();
    const blocks: Block[] = [];
    for (const marker of cells.filter((i) => EXAM_WORD.test(i.s.trim())).sort((a, b) => b.y - a.y)) {
      if (used.has(marker)) continue;
      used.add(marker);
      const lines = [marker];
      for (;;) {
        // Satu sel punya paling banyak satu baris jam; baris "(11.30 - 12.00)" berikutnya milik baris istirahat.
        if (lines.some((l) => ONLY_TIME.test(l.s.trim()))) break;
        const last = lines[lines.length - 1];
        const next = cells.find((i) => !used.has(i) && i.s.trim().startsWith("(") && last.y - i.y > 0 && last.y - i.y <= 12 && Math.abs(center(i) - center(marker)) <= 10);
        if (!next) break;
        used.add(next);
        lines.push(next);
      }
      blocks.push({ text: lines.map((l) => l.s.trim()).join(" "), cx: center(marker), y: lines.reduce((s, l) => s + l.y, 0) / lines.length, used: lines });
    }

    // Baris yang ditempati tiap sel: yang terdekat; bila persis di antara dua baris, kedua-duanya (sel menyatu vertikal).
    const rowsFor = (y: number): Row[] => {
      const ranked = mine.map((r) => ({ r, d: Math.abs(r.y - y) })).sort((a, b) => a.d - b.d);
      const best = ranked[0];
      if (!best) return [];
      const second = ranked[1];
      if (second && Math.abs(second.d - best.d) <= 0.8 && second.d < 12) return [best.r, second.r];
      return [best.r];
    };

    interface Cell { title: string; exam: boolean; begin?: string; end?: string; spanner: boolean; cls: number; cx: number }
    const perRow = new Map<Row, Map<number, Cell>>();
    const put = (row: Row, c: Cell) => {
      const m = perRow.get(row) ?? new Map<number, Cell>();
      perRow.set(row, m);
      if (!m.has(c.cls)) m.set(c.cls, c);
    };

    for (const b of blocks) {
      const at = classAt(b.cx);
      if (at < 0) continue;
      const m = EXAM_WORD.exec(b.text)!;
      const rest = b.text.slice(m[0].length).trim();
      const t = BRACKET_TIME.exec(rest);
      const inner = rest.replace(BRACKET_TIME, "").trim().replace(/^\((.*)\)$/, "$1").trim();
      const title = `${m[1].toUpperCase()}${inner ? ` ${examSubjectName(inner)}` : ""}`;
      for (const row of rowsFor(b.y)) {
        put(row, { title, exam: true, begin: t ? hhmm(t[1], t[2]) : undefined, end: t ? hhmm(t[3], t[4]) : undefined, spanner: true, cls: at, cx: b.cx });
      }
    }
    for (const it of cells) {
      if (used.has(it) || ONLY_TIME.test(it.s.trim())) continue;
      const at = classAt(center(it));
      const near = mine.map((r) => ({ r, d: Math.abs(r.y - it.y) })).sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > 3.3) continue;
      put(near.r, { title: examSubjectName(it.s), exam: false, spanner: !isKnownLesson(it.s), cls: at, cx: center(it) });
    }

    // Sel menyatu (INTEREST, Bina Iman, STS lintas kelas): teksnya ada di tengah sel, jadi sel itu melebar simetris ke kiri
    // dan kanan dari tengah teks, sejauh kelas di kedua sisinya masih kosong. Kolom guru piket dihitung satu petak kosong.
    for (const row of mine) {
      const m = perRow.get(row);
      if (!m) continue;
      for (const seed of [...m.values()].filter((c) => c.spanner)) {
        const base = Math.round(virtualPos(seed.cx) * 2) / 2;
        const start = Number.isInteger(base) ? 0 : 0.5;
        const wanted: number[] = [];
        for (let r = start; ; r++) {
          const lo = base - r;
          const hi = base + r;
          if (lo < 0 || hi > slotsV.length - 1) break;
          const group = [...new Set([lo, hi])];
          const free = group.every((v) => slotsV[v] === null || !m.has(slotsV[v] as number) || m.get(slotsV[v] as number) === seed);
          if (!free) break;
          wanted.push(...group.filter((v) => slotsV[v] !== null).map((v) => slotsV[v] as number));
        }
        for (const k of wanted) if (!m.has(k)) m.set(k, { ...seed, cls: k });
      }
    }

    const slots: ExamSlot[] = [];
    for (const row of mine) {
      for (const [k, c] of perRow.get(row) ?? []) {
        const begin = c.begin ?? row.begin;
        const end = c.end ?? row.end;
        const dup = slots.some((s) => s.cls === cols[k].cls && s.begin === begin && s.end === end && s.title === c.title);
        if (!dup) slots.push({ cls: cols[k].cls, begin, end, title: c.title, exam: c.exam });
      }
    }
    days.push({ date, slots });
  }
  if (!days.some((d) => d.slots.length)) throw new Error("Tidak ada ujian atau pelajaran yang terbaca dari PDF ini.");

  const head0 = all.find((i) => /jadwal/i.test(i.s) && EXAM_ANYWHERE.test(i.s));
  const lm = head0 ? EXAM_ANYWHERE.exec(head0.s) : null;
  const label = lm ? `${lm[1].toUpperCase()}${lm[2] ? ` ${lm[2]}` : ""}` : "Ujian";
  const ym = all.map((i) => /(\d{4})\s*[/-]\s*(\d{4})/.exec(i.s)).find(Boolean);
  const dayList = days.sort((a, b) => a.date.localeCompare(b.date));
  return { id: `${label}|${dayList[0].date}`.toLowerCase(), label, year: ym ? `${ym[1]}-${ym[2]}` : "", classes: cols.map((c) => c.cls), days: dayList };
}

/** Pelajaran satu kelas pada satu tanggal dari jadwal ujian, dalam bentuk Lesson supaya bisa dipakai Kalender, Beranda, dan Notch. */
export function examLessons(exam: ExamSchedule, cls: string, date: Date): Lesson[] | null {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const day = exam.days.find((d) => d.date === iso);
  if (!day) return null;
  const merged: ExamSlot[] = [];
  for (const s of day.slots.filter((x) => x.cls === cls).sort((a, b) => a.begin.localeCompare(b.begin))) {
    const last = merged[merged.length - 1];
    if (last && last.end === s.begin && last.title === s.title) last.end = s.end;
    else merged.push({ ...s });
  }
  const period = `${exam.label}${exam.year ? ` / ${exam.year}` : ""}`;
  return merged.map((s) => ({
    key: ["exam", exam.id, iso, s.begin].join("|"),
    day: date.getDay(),
    begin: s.begin,
    end: s.end,
    room: "",
    subject: s.title,
    subjectLocal: s.title,
    teachers: [],
    period,
    grade: cls,
    term: "",
    year: exam.year,
  }));
}
