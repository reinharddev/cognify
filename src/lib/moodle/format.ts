// Pembersih teks dari Moodle untuk halaman Materi: nama mapel dan judul bagian sering panjang, huruf besar semua, dan penuh awalan.

import { tr } from "$lib/i18n.svelte";

const SMALL = new Set(["dan", "atau", "dengan", "yang", "untuk", "di", "ke", "dari", "of", "and", "the", "to", "in", "for", "a"]);

/** "TERM 1 | LIMIT ALJABAR | 22 JULY" menjadi "Term 1 · Limit Aljabar · 22 July" (huruf besar semua dilunakkan). */
export function tidy(text: string): string {
  return text
    .split("|")
    .map((part) => {
      let t = part.trim();
      if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
        t = t
          .toLowerCase()
          .split(" ")
          .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
          .join(" ");
      }
      return t;
    })
    .filter(Boolean)
    .join(" · ");
}

/** Judul ringkas: buang awalan "Term 1 ·" dan kata pengisi ("Learning Material"), supaya tidak diulang di setiap baris. */
export function short(text: string): string {
  const parts = tidy(text)
    .split(" · ")
    .filter((p) => !/^(term\s*\d+|learning (material|focus)|flip material|flipped learning)$/i.test(p.trim()));
  const joined = parts.join(" · ").replace(/^materi:\s*/i, "").trim();
  return joined || tidy(text);
}

/** "SCK-CI_2026_Advanced Mathematics_12.2" menjadi "Advanced Mathematics". */
export function courseName(raw: string): string {
  const cleaned = raw
    .replace(/^[A-Za-z]{2,4}-[A-Za-z]{2,3}_\d{4}_/, "")
    .replace(/_Kelas_\d{1,2}/gi, "")
    .replace(/[_\s]+\d{1,2}(\.\d)?(\s*\/\s*\d{1,2}(\.\d)?)?$/, "")
    .replace(/_/g, " ")
    .trim();
  return cleaned || raw;
}

export const isAssessment = (name: string) => /assess?ment/i.test(name);

const KIND: Record<string, [string, string]> = {
  page: ["halaman", "pages"], url: ["tautan", "links"], quiz: ["kuis", "quizzes"], assign: ["tugas", "assignments"], forum: ["forum", "forums"],
  book: ["buku", "books"], lesson: ["pelajaran", "lessons"], h5pactivity: ["konten H5P", "H5P items"], scorm: ["paket SCORM", "SCORM packages"],
  glossary: ["glosarium", "glossaries"], workshop: ["workshop", "workshops"], choice: ["pilihan", "polls"], feedback: ["umpan balik", "feedback forms"],
  survey: ["survei", "surveys"], zoom: ["Zoom", "Zoom"], bigbluebuttonbn: ["kelas daring", "online classes"], attendance: ["absensi", "attendance"],
  data: ["basis data", "databases"], wiki: ["wiki", "wikis"], imscp: ["paket konten", "content packages"], chat: ["obrolan", "chats"],
};
export const kindLabel = (k: string, n: number) => `${n} ${tr(KIND[k]?.[0] ?? k, KIND[k]?.[1] ?? k)}`;

export const PROVIDER: Record<string, string> = { canva: "Canva", youtube: "YouTube", google: "Google", vimeo: "Vimeo", figma: "Figma", padlet: "Padlet", genially: "Genially" };

export const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "");
export const stem = (name: string) => name.replace(/\.[^.]+$/, "");
export const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : n > 0 ? `${n} B` : "");
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
