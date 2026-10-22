// Blok kalender di dokumen: atom blok yang menampilkan acara untuk rentang waktu pilihan.
// Yang disimpan hanya pengaturan rentangnya; acara dibaca langsung dari Kalender, jadi selalu terbaru.
import { Node } from "@tiptap/core";
import { mount, unmount } from "svelte";
import CalendarBlock from "$lib/components/CalendarBlock.svelte";
import type { RangeAttrs } from "$lib/calendar/range";

export const CalendarBlockNode = Node.create({
  name: "calendarBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return { range: { default: "week" }, from: { default: "" }, to: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-calendar-block]" }];
  },

  renderHTML({ node }) {
    return ["div", { "data-calendar-block": node.attrs.range }, "Kalender"];
  },

  renderText: () => "[Kalender]",

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-calendar-block", "");
      const state = $state({ attrs: node.attrs as RangeAttrs });
      const app = mount(CalendarBlock, {
        target: dom,
        props: {
          get attrs() {
            return state.attrs;
          },
          update: (patch: Partial<RangeAttrs>) => {
            const pos = getPos();
            if (pos === undefined) return;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...state.attrs, ...patch }));
          },
        },
      });
      // Klik di bagian blok yang bukan kontrol memilih seluruh blok (ditandai garis putus-putus).
      dom.addEventListener("mousedown", (e) => {
        if ((e.target as Element).closest("button, input, select, a, [role=listbox]")) return;
        const pos = getPos();
        if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run();
      });
      return {
        dom,
        update(next) {
          if (next.type.name !== "calendarBlock") return false;
          state.attrs = next.attrs as RangeAttrs;
          return true;
        },
        // Klik di dalam blok (pilihan rentang, tanggal) ditangani blok sendiri, bukan editor.
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(app),
      };
    };
  },
});
