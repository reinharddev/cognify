// Mapel peminatan dikenali dari struktur mapel, bukan dari daftar jurusan. Tiga petunjuk digabung (hanya untuk mapel
// yang ada di kelas berjurusan, bawaan 11 ke atas):
//   1. nama memuat penanda peminatan ("Advanced Mathematics", "Peminatan", "Lanjut");
//   2. mapel itu bukan kelompok wajib kurikulum (agama, PPKn, Bahasa Indonesia, Inggris, Matematika umum, PJOK, seni,
//      muatan lokal, informatika, kewirausahaan, sejarah);
//   3. mapel itu baru muncul sejak kelas berjurusan dan tidak ada di kelas di bawahnya.
// Mapel yang belum punya satu pun nilai (semua kosong atau "N/A") dianggap tidak ada: bukan mapel yang diambil.
// Hasilnya hanya saran: pengguna bisa mengubah centangnya, dan tiap saran membawa alasannya.

import { levelOf } from "./stats";
import type { SchoolItem } from "./parse";

export type Reason = "marker" | "elective" | "new";

export interface Detection {
  /** Mapel yang terdeteksi peminatan, urut abjad. */
  major: string[];
  /** Alasan tiap mapel peminatan (kunci: nama mapel). */
  reasons: Record<string, Reason>;
  /** Mapel di kelas berjurusan yang dianggap umum. */
  general: string[];
  /** Ada data kelas di bawah kelas mulai (dipakai untuk petunjuk ketiga). */
  hasGeneralData: boolean;
  /** Ada data kelas berjurusan (kelas mulai ke atas). */
  hasMajorData: boolean;
}

/** Penanda peminatan pada nama mapel. */
const MARKER = /advanc|peminatan|lanjut|elective|specialis|specializ|pilihan/i;

/** Kelompok mapel wajib (nama Indonesia dan Inggris). Yang cocok dianggap umum. */
const COMPULSORY: RegExp[] = [
  /agama|religion|christian|kristen|islam|catholic|katolik|buddh|budha|hindu|konghucu/i,
  /civic|pancasila|ppkn|kewarganegaraan/i,
  /indones/i,
  /english|inggris/i,
  /^(general )?math(ematics)?( \(general\)| general| umum)?$|^matematika( umum| wajib)?$/i,
  /sport|pjok|olahraga|jasmani|physical education/i,
  /^art\b|seni|budaya/i,
  /sunda|mulok|muatan lokal|local content|daerah/i,
  /informatic|informatika|pocc|computer|^ict$/i,
  /entrepreneur|kewirausahaan|prakarya|^poe\b|\bpoe\)/i,
  /history|sejarah/i,
];

const norm = (s: string) => s.trim().toLowerCase();
export const isCompulsory = (subject: string) => COMPULSORY.some((r) => r.test(subject.trim()));

export function detectMajor(items: SchoolItem[], fromLevel: number): Detection {
  const early = new Set<string>();
  const late = new Map<string, string>(); // huruf kecil → nama asli
  // Mapel dihitung ada bila punya minimal satu nilai.
  const graded = new Set(items.filter((i) => i.score !== null).map((i) => norm(i.subject)));
  for (const i of items) {
    if (!graded.has(norm(i.subject))) continue;
    const level = levelOf(i.grade);
    if (level === null) continue;
    if (level < fromLevel) early.add(norm(i.subject));
    else late.set(norm(i.subject), i.subject);
  }
  const hasGeneralData = early.size > 0;
  const reasons: Record<string, Reason> = {};
  for (const [key, name] of late) {
    if (MARKER.test(name)) reasons[name] = "marker";
    else if (!isCompulsory(name)) reasons[name] = "elective";
    else if (hasGeneralData && !early.has(key)) reasons[name] = "new";
  }
  const names = [...late.values()].sort((a, b) => a.localeCompare(b));
  return {
    major: names.filter((n) => n in reasons),
    reasons,
    general: names.filter((n) => !(n in reasons)),
    hasGeneralData,
    hasMajorData: late.size > 0,
  };
}
