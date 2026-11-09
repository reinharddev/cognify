// Kotak penekanan: blok berwarna untuk info, tips, atau peringatan. Isinya blok biasa (paragraf, daftar, dan lainnya).

import { Node, mergeAttributes } from "@tiptap/core";

export const CALLOUT_KINDS = ["info", "tip", "warn"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Bungkus blok terpilih dalam kotak; bila sudah di dalam kotak sejenis, lepaskan. */
      toggleCallout: (kind?: CalloutKind) => ReturnType;
      /** Ganti jenis kotak yang sedang aktif ke jenis berikutnya. */
      cycleCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (el) => (CALLOUT_KINDS as readonly string[]).includes(el.getAttribute("data-callout") ?? "") ? el.getAttribute("data-callout") : "info",
        renderHTML: (attrs) => ({ "data-callout": attrs.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "callout" }, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      toggleCallout: (kind = "info") => ({ commands, editor }) => {
        if (editor.isActive("callout", { kind })) return commands.lift("callout");
        if (editor.isActive("callout")) return commands.updateAttributes("callout", { kind });
        return commands.wrapIn("callout", { kind });
      },
      cycleCallout: () => ({ commands, editor }) => {
        const cur = editor.getAttributes("callout").kind as CalloutKind | undefined;
        if (!cur) return false;
        const next = CALLOUT_KINDS[(CALLOUT_KINDS.indexOf(cur) + 1) % CALLOUT_KINDS.length];
        return commands.updateAttributes("callout", { kind: next });
      },
    };
  },
});
