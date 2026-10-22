import { tr } from "$lib/i18n.svelte";
// Tautan ke halaman lain di dalam dokumen: chip kecil berisi ikon jenis dan judul halaman.
// Yang disimpan hanya id halaman; judul dan jenis dibaca dari daftar halaman, jadi ikut berubah saat judul diganti.
import { Node, mergeAttributes } from "@tiptap/core";
import { ws } from "$lib/stores/workspace.svelte";
import type { PageKind } from "$lib/workspace/types";

const ICON: Record<PageKind, string> = {
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  board: '<path d="M8.3 10a.7.7 0 0 1-.6-1l3.7-6a.7.7 0 0 1 1.2 0l3.7 6a.7.7 0 0 1-.6 1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
};

const live = new Set<() => void>();
/** Perbarui semua chip yang sedang tampil (judul diganti, halaman dibuang atau dipulihkan). */
export const refreshPageLinks = () => live.forEach((f) => f());

export interface PageLinkOptions {
  open(id: string): void;
}

export const PageLink = Node.create<PageLinkOptions>({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions: () => ({ open: () => undefined }),

  addAttributes() {
    return { id: { default: "" }, title: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-page-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-page-link": node.attrs.id }), node.attrs.title || tr("Halaman", "Page")];
  },

  renderText: ({ node }) => node.attrs.title,

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "page-link";
      dom.contentEditable = "false";
      dom.setAttribute("data-page-link", node.attrs.id);
      const paint = () => {
        const page = ws.nodes.find((n) => n.id === node.attrs.id);
        dom.classList.toggle("gone", !page);
        dom.dataset.kind = page?.kind ?? "doc";
        dom.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[(page?.kind ?? "doc") as PageKind]}</svg>`;
        const label = document.createElement("span");
        label.textContent = page ? page.title || tr("Tanpa judul", "Untitled") : tr("Halaman dibuang", "Page removed");
        dom.append(label);
      };
      paint();
      live.add(paint);
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        if (ws.nodes.some((n) => n.id === node.attrs.id)) this.options.open(node.attrs.id);
      });
      return { dom, update: (n) => n.type.name === "pageLink" && n.attrs.id === node.attrs.id, destroy: () => live.delete(paint) };
    };
  },
});
