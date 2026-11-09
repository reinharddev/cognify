// Hitungan dan struktur dokumen untuk bilah status dan daftar isi.

import type { Node as PMNode } from "@tiptap/pm/model";

/** Jumlah kata: urutan huruf atau angka yang dipisah spasi atau tanda baca; tanda hubung dan apostrof di dalam kata tidak memecahnya. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Perkiraan waktu baca (menit) dengan 200 kata per menit; 0 bila kosong. */
export const readingMinutes = (words: number) => (words === 0 ? 0 : Math.max(1, Math.round(words / 200)));

export interface Heading {
  level: number;
  text: string;
  /** Posisi simpul judul di dokumen, untuk menggulir ke sana. */
  pos: number;
}

export function headingsOf(doc: PMNode): Heading[] {
  const out: Heading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) out.push({ level: Number(node.attrs.level) || 1, text, pos });
      return false;
    }
    return true;
  });
  return out;
}

export interface CommentInfo {
  id: string;
  text: string;
  at: string;
  /** Kutipan teks yang dikomentari. */
  quote: string;
  from: number;
}

/** Komentar di dokumen (mark `comment`), urut posisi. Teks dengan id yang sama digabung jadi satu komentar. */
export function commentsOf(doc: PMNode): CommentInfo[] {
  const by = new Map<string, CommentInfo>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "comment") continue;
      const id = String(m.attrs.id ?? "");
      if (!id) continue;
      const cur = by.get(id);
      if (cur) cur.quote += node.text ?? "";
      else by.set(id, { id, text: String(m.attrs.text ?? ""), at: String(m.attrs.at ?? ""), quote: node.text ?? "", from: pos });
    }
    return true;
  });
  return [...by.values()].sort((a, b) => a.from - b.from);
}
