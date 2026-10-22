// Blok papan di dokumen: menampilkan papan (hanya baca) dan mengikuti perubahannya. Yang disimpan hanya id papan.
import { Node } from "@tiptap/core";
import { mount, unmount } from "svelte";
import BoardBlock from "$lib/components/BoardBlock.svelte";

export const BoardBlockNode = Node.create({
  name: "boardBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return { pageId: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-board-block]" }];
  },

  renderHTML({ node }) {
    return ["div", { "data-board-block": node.attrs.pageId }, "Papan"];
  },

  renderText: () => "[Papan]",

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-board-block", "");
      const state = $state({ attrs: node.attrs as { pageId: string } });
      const app = mount(BoardBlock, {
        target: dom,
        props: {
          get attrs() {
            return state.attrs;
          },
          update: (patch: { pageId: string }) => {
            const pos = getPos();
            if (pos === undefined) return;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...state.attrs, ...patch }));
          },
        },
      });
      dom.addEventListener("mousedown", (e) => {
        if ((e.target as Element).closest("button, input, select, a, [role=listbox]")) return;
        const pos = getPos();
        if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run();
      });
      return {
        dom,
        update(next) {
          if (next.type.name !== "boardBlock") return false;
          state.attrs = next.attrs as { pageId: string };
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(app),
      };
    };
  },
});
