// Blok "Tugas dari Moodle" di dokumen: atom blok tanpa pengaturan. Isinya dibaca langsung dari penyimpanan Moodle di app
// (hanya yang belum dikumpulkan), jadi selalu terbaru. Yang tersimpan di dokumen hanya penanda bloknya.
import { Node } from "@tiptap/core";
import { mount, unmount } from "svelte";
import MoodleTasksBlock from "$lib/components/MoodleTasksBlock.svelte";

export const MoodleTasksNode = Node.create({
  name: "moodleTasks",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-moodle-tasks]" }];
  },

  renderHTML() {
    return ["div", { "data-moodle-tasks": "" }, "Tugas dari Moodle"];
  },

  renderText: () => "[Tugas dari Moodle]",

  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-moodle-tasks", "");
      const app = mount(MoodleTasksBlock, { target: dom });
      // Klik di bagian blok yang bukan tombol memilih seluruh blok (ditandai garis putus-putus).
      dom.addEventListener("mousedown", (e) => {
        if ((e.target as Element).closest("button, a")) return;
        const pos = getPos();
        if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run();
      });
      return {
        dom,
        update: (next) => next.type.name === "moodleTasks",
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(app),
      };
    };
  },
});
