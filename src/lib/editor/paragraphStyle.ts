// Gaya paragraf tambahan seperti di Google Docs: Judul dokumen, Subjudul, dan Teks kecil.
// Disimpan sebagai atribut `pstyle` pada paragraf, jadi tetap paragraf biasa untuk ekspor dan pencarian.
import { Extension } from "@tiptap/core";

export type ParagraphStyle = "title" | "subtitle" | "small" | "lead";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphStyle: {
      /** Jadikan blok sekarang paragraf dengan gaya itu; `null` kembali ke paragraf biasa. */
      setParagraphStyle: (style: ParagraphStyle | null) => ReturnType;
    };
  }
}

export const ParagraphStyleExt = Extension.create({
  name: "paragraphStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          pstyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-pstyle"),
            renderHTML: (a) => (a.pstyle ? { "data-pstyle": a.pstyle } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphStyle:
        (style) =>
        ({ commands }) =>
          commands.setParagraph() && commands.updateAttributes("paragraph", { pstyle: style }),
    };
  },
});
