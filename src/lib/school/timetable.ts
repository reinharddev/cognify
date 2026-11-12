// Jadwal pelajaran dari PDF yang diunggah pengguna (jadwal induk sekolah: satu tabel untuk semua kelas). Dipakai karena
// jadwal di portal sering berbeda dari yang berlaku di kelas. Berkas dibaca di perangkat ini; tidak ada yang dikirim keluar.
//
// Bentuk tabel yang dikenali (diekspor dari Google Sheets): baris judul kelas (10.1, 10.2, ...) dengan dua kolom per kelas
// ("K.Guru" dan "Mapel"), kolom Hari (huruf ditulis ke bawah), Jam ke-, dan Waktu ("07.50 - 08.30"). Sel yang menyatu
// (mis. "Agama" melintasi kedua kolom, atau "INTEREST GROUP" melintasi banyak kelas) ikut dibaca.
//
// Fungsi di sini murni: masukannya potongan teks beserta posisinya (`PdfItem`), bukan berkas PDF. Pembacaan PDF
// ada di `pdfItems.ts`.

import type { Lesson } from "./schedule";

export interface PdfItem {
  s: string;
  /** Tepi kiri dan garis dasar teks, dalam satuan halaman PDF (y bertambah ke atas). */
  x: number;
  y: number;
  w: number;
}

export interface TimetableSlot {
  cls: string;
  /** 0 Minggu sampai 6 Sabtu, seperti Date.getDay(). */
  day: number;
  begin: string;
  end: string;
  /** Kode mapel apa adanya di tabel (mis. "MTK LNJT") atau judul kegiatan bersama. */
  code: string;
  /** Kode guru; kosong untuk sel yang menyatu atau kegiatan bersama. */
  teacher: string;
  /** Kegiatan yang melintasi banyak kelas (upacara, Interest Group, ...), bukan mapel kelas. */
  event: boolean;
}

export interface Timetable {
  /** Tahun ajaran dari judul, mis. "2026-2027"; kosong bila tidak ada. */
  year: string;
  classes: string[];
  slots: TimetableSlot[];
}

const DAY_NUMBER: Record<string, number> = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6 };
const TIME = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})$/;
const CLASS_LABEL = /^\d{1,2}\.\d{1,2}$/;
const SKIP_LABEL = /istirahat|persiapan|break|recess/i;
/** Judul kegiatan bersama ditulis renggang per huruf ("B I N A  I M A N"), jadi sel sempit pun dikenali sebagai label. */
const LETTER_SPACED = /^\S( \S){3,}/;

/** Kegiatan bersama yang tulisannya renggang hilang jarak antarkatanya; ejaan yang benar dicocokkan lewat hurufnya saja. */
const EVENT_NAMES: Record<string, string> = {
  MAXWELLPOSITIVEPALS: "Maxwell / Positive Pals",
  INTERESTGROUP: "Interest Group",
  BINAIMAN: "Bina Iman",
};

/** Potongan label sebaris menjadi satu judul; teks renggang dirapatkan. */
function labelText(parts: string[]): string {
  const words = parts.map((p) => (LETTER_SPACED.test(p) ? p.replace(/ /g, "") : p));
  const joined = words.join(" ");
  const known = EVENT_NAMES[joined.replace(/[^A-Za-z]/g, "").toUpperCase()];
  return known ?? joined;
}

const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
const center = (i: PdfItem) => i.x + i.w / 2;

