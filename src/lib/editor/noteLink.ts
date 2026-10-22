// Teks yang dihubungkan ke catatan melayang: disorot, dan sebuah panah tipis menunjuk ke catatannya.
// Disimpan sebagai mark di dalam dokumen, jadi ikut bergeser saat teksnya diedit.
import { Mark, mergeAttributes } from "@tiptap/core";

export const NoteLink = Mark.create({
  name: "noteLink",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return { noteId: { default: "" }, linkId: { default: "" }, arrow: { default: 0 } };
  },

  parseHTML() {
    return [{ tag: "span[data-note-link]" }];
  },

  renderHTML({ mark, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "note-link",
        "data-note-link": mark.attrs.noteId,
        "data-link-id": mark.attrs.linkId,
        "data-arrow": String(mark.attrs.arrow),
      }),
      0,
    ];
  },
});
