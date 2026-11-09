import { describe, expect, it } from "vitest";
import type { PageNode } from "$lib/workspace/types";
import { lessonDoc, noteTitle, planLessonNote, ROOT_TITLE } from "./lessonNotes";
import { templateList } from "$lib/workspace/templates";

const node = (id: string, parentId: string | null, kind: PageNode["kind"], title: string): PageNode => ({ id, parentId, kind, title, icon: null, position: 0, favorite: false, updatedAt: "t" });
const TITLE = noteTitle("Biology", new Date(2026, 10, 9), "id-ID");

describe("planLessonNote", () => {
  it("asks for everything when nothing exists", () => {
    expect(planLessonNote([], "Biology", TITLE)).toEqual({ rootId: null, subjectId: null, noteId: null });
  });

  it("reuses the root and the subject folder and only the note is missing", () => {
    const nodes = [node("r", null, "folder", ROOT_TITLE), node("s", "r", "folder", "Biology")];
    expect(planLessonNote(nodes, "Biology", TITLE)).toEqual({ rootId: "r", subjectId: "s", noteId: null });
  });

  it("finds an existing note, ignoring case and spaces", () => {
    const nodes = [node("r", null, "folder", " catatan pelajaran "), node("s", "r", "folder", "biology"), node("n", "s", "doc", TITLE.toUpperCase())];
    expect(planLessonNote(nodes, "Biology", TITLE).noteId).toBe("n");
  });

  it("does not mistake a same-named folder elsewhere for the root, nor another subject's note", () => {
    const nodes = [node("x", "other", "folder", ROOT_TITLE), node("r", null, "folder", ROOT_TITLE), node("s1", "r", "folder", "Physics"), node("n1", "s1", "doc", TITLE)];
    const p = planLessonNote(nodes, "Biology", TITLE);
    expect(p).toEqual({ rootId: "r", subjectId: null, noteId: null });
  });

  it("a note with the same title in a different folder does not count", () => {
    const nodes = [node("r", null, "folder", ROOT_TITLE), node("s", "r", "folder", "Biology"), node("n", "r", "doc", TITLE)];
    expect(planLessonNote(nodes, "Biology", TITLE).noteId).toBeNull();
  });
});

describe("lessonDoc", () => {
  it("puts the subject and date in the Cornell template's first heading without touching the template", () => {
    const cornell = templateList().find((t) => t.id === "cornell")!;
    const before = JSON.stringify(cornell.doc);
    const doc = lessonDoc(cornell.doc, "Biology, Sen, 9 Nov 2026") as { content: { content?: { text?: string }[] }[] };
    expect(doc.content[0].content?.[0].text).toBe("Biology, Sen, 9 Nov 2026");
    expect(JSON.stringify(cornell.doc)).toBe(before);
    expect(doc.content.length).toBeGreaterThan(3); // bagian Cornell lain tetap ada
  });
});