/** Nama mapel yang sudah pasti artinya. Kode yang tidak ada di sini ditampilkan apa adanya. */
const SUBJECTS: Record<string, [string, string]> = {
  MTK: ["Matematika", "Mathematics"],
  "MTK LNJT": ["Matematika Lanjut", "Advanced Mathematics"],
  "B.IND": ["Bahasa Indonesia", "Indonesian"],
  "B.ING": ["Bahasa Inggris", "English"],
  "ING LNJT": ["Bahasa Inggris Lanjut", "Advanced English"],
  PKN: ["PKn", "Civics"],
  FIS: ["Fisika", "Physics"],
  KIM: ["Kimia", "Chemistry"],
  BIO: ["Biologi", "Biology"],
  EKO: ["Ekonomi", "Economics"],
  SOS: ["Sosiologi", "Sociology"],
  SEJ: ["Sejarah", "History"],
  GEO: ["Geografi", "Geography"],
  TIK: ["Informatika", "Informatics"],
  MUSIK: ["Musik", "Music"],
  OR: ["Olahraga", "Physical Education"],
  MND: ["Bahasa Mandarin", "Mandarin"],
  BK: ["Bimbingan Konseling", "Counseling"],
  "PEND.PANCASILA": ["Pendidikan Pancasila", "Pancasila Education"],
  POE: ["Program of Entrepreneurship", "Program of Entrepreneurship"],
  "B.SUN": ["Bahasa Sunda", "Sundanese"],
};

export const KNOWN_SUBJECTS = new Set(Object.keys(SUBJECTS));

export function subjectName(code: string): { id: string; en: string } {
  const key = code.trim().toUpperCase();
  const known = SUBJECTS[key];
  return known ? { id: known[0], en: known[1] } : { id: code.trim(), en: code.trim() };
}

