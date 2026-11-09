// Komentar pada teks: mark yang membawa isi komentar dan waktunya, jadi tersimpan di dalam dokumen (tanpa tabel baru).

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (attrs: { id: string; text: string; at: string }) => ReturnType;
      /** Hapus komentar dengan id itu di seluruh dokumen. */
      removeComment: (id: string) => ReturnType;
    };
  }
}

export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "", // beberapa komentar boleh menumpuk pada teks yang sama
  addAttributes() {
    return {
      id: { default: "", parseHTML: (el) => el.getAttribute("data-comment-id") ?? "", renderHTML: (a) => ({ "data-comment-id": a.id }) },
      text: { default: "", parseHTML: (el) => el.getAttribute("data-comment-text") ?? "", renderHTML: (a) => ({ "data-comment-text": a.text }) },
      at: { default: "", parseHTML: (el) => el.getAttribute("data-comment-at") ?? "", renderHTML: (a) => ({ "data-comment-at": a.at }) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "comment-hit" }, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setComment: (attrs) => ({ commands }) => commands.setMark("comment", attrs),
      removeComment: (id) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks.comment;
        let changed = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          for (const m of node.marks) {
            if (m.type === type && m.attrs.id === id) {
              tr.removeMark(pos, pos + node.nodeSize, m);
              changed = true;
            }
          }
          return true;
        });
        if (changed) dispatch?.(tr);
        return changed;
      },
    };
  },
});
