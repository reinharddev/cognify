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

const T: Record<string, Template> = {
  pr: {
    id: "pr", name: "Daftar PR", hint: "Tugas yang harus dikerjakan", title: "Daftar PR",
    doc: doc(heading("PR minggu ini"), todos(["Matematika: soal halaman 12", "Bahasa Indonesia: baca bab 2"]), para()),
  },
  rangkuman: {
    id: "rangkuman", name: "Rangkuman bab", hint: "Poin penting dan contoh", title: "Rangkuman bab",
    doc: doc(heading("Judul bab"), heading("Poin penting", 3), bullets(["", ""]), heading("Contoh", 3), para(), heading("Yang masih membingungkan", 3), para()),
  },
  cornell: {
    id: "cornell", name: "Catatan Cornell", hint: "Pertanyaan, catatan, ringkasan", title: "Catatan Cornell",
    doc: doc(heading("Topik dan tanggal"), heading("Pertanyaan kunci", 3), bullets(["", ""]), heading("Catatan", 3), para(), heading("Ringkasan", 3), para()),
  },
  ujian: {
    id: "ujian", name: "Jadwal ujian", hint: "Mapel, tanggal, dan bahan", title: "Jadwal ujian",
    doc: doc(heading("Jadwal ujian"), bullets(["Senin: Matematika, bab 3 sampai 5", "Selasa: IPA, bab 2"]), heading("Persiapan", 3), todos(["Buat rangkuman", "Latihan soal tahun lalu"])),
  },
  jurnal: {
    id: "jurnal", name: "Jurnal belajar", hint: "Apa yang kupelajari hari ini", title: "Jurnal belajar",
    doc: doc(heading("Hari ini aku belajar"), para(), heading("Yang berhasil", 3), para(), heading("Yang perlu diulang", 3), para()),
  },
  rencana: {
    id: "rencana", name: "Rencana proyek", hint: "Tujuan, langkah, dan jadwal", title: "Rencana proyek",
    doc: doc(heading("Judul sementara"), heading("Tujuan", 3), para(), heading("Langkah", 3), todos(["", "", ""]), heading("Jadwal", 3), bullets([""]), heading("Sumber dan catatan", 3), bullets([""])),
  },
  kosong: { id: "kosong", name: "Halaman kosong", hint: "Mulai dari nol", title: "", doc: doc(para()) },
};

export const templates: Template[] = [T.cornell, T.rangkuman, T.pr, T.ujian, T.jurnal, T.rencana];

export const blankTemplate = T.kosong;

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
