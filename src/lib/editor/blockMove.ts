// Pindahkan blok di dokumen (paragraf, tabel, kalender, daftar, dan lainnya) ke atas atau bawah:
// seret pegangan di sisi kiri blok, atau tekan Alt+Panah atas/bawah.
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Posisi awal tiap blok tingkat atas. */
function offsets(view: EditorView): number[] {
  const out: number[] = [];
  view.state.doc.forEach((_n, offset) => out.push(offset));
  return out;
}

// Blok seperti ini bisa dipindah sendiri walau terselip di dalam butir daftar; selebihnya yang dipindah
// adalah blok tingkat atas yang memuatnya.
const SELF = new Set(["calendarBlock", "boardBlock", "table"]);

/** Satuan yang dipindah: posisinya, ukurannya, dan indeks blok tingkat atas yang memuatnya. */
export interface Unit {
  pos: number;
  size: number;
  top: number;
  nested: boolean;
}

function unitAtPos(view: EditorView, pos: number): Unit | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  const $p = view.state.doc.resolve(pos);
  return { pos, size: node.nodeSize, top: $p.index(0), nested: $p.depth > 0 };
}

export function unitFromCoords(view: EditorView, hit: { pos: number; inside: number }): Unit | null {
  const { doc } = view.state;
  if (hit.inside >= 0) {
    const n = doc.nodeAt(hit.inside);
    if (n && SELF.has(n.type.name)) return unitAtPos(view, hit.inside);
  }
  const $p = doc.resolve(hit.pos);
  for (let d = $p.depth; d > 0; d--) if (SELF.has($p.node(d).type.name)) return unitAtPos(view, $p.before(d));
  const i = Math.min($p.index(0), doc.childCount - 1);
  return unitAtPos(view, offsets(view)[i]);
}

function unitFromSelection(view: EditorView): Unit | null {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection) {
    const $p = view.state.doc.resolve(sel.from);
    if (sel.node.isBlock && ($p.depth === 0 || SELF.has(sel.node.type.name))) return unitAtPos(view, sel.from);
  }
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d--) if (SELF.has($f.node(d).type.name)) return unitAtPos(view, $f.before(d));
  return unitAtPos(view, offsets(view)[$f.index(0)]);
}

