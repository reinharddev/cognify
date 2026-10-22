import { tr } from "$lib/i18n.svelte";
// Templat halaman. Satu daftar untuk semua pengguna (pelajar SD sampai mahasiswa). Isinya JSON dokumen Tiptap; `plainText` dibuat dari JSON itu.

type Json = Record<string, unknown>;

const text = (t: string): Json => ({ type: "text", text: t });
const para = (t = ""): Json => (t ? { type: "paragraph", content: [text(t)] } : { type: "paragraph" });
const heading = (t: string, level = 2): Json => ({ type: "heading", attrs: { level }, content: [text(t)] });
const bullets = (items: string[]): Json => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [para(i)] })),
});
const todos = (items: string[]): Json => ({
  type: "taskList",
  content: items.map((i) => ({ type: "taskItem", attrs: { checked: false }, content: [para(i)] })),
});
const doc = (...content: Json[]): Json => ({ type: "doc", content });

export interface Template {
  id: string;
  name: string;
  hint: string;
  title: string;
  doc: Json;
}

const buildTemplates = (): Record<string, Template> => ({
  pr: {
    id: "pr", name: tr("Daftar PR", "Homework list"), hint: tr("Tugas yang harus dikerjakan", "Tasks to get done"), title: tr("Daftar PR", "Homework list"),
    doc: doc(heading(tr("PR minggu ini", "Homework this week")), todos([tr("Matematika: soal halaman 12", "Math: exercises on page 12"), tr("Bahasa Indonesia: baca bab 2", "Language arts: read chapter 2")]), para()),
  },
  rangkuman: {
    id: "rangkuman", name: tr("Rangkuman bab", "Chapter summary"), hint: tr("Poin penting dan contoh", "Key points and examples"), title: tr("Rangkuman bab", "Chapter summary"),
    doc: doc(heading(tr("Judul bab", "Chapter title")), heading(tr("Poin penting", "Key points"), 3), bullets(["", ""]), heading(tr("Contoh", "Examples"), 3), para(), heading(tr("Yang masih membingungkan", "Still confusing"), 3), para()),
  },
  cornell: {
    id: "cornell", name: tr("Catatan Cornell", "Cornell notes"), hint: tr("Pertanyaan, catatan, ringkasan", "Questions, notes, summary"), title: tr("Catatan Cornell", "Cornell notes"),
    doc: doc(heading(tr("Topik dan tanggal", "Topic and date")), heading(tr("Pertanyaan kunci", "Key questions"), 3), bullets(["", ""]), heading(tr("Catatan", "Notes"), 3), para(), heading(tr("Ringkasan", "Summary"), 3), para()),
  },
  ujian: {
    id: "ujian", name: tr("Jadwal ujian", "Exam schedule"), hint: tr("Mapel, tanggal, dan bahan", "Subject, date, and material"), title: tr("Jadwal ujian", "Exam schedule"),
    doc: doc(heading(tr("Jadwal ujian", "Exam schedule")), bullets([tr("Senin: Matematika, bab 3 sampai 5", "Monday: Math, chapters 3 to 5"), tr("Selasa: IPA, bab 2", "Tuesday: Science, chapter 2")]), heading(tr("Persiapan", "Preparation"), 3), todos([tr("Buat rangkuman", "Write a summary"), tr("Latihan soal tahun lalu", "Practice last year's questions")])),
  },
  jurnal: {
    id: "jurnal", name: tr("Jurnal belajar", "Study journal"), hint: tr("Apa yang kupelajari hari ini", "What I learned today"), title: tr("Jurnal belajar", "Study journal"),
    doc: doc(heading(tr("Hari ini aku belajar", "Today I learned")), para(), heading(tr("Yang berhasil", "What worked"), 3), para(), heading(tr("Yang perlu diulang", "What to repeat"), 3), para()),
  },
  rencana: {
    id: "rencana", name: tr("Rencana proyek", "Project plan"), hint: tr("Tujuan, langkah, dan jadwal", "Goal, steps, and schedule"), title: tr("Rencana proyek", "Project plan"),
    doc: doc(heading(tr("Judul sementara", "Working title")), heading(tr("Tujuan", "Goal"), 3), para(), heading(tr("Langkah", "Steps"), 3), todos(["", "", ""]), heading(tr("Jadwal", "Schedule"), 3), bullets([""]), heading(tr("Sumber dan catatan", "Sources and notes"), 3), bullets([""])),
  },
  kosong: { id: "kosong", name: tr("Halaman kosong", "Blank page"), hint: tr("Mulai dari nol", "Start from scratch"), title: "", doc: doc(para()) },
});

export const templateList = (): Template[] => {
  const T = buildTemplates();
  return [T.cornell, T.rangkuman, T.pr, T.ujian, T.jurnal, T.rencana];
};

export const blankTemplate = (): Template => buildTemplates().kosong;

export function plainTextOf(node: unknown): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (typeof n.text === "string") out.push(n.text);
    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
      if (["paragraph", "heading", "listItem", "taskItem"].includes(n.type)) out.push("\n");
    }
  };
  walk(node);
  return out.join("").replace(/\n{2,}/g, "\n").trim();
}

/** Dokumen dari teks biasa: setiap baris menjadi satu paragraf. */
export function docFromText(text: string): Json {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return doc(...(lines.length ? lines.map((l) => para(l)) : [para()]));
}

/** Dokumen berisi satu daftar centang; `checked` mengikuti status tiap butir. */
export function checklistDoc(heading_: string, items: { text: string; done: boolean }[]): Json {
  return doc(heading(heading_), {
    type: "taskList",
    content: items.map((i) => ({ type: "taskItem", attrs: { checked: i.done }, content: [para(i.text)] })),
  });
}
