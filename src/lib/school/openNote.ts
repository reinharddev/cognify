// Membuka (atau membuat bila belum ada) catatan satu pelajaran. Folder dan catatan dibuat seperlunya dan dipakai ulang.

import { goto } from "$app/navigation";
import { ws } from "$lib/stores/workspace.svelte";
import { plainTextOf, templateList } from "$lib/workspace/templates";
import { lessonDoc, noteTitle, planLessonNote, ROOT_TITLE } from "./lessonNotes";

export async function openLessonNote(subject: string, date: Date): Promise<string> {
  const title = noteTitle(subject, date);
  let plan = planLessonNote(ws.nodes, subject, title);
  if (plan.noteId) {
    await goto(`/p/${plan.noteId}`);
    return plan.noteId;
  }
  const rootId = plan.rootId ?? (await ws.create("folder", null, { title: ROOT_TITLE })).id;
  const subjectId = plan.subjectId ?? (await ws.create("folder", rootId, { title: subject })).id;
  const cornell = templateList().find((t) => t.id === "cornell");
  const doc = lessonDoc(cornell ? cornell.doc : { type: "doc", content: [{ type: "paragraph" }] }, title);
  const page = await ws.create("doc", subjectId, { title, content: JSON.stringify(doc), plainText: plainTextOf(doc) });
  await goto(`/p/${page.id}`);
  return page.id;
}

/** Folder catatan sebuah mapel bila sudah ada, atau null. */
export function subjectFolderId(subject: string): string | null {
  return planLessonNote(ws.nodes, subject, "").subjectId;
}