/** Pindahkan satuan ke tepi blok tingkat atas ke-`to` (to = jumlah blok berarti paling akhir). */
export function moveUnit(view: EditorView, unit: Unit, to: number): boolean {
  const { doc } = view.state;
  const n = doc.childCount;
  if (to < 0 || to > n) return false;
  if (!unit.nested && (to === unit.top || to === unit.top + 1)) return false;
  const node = doc.nodeAt(unit.pos);
  if (!node) return false;
  const target = to === n ? doc.content.size : offsets(view)[to];
  const tr = view.state.tr.delete(unit.pos, unit.pos + unit.size);
  const at = tr.mapping.map(target, -1);
  tr.insert(at, node);
  const was = view.state.selection instanceof NodeSelection;
  tr.setSelection(was ? NodeSelection.create(tr.doc, at) : TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const BlockMove = Extension.create<{ locked: () => boolean }>({
  name: "blockMove",

  addOptions: () => ({ locked: () => false }),

  addKeyboardShortcuts() {
    const step = (dir: -1 | 1) => () => {
      if (this.options.locked()) return true;
      const view = this.editor.view;
      const u = unitFromSelection(view);
      if (u) moveUnit(view, u, dir < 0 ? (u.nested ? u.top : u.top - 1) : u.nested ? u.top + 1 : u.top + 2);
      return true;
    };
    return { "Alt-ArrowUp": step(-1), "Alt-ArrowDown": step(1) };
  },

  addProseMirrorPlugins() {
    const locked = this.options.locked;
    return [
      new Plugin({
        view(view) {
          const host = view.dom.parentElement as HTMLElement;
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "block-handle";
          handle.setAttribute("aria-label", "Pindahkan blok (seret, atau Alt+Panah)");
          handle.title = "Seret untuk memindahkan blok";
          handle.innerHTML = '<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg>';
          handle.style.display = "none";
          const line = document.createElement("div");
          line.className = "block-drop";
          line.style.display = "none";
          host.append(handle, line);

          let hovered: Unit | null = null;
          let dragging = false;
          let from: Unit | null = null;
          let to = -1;

          const blockRect = (i: number) => (view.nodeDOM(offsets(view)[i]) as HTMLElement | null)?.getBoundingClientRect() ?? null;
          const unitRect = (u: Unit) => (view.nodeDOM(u.pos) as HTMLElement | null)?.getBoundingClientRect() ?? null;
          const rel = (r: DOMRect) => ({ top: r.top - host.getBoundingClientRect().top, left: r.left - host.getBoundingClientRect().left });

          function show(u: Unit) {
            const r = unitRect(u);
            if (!r) return;
            hovered = u;
            const p = rel(r);
            handle.style.display = "grid";
            handle.style.top = `${p.top + 2}px`;
            handle.style.left = `${p.left - 26}px`;
          }

          function indexAt(y: number): number {
            const n = view.state.doc.childCount;
            for (let i = 0; i < n; i++) {
              const r = blockRect(i);
              if (r && y < r.top + r.height / 2) return i;
            }
            return n;
          }

          const onMove = (e: MouseEvent) => {
            if (locked() || dragging || e.target === handle || handle.contains(e.target as Node)) return;
            keep();
            const hit = view.posAtCoords({ left: Math.max(e.clientX, view.dom.getBoundingClientRect().left + 2), top: e.clientY });
            if (!hit) return;
            const u = unitFromCoords(view, hit);
            if (u && (!hovered || u.pos !== hovered.pos)) show(u);
          };
          // Pegangan hilang dengan jeda, supaya kursor sempat berpindah dari teks ke pegangan.
          let hideTimer: ReturnType<typeof setTimeout> | undefined;
          const hideSoon = () => {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              if (dragging) return;
              handle.style.display = "none";
              hovered = null;
            }, 350);
          };
          const keep = () => clearTimeout(hideTimer);
          const onLeave = () => hideSoon();
          handle.addEventListener("mouseenter", keep);
          handle.addEventListener("mouseleave", hideSoon);

          const onDragMove = (e: PointerEvent) => {
            to = indexAt(e.clientY);
            const n = view.state.doc.childCount;
            const r = blockRect(Math.min(to, n - 1));
            if (!r) return;
            const p = rel(r);
            line.style.display = "block";
            line.style.top = `${(to === n ? p.top + r.height : p.top) - 2}px`;
            line.style.left = `${p.left}px`;
            line.style.width = `${r.width}px`;
          };
          const onCancel = () => {
            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            dragging = false;
            from = null;
            line.style.display = "none";
            handle.classList.remove("on");
            document.body.style.cursor = "";
          };
          const onUp = () => {
            window.removeEventListener("pointercancel", onCancel);
            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onUp);
            dragging = false;
            line.style.display = "none";
            handle.classList.remove("on");
            document.body.style.cursor = "";
            if (from && to >= 0) moveUnit(view, from, to);
            handle.style.display = "none";
            hovered = null;
          };
          handle.addEventListener("pointerdown", (e) => {
            if (!hovered) return;
            e.preventDefault();
            dragging = true;
            from = hovered;
            to = -1;
            handle.classList.add("on");
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onCancel);
          });

          // Seret langsung: blok kalender atau papan yang SUDAH terpilih (bergaris putus-putus) bisa digeser
          // dengan menyeret bagian mana pun darinya. Blok yang belum terpilih hanya terpilih saat diklik,
          // jadi tidak ikut bergeser tanpa sengaja.
          let armed: { x: number; y: number; unit: Unit } | null = null;
          const DIRECT = new Set(["calendarBlock", "boardBlock"]);
          const disarm = () => {
            armed = null;
            window.removeEventListener("pointermove", onArmedMove);
            window.removeEventListener("pointerup", disarm);
          };
          function onArmedMove(e: PointerEvent) {
            if (!armed) return;
            if (Math.hypot(e.clientX - armed.x, e.clientY - armed.y) < 5) return;
            const unit = armed.unit;
            disarm();
            dragging = true;
            from = unit;
            to = -1;
            document.body.style.cursor = "grabbing";
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onCancel);
            onDragMove(e);
          }
          const onDown = (e: MouseEvent) => {
            if (locked() || e.button !== 0) return;
            const target = e.target as Element;
            if (target.closest("button, input, select, a, textarea, [role=listbox], .block-handle")) return;
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection) || !DIRECT.has(sel.node.type.name)) return;
            const dom = view.nodeDOM(sel.from) as HTMLElement | null;
            const unit = unitAtPos(view, sel.from);
            if (!dom || !unit || !dom.contains(target)) return;
            // Node yang terpilih bisa diseret oleh browser sendiri (drag bawaan); itu dicegah supaya gerakan ini kita yang pegang.
            e.preventDefault();
            armed = { x: e.clientX, y: e.clientY, unit };
            window.addEventListener("pointermove", onArmedMove);
            window.addEventListener("pointerup", disarm);
          };
          // Fase tangkap: dibaca sebelum klik itu sendiri memilih blok.
          view.dom.addEventListener("mousedown", onDown, true);
          const onNativeDrag = (e: Event) => {
            if (armed || dragging) e.preventDefault();
          };
          view.dom.addEventListener("dragstart", onNativeDrag, true);

          host.addEventListener("mousemove", onMove);
          host.addEventListener("mouseleave", onLeave);
          return {
            update() {
              // Isi dokumen berubah: posisi blok bisa bergeser, jadi pegangan dicari lagi dari gerak kursor.
              if (!dragging) hideSoon();
            },
            destroy() {
              view.dom.removeEventListener("mousedown", onDown, true);
              view.dom.removeEventListener("dragstart", onNativeDrag, true);
              disarm();
              host.removeEventListener("mousemove", onMove);
              host.removeEventListener("mouseleave", onLeave);
              window.removeEventListener("pointermove", onDragMove);
              window.removeEventListener("pointerup", onUp);
              handle.remove();
              line.remove();
            },
          };
        },
      }),
    ];
  },
});