/** Baca satu halaman jadwal induk. Melempar galat berbahasa Indonesia bila bentuknya tidak dikenali. */
export function parseTimetable(items: PdfItem[]): Timetable {
  const all = items.filter((i) => i.s.trim());

  // 1. Kolom: label kelas di baris judul, lalu sub-kolom guru dan mapel di bawahnya.
  const labels = all.filter((i) => CLASS_LABEL.test(i.s.trim()));
  const byY = new Map<number, PdfItem[]>();
  for (const l of labels) {
    const k = Math.round(l.y);
    byY.set(k, [...(byY.get(k) ?? []), l]);
  }
  const headerRow = [...byY.values()].sort((a, b) => b.length - a.length)[0];
  if (!headerRow || headerRow.length < 1) throw new Error("Judul kelas (mis. 10.1, 12.2) tidak ditemukan di PDF ini.");
  const headY = headerRow[0].y;
  const classItems = [...headerRow].sort((a, b) => a.x - b.x);

  const subTeacher = all.filter((i) => /^k\.?\s*guru$/i.test(i.s.trim()) && i.y < headY && headY - i.y < 25).sort((a, b) => a.x - b.x);
  const subSubject = all.filter((i) => /^mapel$/i.test(i.s.trim()) && i.y < headY && headY - i.y < 25).sort((a, b) => a.x - b.x);
  if (subTeacher.length < classItems.length || subSubject.length < classItems.length) throw new Error("Kolom \"K.Guru\" dan \"Mapel\" tidak ditemukan di PDF ini.");

  interface Col { cls: string; left: number; right: number; split: number; width: number }
  const cols: Col[] = classItems.map((c) => {
    const cx = center(c);
    // Guru = kolom K.Guru terdekat di kiri label, Mapel = kolom Mapel terdekat di kanannya.
    const t = subTeacher.filter((s) => center(s) <= cx).pop() ?? subTeacher[0];
    const m = subSubject.find((s) => center(s) >= cx) ?? subSubject[subSubject.length - 1];
    const tc = center(t), mc = center(m);
    return { cls: c.s.trim(), left: 0, right: 0, split: (tc + mc) / 2, width: 0 };
  });
  cols.forEach((c, i) => {
    const half = (cols[i + 1] ? cols[i + 1].split - c.split : c.split - cols[i - 1].split) / 2;
    c.left = c.split - half;
    c.right = c.split + half;
    c.width = c.right - c.left;
  });
  const tableLeft = cols[0].left;
  const tableRight = cols[cols.length - 1].right;

  // 2. Baris waktu, dari atas ke bawah. Hari berganti saat jam kembali ke awal.
  const timeItems = all.filter((i) => TIME.test(i.s.trim()) && i.x < tableLeft).sort((a, b) => b.y - a.y);
  if (!timeItems.length) throw new Error("Kolom Waktu (mis. 07.50 - 08.30) tidak ditemukan di PDF ini.");
  interface Row { y: number; begin: string; end: string; day: number }
  const rows: Row[] = [];
  let day = 0;
  let prev = "";
  for (const t of timeItems) {
    const m = TIME.exec(t.s.trim())!;
    const begin = hhmm(m[1], m[2]);
    if (prev && begin < prev) day++;
    prev = begin;
    rows.push({ y: t.y, begin, end: hhmm(m[3], m[4]), day });
  }

  // 3. Nama hari: huruf di kolom Hari ditulis ke bawah, jadi dirangkai per hari menurut tinggi barisnya.
  const dayNames: string[] = [];
  const spacing = rows.length > 1 ? Math.min(...rows.slice(1).map((r, i) => rows[i].y - r.y).filter((d) => d > 0.5)) : 10;
  for (let d = 0; d <= day; d++) {
    const mine = rows.filter((r) => r.day === d);
    const top = Math.max(...mine.map((r) => r.y)) + spacing;
    const bottom = Math.min(...mine.map((r) => r.y)) - spacing / 2;
    const letters = all
      .filter((i) => i.s.trim().length === 1 && i.x < timeItems[0].x - 30 && i.y <= top && i.y >= bottom && /[A-Za-z']/.test(i.s))
      .sort((a, b) => b.y - a.y);
    dayNames.push(letters.map((l) => l.s.trim()).join("").toLowerCase());
  }
  const dayNumber = (d: number) => DAY_NUMBER[dayNames[d]] ?? ((d + 1) % 7);

  // 4. Isi: tiap baris waktu dipetakan ke kelas dan jenis kolomnya.
  const tol = Math.max(1.5, Math.min(4, spacing / 3));
  const inTable = (i: PdfItem) => i.x >= tableLeft - 2 && center(i) <= tableRight + 2 && !TIME.test(i.s.trim());
  const cells = all.filter(inTable);
  const isLabel = (i: PdfItem) => i.w > cols[0].width * 1.3 || LETTER_SPACED.test(i.s.trim());

  // Label yang melintasi banyak kelas ("Persiapan dan Doa", "I N T E R E S T  G R O U P"). Sel yang menyatu antar dua baris
  // menaruh teksnya di antara kedua baris, jadi label yang tidak sejajar dengan baris mana pun berlaku untuk kedua baris di sekitarnya.
  const labelRows = new Map<number, PdfItem[]>();
  for (const it of cells.filter(isLabel)) {
    const near = rows.map((r, k) => [r, k] as const).filter(([r]) => Math.abs(r.y - it.y) <= tol);
    let targets = near.map(([, k]) => k);
    if (!targets.length) {
      const k = rows.findIndex((r, i) => r.y > it.y && rows[i + 1] && rows[i + 1].y < it.y && rows[i + 1].day === r.day);
      if (k >= 0) targets = [k, k + 1];
    }
    for (const k of targets) labelRows.set(k, [...(labelRows.get(k) ?? []), it]);
  }

  const slots: TimetableSlot[] = [];
  rows.forEach((row, rowIndex) => {
    const inRow = cells.filter((i) => Math.abs(i.y - row.y) <= tol && !isLabel(i));
    const perClass = new Map<string, { teacher: PdfItem[]; subject: PdfItem[] }>();
    const events = new Map<string, string>();
    const wides: { text: string; seeds: number[] }[] = [];
    // Potongan label sebaris digabung: "I N T E R E S T" dan "G R O U P" menjadi "INTEREST GROUP".
    const parts = (labelRows.get(rowIndex) ?? []).sort((a, b) => a.x - b.x);
    const groups: PdfItem[][] = [];
    for (const p of parts) {
      const g = groups[groups.length - 1];
      const prevEnd = g ? g[g.length - 1].x + g[g.length - 1].w : 0;
      if (g && LETTER_SPACED.test(p.s.trim()) && LETTER_SPACED.test(g[g.length - 1].s.trim()) && p.x - prevEnd < cols[0].width * 0.4) g.push(p);
      else groups.push([p]);
    }
    for (const g of groups) {
      const text = labelText(g.map((p) => p.s.trim()));
      if (SKIP_LABEL.test(text)) continue;
      const left = g[0].x;
      const right = g[g.length - 1].x + g[g.length - 1].w;
      let seeds = cols.flatMap((c, i) => (Math.min(right, c.right) - Math.max(left, c.left) >= c.width * 0.6 ? [i] : []));
      if (!seeds.length) {
        const at = cols.findIndex((c) => (left + right) / 2 >= c.left && (left + right) / 2 < c.right);
        if (at >= 0) seeds = [at];
      }
      if (seeds.length) wides.push({ text, seeds });
    }
    for (const it of inRow) {
      const c = cols.find((k) => center(it) >= k.left && center(it) < k.right);
      if (!c) continue;
      const slot = perClass.get(c.cls) ?? { teacher: [], subject: [] };
      perClass.set(c.cls, slot);
      const mid = Math.abs(center(it) - c.split) < c.width * 0.12;
      if (mid || center(it) >= c.split) slot.subject.push(it);
      else slot.teacher.push(it);
    }
    // Sel yang menyatu meluas ke kiri dan kanan lewat kelas yang tidak punya isi sendiri di baris ini.
    for (const w of wides) {
      let lo = Math.min(...w.seeds);
      let hi = Math.max(...w.seeds);
      while (lo > 0 && !perClass.has(cols[lo - 1].cls) && !events.has(cols[lo - 1].cls)) lo--;
      while (hi < cols.length - 1 && !perClass.has(cols[hi + 1].cls) && !events.has(cols[hi + 1].cls)) hi++;
      for (let i = lo; i <= hi; i++) events.set(cols[i].cls, w.text);
    }
    const join = (xs: PdfItem[]) => xs.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(" ");
    for (const c of cols) {
      const ev = events.get(c.cls);
      if (ev) {
        slots.push({ cls: c.cls, day: dayNumber(row.day), begin: row.begin, end: row.end, code: ev, teacher: "", event: true });
        continue;
      }
      const cell = perClass.get(c.cls);
      const code = cell ? join(cell.subject) : "";
      if (!code) continue;
      slots.push({ cls: c.cls, day: dayNumber(row.day), begin: row.begin, end: row.end, code, teacher: cell ? join(cell.teacher) : "", event: false });
    }
  });
  if (!slots.length) throw new Error("Tidak ada pelajaran yang terbaca dari PDF ini.");

  const title = all.map((i) => i.s).find((s) => /\d{4}\s*-\s*\d{4}/.test(s)) ?? "";
  const year = /(\d{4})\s*-\s*(\d{4})/.exec(title);
  return { year: year ? `${year[1]}-${year[2]}` : "", classes: cols.map((c) => c.cls), slots };
}

/** Jadwal satu kelas jadi daftar Lesson (bentuk yang sama dengan jadwal portal), tanpa guru. Jam pelajaran berurutan dengan mapel yang sama digabung. */
export function lessonsFromTimetable(tt: Timetable, cls: string): Lesson[] {
  const period = `Unggahan ${cls}${tt.year ? ` / ${tt.year}` : ""}`;
  const mine = tt.slots
    .filter((s) => s.cls === cls)
    .sort((a, b) => a.day - b.day || a.begin.localeCompare(b.begin));
  const merged: TimetableSlot[] = [];
  for (const s of mine) {
    const last = merged[merged.length - 1];
    if (last && last.day === s.day && last.end === s.begin && last.code === s.code && last.event === s.event) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged.map((s) => {
    const name = s.event ? { id: titleCase(s.code), en: titleCase(s.code) } : subjectName(s.code);
    return {
      key: [period, s.day, s.begin].join("|"),
      day: s.day,
      begin: s.begin,
      end: s.end,
      room: "",
      subject: name.en,
      subjectLocal: name.id,
      teachers: [], // kode guru tidak dipakai: yang penting mapelnya
      period,
      grade: cls,
      term: "",
      year: tt.year,
    };
  });
}

/** "UPACARA / TALENT DAY" menjadi "Upacara / Talent Day"; teks yang sudah bercampur huruf besar dan kecil dibiarkan. */
export function titleCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s/])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}
