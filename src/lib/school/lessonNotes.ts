// Catatan per pelajaran: folder "Catatan Pelajaran" → satu subfolder per mapel → satu catatan Cornell per pertemuan.
// Bagian ini murni (merencanakan apa yang sudah ada dan apa yang harus dibuat); pembuatannya ada di openNote.ts.

import type { PageNode } from "$lib/workspace/types";

export const ROOT_TITLE = "Catatan Pelajaran";

/** Tanggal pendek dengan nama hari, mis. "Sen, 9 Nov 2026" (bahasa mengikuti app). */
export function dateLabel(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Judul catatan satu pertemuan: "Biology, Sen, 9 Nov 2026". */
export const noteTitle = (subject: string, date: Date, locale?: string) => `${subject}, ${dateLabel(date, locale)}`;

export interface NotePlan {
  /** Id yang sudah ada; null bila harus dibuat (urut: root, mapel, catatan). */
  rootId: string | null;
  subjectId: string | null;
  noteId: string | null;
}

/** Cari bagian yang sudah ada. Yang di tempat sampah tidak ada di daftar simpul, jadi dibuat baru. */
export function planLessonNote(nodes: PageNode[], subject: string, title: string): NotePlan {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const root = nodes.find((n) => n.kind === "folder" && n.parentId === null && same(n.title, ROOT_TITLE)) ?? null;
  const sub = root ? (nodes.find((n) => n.kind === "folder" && n.parentId === root.id && same(n.title, subject)) ?? null) : null;
  const note = sub ? (nodes.find((n) => n.kind === "doc" && n.parentId === sub.id && same(n.title, title)) ?? null) : null;
  return { rootId: root?.id ?? null, subjectId: sub?.id ?? null, noteId: note?.id ?? null };
}

type Json = Record<string, unknown>;

/** Isi awal catatan: templat Cornell dengan judul bagian pertama diganti menjadi mapel dan tanggal. */
export function lessonDoc(template: Json, title: string): Json {
  const copy = JSON.parse(JSON.stringify(template)) as { content?: { type?: string; content?: { text?: string }[] }[] };
  const first = copy.content?.[0];
  if (first?.type === "heading" && first.content?.[0]) first.content[0].text = title;
  return copy as Json;
}
