<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Editor } from "@tiptap/core";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import StarterKit from "@tiptap/starter-kit";
  import TaskList from "@tiptap/extension-task-list";
  import TaskItem from "@tiptap/extension-task-item";
  import Placeholder from "@tiptap/extension-placeholder";
  import { TextStyleKit } from "@tiptap/extension-text-style";
  import Highlight from "@tiptap/extension-highlight";
  import TextAlign from "@tiptap/extension-text-align";
  import Subscript from "@tiptap/extension-subscript";
  import Superscript from "@tiptap/extension-superscript";
  import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
  import {
    AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, SquareCode, Heading1, Heading2, Heading3, Highlighter, IndentDecrease,
    IndentIncrease, CalendarDays, Shapes, Italic, Link as LinkIcon, Link2, StickyNote, Unlink, List, ListChecks, ListOrdered, Minus, Quote, Redo2, RemoveFormatting,
    Strikethrough, Subscript as SubIcon, Superscript as SupIcon, Table as TableIcon, Underline as UnderlineIcon, Undo2,
  } from "@lucide/svelte";
  import { BlockMove } from "$lib/editor/blockMove";
  import { NoteLink } from "$lib/editor/noteLink";
  import { BoardBlockNode } from "$lib/editor/boardBlock.svelte";
  import { CalendarBlockNode } from "$lib/editor/calendarBlock.svelte";
  import { PageLink, refreshPageLinks } from "$lib/editor/pageLink";
  import { ws } from "$lib/stores/workspace.svelte";
  import { contextMenu } from "$lib/stores/contextmenu.svelte";
  import { editableOf, textMenu } from "$lib/ui/textmenu";
  import { kindIcon } from "$lib/workspace/kinds";
  import Select from "$lib/ui/Select.svelte";
  import ColorPicker from "$lib/ui/ColorPicker.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";

  let { content, onchange, spellcheck = true, toolbar = true, pageId = "", locked = false, noteLinks = null }: { content: string; onchange: (json: string, plain: string) => void; spellcheck?: boolean; toolbar?: boolean; pageId?: string; locked?: boolean; noteLinks?: { notes: { id: string; label: string }[]; create: () => string } | null } = $props();

  let element: HTMLDivElement;
  let editor = $state.raw<Editor>();
  // Naik setiap transaksi supaya status tombol (tebal, daftar, dan lainnya) ikut diperbarui.
  let tick = $state(0);

  // Menu "/": ketik "/" di awal baris atau setelah spasi untuk menyisipkan blok.
  type SlashItem = { label: string; hint: string; keys: string; icon: typeof Bold; run: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]> };
  const SLASH = $derived<SlashItem[]>([
    { label: tr("Judul besar", "Large heading"), hint: tr("Judul bagian utama", "Main section heading"), keys: "judul heading h1 besar title heading h1 large", icon: Heading1, run: (c) => c.toggleHeading({ level: 1 }) },
    { label: tr("Judul", "Heading"), hint: tr("Judul bagian", "Section heading"), keys: "judul heading h2 title heading h2", icon: Heading2, run: (c) => c.toggleHeading({ level: 2 }) },
    { label: tr("Sub judul", "Subheading"), hint: tr("Judul kecil", "Small heading"), keys: "sub judul heading h3 subtitle heading h3", icon: Heading3, run: (c) => c.toggleHeading({ level: 3 }) },
    { label: tr("Daftar poin", "Bullet list"), hint: tr("Daftar dengan titik", "List with dots"), keys: "daftar poin bullet list bullet list points", icon: List, run: (c) => c.toggleBulletList() },
    { label: tr("Daftar bernomor", "Numbered list"), hint: tr("Daftar 1, 2, 3", "List 1, 2, 3"), keys: "daftar nomor numbered urut numbered list order", icon: ListOrdered, run: (c) => c.toggleOrderedList() },
    { label: tr("Daftar centang", "Task list"), hint: tr("Tugas yang bisa dicentang", "Tasks you can check off"), keys: "centang tugas todo task checklist check task todo checklist", icon: ListChecks, run: (c) => c.toggleTaskList() },
    { label: tr("Kutipan", "Quote"), hint: tr("Teks kutipan", "Quoted text"), keys: "kutipan quote quote blockquote", icon: Quote, run: (c) => c.toggleBlockquote() },
    { label: tr("Kotak kode", "Code block"), hint: tr("Beberapa baris kode dalam satu kotak", "Several lines of code in one box"), keys: "kode code kotak blok code block", icon: SquareCode, run: (c) => c.toggleCodeBlock() },
    { label: tr("Garis pemisah", "Divider"), hint: tr("Garis mendatar", "Horizontal line"), keys: "garis pemisah divider hr divider line hr", icon: Minus, run: (c) => c.setHorizontalRule() },
    { label: tr("Tautan ke halaman", "Link to page"), hint: tr("Hubungkan ke dokumen, papan, atau tabel lain", "Connect to another document, board, or table"), keys: "tautan link halaman wiki dokumen link page wiki document", icon: Link2, run: (c) => c.insertContent("[[") },
    { label: tr("Kalender", "Calendar"), hint: tr("Acara untuk rentang waktu pilihanmu", "Events for a time range you choose"), keys: "kalender calendar agenda acara jadwal calendar agenda event schedule", icon: CalendarDays, run: (c) => c.insertContent({ type: "calendarBlock", attrs: { range: "week" } }) },
    { label: tr("Papan", "Board"), hint: tr("Tampilkan gambar dari papan (hanya baca)", "Show the drawing from a board (read only)"), keys: "papan board gambar whiteboard board whiteboard drawing", icon: Shapes, run: (c) => c.insertContent({ type: "boardBlock", attrs: { pageId: "" } }) },
    { label: tr("Tabel", "Table"), hint: tr("Tabel 3 × 3", "3 × 3 table"), keys: "tabel table kolom baris table column row", icon: TableIcon, run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  ]);
  let slash = $state<{ from: number; to: number; query: string; x: number; y: number } | null>(null);
  let slashIndex = $state(0);
  const slashItems = $derived(
    slash ? SLASH.filter((i) => `${i.label} ${i.keys}`.toLowerCase().includes(slash!.query.toLowerCase())) : [],
  );

  // Menu "[[": cari halaman lalu sisipkan tautan; judul yang belum ada bisa langsung dibuat.
  type WikiItem = { id: string | null; label: string; kind: string };
  let wiki = $state<{ from: number; to: number; query: string; x: number; y: number } | null>(null);
  let wikiIndex = $state(0);
  const wikiItems = $derived.by<WikiItem[]>(() => {
    if (!wiki) return [];
    const q = wiki.query.trim().toLowerCase();
    const hits = ws.nodes
      .filter((n) => n.id !== pageId && (n.title || tr("Tanpa judul", "Untitled")).toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({ id: n.id, label: n.title || tr("Tanpa judul", "Untitled"), kind: n.kind }));
    const exact = ws.nodes.some((n) => n.title.trim().toLowerCase() === q);
    return q && !exact ? [...hits, { id: null, label: wiki.query.trim(), kind: "new" }] : hits;
  });

  function updateWiki(e: Editor): boolean {
    const { selection } = e.state;
    const res = selection.$from;
    if (!selection.empty || !res.parent.isTextblock || res.parent.type.name === "codeBlock") return false;
    const before = res.parent.textBetween(0, res.parentOffset, undefined, "\ufffc");
    const m = /\[\[([^\]\[]*)$/.exec(before);
    if (!m) return false;
    const to = selection.from;
    const at = e.view.coordsAtPos(to);
    if (!wiki || wiki.query !== m[1]) wikiIndex = 0;
    wiki = { from: to - m[1].length - 2, to, query: m[1], x: at.left, y: at.bottom + 6 };
    return true;
  }

  async function runWiki(item: WikiItem) {
    if (!editor || !wiki) return;
    const { from, to } = wiki;
    wiki = null;
    let id = item.id;
    if (!id) id = (await ws.create("doc", null, { title: item.label })).id;
    editor.chain().focus().deleteRange({ from, to }).insertContent([{ type: "pageLink", attrs: { id, title: item.label } }, { type: "text", text: " " }]).run();
  }

  function wikiKey(event: KeyboardEvent): boolean {
    if (!wiki || !wikiItems.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const n = wikiItems.length;
      wikiIndex = (wikiIndex + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      void runWiki(wikiItems[Math.min(wikiIndex, wikiItems.length - 1)]);
      return true;
    }
    if (event.key === "Escape") {
      wiki = null;
      return true;
    }
    return false;
  }

  function updateSlash(e: Editor) {
    if (updateWiki(e)) {
      slash = null;
      return;
    }
    wiki = null;
    const { selection } = e.state;
    const res = selection.$from;
    if (!selection.empty || !res.parent.isTextblock || res.parent.type.name === "codeBlock") {
      slash = null;
      return;
    }
    const before = res.parent.textBetween(0, res.parentOffset, undefined, "\ufffc");
    const m = /(^|\s)\/([^\s/]*)$/.exec(before);
    if (!m) {
      slash = null;
      return;
    }
    const to = selection.from;
    const from = to - m[2].length - 1;
    const at = e.view.coordsAtPos(to);
    if (!slash || slash.query !== m[2]) slashIndex = 0;
    slash = { from, to, query: m[2], x: at.left, y: at.bottom + 6 };
  }

  function runSlash(item: SlashItem) {
    if (!editor || !slash) return;
    const { from, to } = slash;
    slash = null;
    item.run(editor.chain().focus().deleteRange({ from, to })).run();
  }

  function slashKey(event: KeyboardEvent): boolean {
    if (!slash || !slashItems.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const n = slashItems.length;
      slashIndex = (slashIndex + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      runSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)]);
      return true;
    }
    if (event.key === "Escape") {
      slash = null;
      return true;
    }
    return false;
  }

  const editorProps = () => ({ attributes: { spellcheck: String(spellcheck) }, handleKeyDown: (_view: unknown, event: KeyboardEvent) => wikiKey(event) || slashKey(event) });

  function parse(raw: string): object | string {
    if (!raw.trim()) return "";
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // teks biasa dari sumber lain
    }
  }

  onMount(() => {
    const instance = new Editor({
      element,
      extensions: [
        StarterKit,
        BlockMove.configure({ locked: () => locked }),
        NoteLink,
        CalendarBlockNode,
        BoardBlockNode,
        PageLink.configure({ open: (id) => void goto(`/p/${id}`) }),
        TextStyleKit,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Subscript,
        Superscript,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: tr("Tulis sesuatu di sini…", "Write something here…") }),
      ],
      content: parse(content),
      editorProps: editorProps(),
      onTransaction: ({ editor: e }) => {
        tick++;
        updateSlash(e);
      },
      onBlur: () => {
        slash = null;
        wiki = null;
      },
      onUpdate: ({ editor: e }) => onchange(JSON.stringify(e.getJSON()), e.getText({ blockSeparator: "\n" })),
    });
    editor = instance;
    return () => instance.destroy();
  });

  $effect(() => {
    void spellcheck;
    editor?.setOptions({ editorProps: editorProps() });
  });

  // Judul halaman diganti atau halaman dibuang: chip tautan ikut diperbarui.
  $effect(() => {
    void ws.nodes;
    refreshPageLinks();
  });

  const active = (name: string, attrs?: Record<string, unknown>) => {
    void tick;
    return editor?.isActive(name, attrs) ?? false;
  };
  /**
   * Ganti isi dengan versi dari jendela lain (tanpa memicu `onchange`, supaya tidak saling memantul).
   * Letak kursor dipertahankan sejauh masih ada di dokumen baru.
   */
  export function setRemote(json: string) {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) === json) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(parse(json), { emitUpdate: false });
    const size = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
  }

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor!.chain().focus()).run();

  // Nilai kontrol toolbar dibaca dari keadaan editor (ikut `tick`).
  const attr = (mark: string, key: string): string => {
    void tick;
    return (editor?.getAttributes(mark)[key] as string | undefined) ?? "";
  };
  const blockStyle = $derived.by(() => {
    void tick;
    for (const level of [1, 2, 3]) if (editor?.isActive("heading", { level })) return `h${level}`;
    return "p";
  });
  const aligned = (a: string) => {
    void tick;
    const cur = (editor?.getAttributes("paragraph").textAlign ?? editor?.getAttributes("heading").textAlign ?? "left") as string;
    return cur === a;
  };
  const BLOCKS = $derived([
    { value: "p", label: tr("Paragraf", "Paragraph") },
    { value: "h1", label: tr("Judul 1", "Heading 1") },
    { value: "h2", label: tr("Judul 2", "Heading 2") },
    { value: "h3", label: tr("Judul 3", "Heading 3") },
  ]);
  const FONTS = $derived([
    { value: "", label: tr("Bawaan", "Default") },
    { value: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", label: "Sans" },
    { value: "ui-serif, Georgia, 'Times New Roman', serif", label: "Serif" },
    { value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", label: "Mono" },
    { value: "'Comic Sans MS', 'Chalkboard SE', cursive", label: tr("Santai", "Casual") },
  ]);
  const SIZES = $derived(["", "10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px"].map((v) => ({ value: v, label: v ? v.replace("px", "") : tr("Ukuran", "Size") })));
  const LINES = $derived([
    { value: "", label: tr("Jarak baris", "Line spacing") },
    { value: "1", label: "1,0" },
    { value: "1.15", label: "1,15" },
    { value: "1.5", label: "1,5" },
    { value: "2", label: "2,0" },
    { value: "2.5", label: "2,5" },
  ]);
  function setBlock(v: string) {
    if (v === "p") run((c) => c.setParagraph());
    else run((c) => c.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }));
  }
  const setFont = (v: string) => run((c) => (v ? c.setFontFamily(v) : c.unsetFontFamily()));
  const setSize = (v: string) => run((c) => (v ? c.setFontSize(v) : c.unsetFontSize()));
  const setLine = (v: string) => run((c) => (v ? c.setLineHeight(v) : c.unsetLineHeight()));
  const inTable = $derived.by(() => (void tick, editor?.isActive("table") ?? false));
  const canList = $derived.by(() => (void tick, !!editor && (editor.isActive("listItem") || editor.isActive("taskItem"))));

  async function setLink() {
    if (!editor) return;
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const { from, to } = editor.state.selection;
    const input = await dialog.prompt(tr("Alamat tautan (kosongkan untuk melepas):", "Link address (leave empty to remove):"), prev || "https://", { okLabel: tr("Pasang", "Apply") });
    if (input === null) return;
    const href = input.trim();
    const chain = editor.chain().focus();
    if (!href || href === "https://") return void chain.extendMarkRange("link").unsetLink().run();
    const full = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
    if (from === to && !editor.isActive("link")) chain.insertContent({ type: "text", text: full, marks: [{ type: "link", attrs: { href: full } }] }).run();
    else chain.extendMarkRange("link").setLink({ href: full }).run();
  }

  /** Sisipkan blok sebagai blok tersendiri di bawah paragraf atau butir yang sedang dipakai. */
  function insertBlock(type: string, attrs: Record<string, unknown>) {
    if (!editor) return;
    const sel = editor.state.selection;
    const pos = sel.$to.depth >= 1 ? sel.$to.after(1) : sel.to;
    editor.chain().focus().insertContentAt(pos, { type, attrs }).run();
  }

  /** Pilih seluruh tabel tempat kursor berada (untuk dihapus, atau diberi tanda pilihan). */
  function selectTable() {
    if (!editor) return;
    const from = editor.state.selection.$from;
    for (let d = from.depth; d > 0; d--) {
      if (from.node(d).type.name === "table") return void editor.chain().focus().setNodeSelection(from.before(d)).run();
    }
  }

  const randomArrow = () => Math.floor(Math.random() * 10);

  /** Sorot teks terpilih dan hubungkan ke catatan melayang (panah digambar oleh halaman). */
  function linkToNote(noteId: string) {
    if (!editor) return;
    editor.chain().focus().setMark("noteLink", { noteId, linkId: crypto.randomUUID(), arrow: randomArrow() }).run();
  }

  /** Lepas semua hubungan ke satu catatan (dipanggil saat catatannya dihapus). */
  export function unlinkNote(noteId: string) {
    if (!editor) return;
    const type = editor.schema.marks.noteLink;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.marks.some((m) => m.type === type && m.attrs.noteId === noteId)) tr.removeMark(pos, pos + node.nodeSize, type);
    });
    if (tr.docChanged || tr.steps.length) editor.view.dispatch(tr);
  }

  function onContext(event: MouseEvent) {
    if (!noteLinks || !editor) return;
    const field = editableOf(event.target as Element | null);
    const link = (event.target as Element | null)?.closest("[data-note-link]");
    const { empty } = editor.state.selection;
    if (link && empty) {
      const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      contextMenu.show(event, [
        ...textMenu(field),
        {
          label: tr("Lepas hubungan ke catatan", "Unlink from note"),
          icon: Unlink,
          separator: true,
          onclick: () => {
            if (hit) editor!.chain().focus().setTextSelection(hit.pos).extendMarkRange("noteLink").unsetMark("noteLink").run();
          },
        },
      ]);
      return;
    }
    if (empty) return;
    contextMenu.show(event, [
      ...textMenu(field),
      ...noteLinks.notes.map((n, i) => ({ label: tr(`Hubungkan ke ${n.label}`, `Link to ${n.label}`), icon: StickyNote, separator: i === 0, onclick: () => linkToNote(n.id) })),
      { label: tr("Hubungkan ke catatan baru", "Link to new note"), icon: StickyNote, separator: noteLinks.notes.length === 0, onclick: () => linkToNote(noteLinks!.create()) },
    ]);
  }

  function indent(by: 1 | -1) {
    if (!editor) return;
    const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
    const chain = editor.chain().focus();
    (by > 0 ? chain.sinkListItem(type) : chain.liftListItem(type)).run();
  }

  function openLink(event: MouseEvent) {
    const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !/^https?:\/\//.test(a.href)) return;
    event.preventDefault();
    event.stopPropagation();
    if (isTauri()) void openUrl(a.href).catch(() => undefined);
    else window.open(a.href, "_blank", "noopener");
  }
</script>

{#if toolbar}
<div class="bar" role="toolbar" aria-label="Format teks">
  <div class="row">
    <div class="grp">
      <button title={tr("Urungkan (⌘Z)", "Undo (⌘Z)")} aria-label={tr("Urungkan", "Undo")} onclick={() => run((c) => c.undo())}><Undo2 size={16} /></button>
      <button title={tr("Ulangi (⇧⌘Z)", "Redo (⇧⌘Z)")} aria-label={tr("Ulangi", "Redo")} onclick={() => run((c) => c.redo())}><Redo2 size={16} /></button>
      <button title={tr("Hapus format", "Clear formatting")} aria-label={tr("Hapus format", "Clear formatting")} onclick={() => run((c) => c.unsetAllMarks().clearNodes().unsetTextAlign())}><RemoveFormatting size={16} /></button>
    </div>
    <div class="grp">
      <div class="dd w-block"><Select class="tb-sel" value={blockStyle} options={BLOCKS} label={tr("Gaya paragraf", "Paragraph style")} onchange={setBlock} /></div>
      <div class="dd w-font"><Select class="tb-sel" value={attr("textStyle", "fontFamily")} options={FONTS} label={tr("Jenis huruf", "Font")} onchange={setFont} /></div>
      <div class="dd w-size"><Select class="tb-sel" value={attr("textStyle", "fontSize")} options={SIZES} label={tr("Ukuran huruf", "Font size")} onchange={setSize} /></div>
    </div>
    <div class="grp">
      <button class:on={active("bold")} title={tr("Tebal (⌘B)", "Bold (⌘B)")} aria-label={tr("Tebal", "Bold")} onclick={() => run((c) => c.toggleBold())}><Bold size={16} /></button>
      <button class:on={active("italic")} title={tr("Miring (⌘I)", "Italic (⌘I)")} aria-label={tr("Miring", "Italic")} onclick={() => run((c) => c.toggleItalic())}><Italic size={16} /></button>
      <button class:on={active("underline")} title={tr("Garis bawah (⌘U)", "Underline (⌘U)")} aria-label={tr("Garis bawah", "Underline")} onclick={() => run((c) => c.toggleUnderline())}><UnderlineIcon size={16} /></button>
      <button class:on={active("strike")} title={tr("Coret", "Strikethrough")} aria-label={tr("Coret", "Strikethrough")} onclick={() => run((c) => c.toggleStrike())}><Strikethrough size={16} /></button>
      <button class:on={active("subscript")} title={tr("Subskrip", "Subscript")} aria-label={tr("Subskrip", "Subscript")} onclick={() => run((c) => c.toggleSubscript())}><SubIcon size={16} /></button>
      <button class:on={active("superscript")} title={tr("Superskrip", "Superscript")} aria-label={tr("Superskrip", "Superscript")} onclick={() => run((c) => c.toggleSuperscript())}><SupIcon size={16} /></button>
      <button class:on={active("code")} title={tr("Huruf kode (dalam kalimat)", "Inline code (within a sentence)")} aria-label={tr("Huruf kode", "Inline code")} onclick={() => run((c) => c.toggleCode())}><Code size={16} /></button>
    </div>
    <div class="grp">
        <ColorPicker
          class="tb-ico"
          label={tr("Warna teks", "Text color")}
          value={attr("textStyle", "color") || "#7e6cf0"}
          onchange={(v) => run((c) => c.setColor(v))}
          onclear={() => run((c) => c.unsetColor())}
        >
          <span class="aa" style:--c={attr("textStyle", "color") || "var(--text-muted)"}>A</span>
        </ColorPicker>
        <ColorPicker
          class="tb-ico"
          label={tr("Warna sorot", "Highlight color")}
          value={attr("highlight", "color") || "#ffe066"}
          onchange={(v) => run((c) => c.setHighlight({ color: v }))}
          onclear={() => run((c) => c.unsetHighlight())}
        >
          <Highlighter size={16} />
        </ColorPicker>
    </div>
  </div>
  <div class="row">
    <div class="grp">
      <button class:on={aligned("left")} title={tr("Rata kiri", "Align left")} aria-label={tr("Rata kiri", "Align left")} onclick={() => run((c) => c.setTextAlign("left"))}><AlignLeft size={16} /></button>
      <button class:on={aligned("center")} title={tr("Rata tengah", "Align center")} aria-label={tr("Rata tengah", "Align center")} onclick={() => run((c) => c.setTextAlign("center"))}><AlignCenter size={16} /></button>
      <button class:on={aligned("right")} title={tr("Rata kanan", "Align right")} aria-label={tr("Rata kanan", "Align right")} onclick={() => run((c) => c.setTextAlign("right"))}><AlignRight size={16} /></button>
      <button class:on={aligned("justify")} title={tr("Rata kiri-kanan", "Justify")} aria-label={tr("Rata kiri-kanan", "Justify")} onclick={() => run((c) => c.setTextAlign("justify"))}><AlignJustify size={16} /></button>
      <div class="dd w-line"><Select class="tb-sel" value={attr("textStyle", "lineHeight")} options={LINES} label="Jarak baris" onchange={setLine} /></div>
    </div>
    <div class="grp">
      <button class:on={active("bulletList")} title={tr("Daftar poin", "Bullet list")} aria-label={tr("Daftar poin", "Bullet list")} onclick={() => run((c) => c.toggleBulletList())}><List size={16} /></button>
      <button class:on={active("orderedList")} title={tr("Daftar bernomor", "Numbered list")} aria-label={tr("Daftar bernomor", "Numbered list")} onclick={() => run((c) => c.toggleOrderedList())}><ListOrdered size={16} /></button>
      <button class:on={active("taskList")} title={tr("Daftar centang", "Task list")} aria-label={tr("Daftar centang", "Task list")} onclick={() => run((c) => c.toggleTaskList())}><ListChecks size={16} /></button>
      <button disabled={!canList} title={tr("Kurangi lekukan", "Decrease indent")} aria-label={tr("Kurangi lekukan", "Decrease indent")} onclick={() => indent(-1)}><IndentDecrease size={16} /></button>
      <button disabled={!canList} title={tr("Tambah lekukan", "Increase indent")} aria-label={tr("Tambah lekukan", "Increase indent")} onclick={() => indent(1)}><IndentIncrease size={16} /></button>
    </div>
    <div class="grp">
      <button class:on={active("link")} title={tr("Tautan", "Link")} aria-label={tr("Tautan", "Link")} onclick={setLink}><LinkIcon size={16} /></button>
      <button title={tr("Tautan ke halaman", "Link to page")} aria-label={tr("Tautan ke halaman", "Link to page")} onclick={() => run((c) => c.insertContent("[["))}><Link2 size={16} /></button>
      <button title={tr("Sisipkan kalender", "Insert calendar")} aria-label={tr("Sisipkan kalender", "Insert calendar")} onclick={() => insertBlock("calendarBlock", { range: "week" })}><CalendarDays size={16} /></button>
      <button title={tr("Sisipkan papan", "Insert board")} aria-label={tr("Sisipkan papan", "Insert board")} onclick={() => insertBlock("boardBlock", { pageId: "" })}><Shapes size={16} /></button>
      <button title={tr("Tabel", "Table")} aria-label={tr("Sisipkan tabel", "Insert table")} onclick={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><TableIcon size={16} /></button>
      <button class:on={active("blockquote")} title={tr("Kutipan", "Quote")} aria-label={tr("Kutipan", "Quote")} onclick={() => run((c) => c.toggleBlockquote())}><Quote size={16} /></button>
      <button class:on={active("codeBlock")} title={tr("Kotak kode (beberapa baris)", "Code block (multiple lines)")} aria-label={tr("Kotak kode", "Code block")} onclick={() => run((c) => c.toggleCodeBlock())}><SquareCode size={16} /></button>
      <button title={tr("Garis pemisah", "Divider")} aria-label={tr("Garis pemisah", "Divider")} onclick={() => run((c) => c.setHorizontalRule())}><Minus size={16} /></button>
    </div>
  </div>
</div>
{#if inTable}
  <div class="bar tbl" role="toolbar" aria-label={tr("Tabel", "Table")}>
    <button class="txt" onclick={selectTable}>Pilih tabel</button>
    <span class="sep"></span>
    <button class="txt" onclick={() => run((c) => c.addRowBefore())}>Baris di atas</button>
    <button class="txt" onclick={() => run((c) => c.addRowAfter())}>Baris di bawah</button>
    <button class="txt" onclick={() => run((c) => c.addColumnBefore())}>Kolom di kiri</button>
    <button class="txt" onclick={() => run((c) => c.addColumnAfter())}>Kolom di kanan</button>
    <span class="sep"></span>
    <button class="txt" onclick={() => run((c) => c.deleteRow())}>Hapus baris</button>
    <button class="txt" onclick={() => run((c) => c.deleteColumn())}>Hapus kolom</button>
    <button class="txt" onclick={() => run((c) => c.toggleHeaderRow())}>Baris judul</button>
    <button class="txt danger" onclick={() => run((c) => c.deleteTable())}>Hapus tabel</button>
  </div>
{/if}
{/if}

<!-- Tautan di dalam catatan dibuka di browser (bukan di jendela app). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="doc" bind:this={element} onclickcapture={openLink} oncontextmenu={onContext}></div>

{#if wiki && wikiItems.length}
  <div class="slash" role="listbox" aria-label="Tautkan ke halaman" style:left="{wiki.x}px" style:top="{wiki.y}px">
    {#each wikiItems as item, i (item.id ?? "new")}
      {@const Icon = kindIcon(item.kind === "new" ? "doc" : item.kind)}
      <button role="option" aria-selected={i === wikiIndex} class:on={i === wikiIndex} onmousedown={(e) => e.preventDefault()} onmouseenter={() => (wikiIndex = i)} onclick={() => runWiki(item)}>
        <span class="ic"><Icon size={16} /></span><span><b>{item.id ? item.label : `Buat «${item.label}»`}</b>{#if !item.id}<small>Dokumen baru, langsung ditautkan</small>{/if}</span>
      </button>
    {/each}
  </div>
{/if}

{#if slash && slashItems.length}
  <div class="slash" role="listbox" aria-label="Sisipkan blok" style:left="{slash.x}px" style:top="{slash.y}px">
    {#each slashItems as item, i (item.label)}
      {@const Icon = item.icon}
      <button role="option" aria-selected={i === slashIndex} class:on={i === slashIndex} onmousedown={(e) => e.preventDefault()} onmouseenter={() => (slashIndex = i)} onclick={() => runSlash(item)}>
        <span class="ic"><Icon size={16} /></span><span><b>{item.label}</b><small>{item.hint}</small></span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* Bilah alat: satu kartu dengan dua baris, tiap baris berisi kelompok-kelompok kecil. */
  .bar {
    position: sticky;
    top: 8px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    margin-bottom: var(--space-4);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius);
    box-shadow: var(--lift);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 2px;
    background: var(--surface-2);
    border-radius: 10px;
  }
  button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: var(--edge-w) solid transparent;
    background: none;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface);
    color: var(--text);
  }
  button.on {
    background: var(--accent);
    border-color: var(--edge);
    color: var(--accent-contrast);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.txt {
    width: auto;
    padding: 0 10px;
    font-size: 0.85em;
  }
  button.txt.danger {
    color: var(--danger);
  }
  .bar.tbl {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    margin-top: calc(-1 * var(--space-2));
    box-shadow: none;
    background: var(--surface-2);
  }
  .bar.tbl button.txt:hover {
    background: var(--surface);
  }
  .dd {
    flex: none;
  }
  .dd.w-block { width: 112px; }
  .dd.w-font { width: 96px; }
  .dd.w-size { width: 84px; }
  .dd.w-line { width: 118px; }
  .dd :global(.tb-sel) {
    padding: 3px 8px;
    font-size: 0.88em;
    background: transparent;
    border-color: transparent;
  }
  .dd :global(.tb-sel:hover:not(:disabled)) {
    background: var(--surface);
  }
  .bar :global(.tb-ico) {
    width: 30px;
    height: 30px;
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: none;
    color: var(--text-muted);
  }
  .bar :global(.tb-ico:hover:not(:disabled)) {
    background: var(--surface);
    color: var(--text);
  }
  .aa {
    font-weight: 700;
    border-bottom: 3px solid var(--c);
    line-height: 1;
    padding: 0 2px;
  }
  .sep {
    width: 1px;
    height: 1.2em;
    margin: 0 4px;
    background: var(--border);
  }

  .doc {
    position: relative;
  }
  /* Pegangan pindah blok di sisi kiri, dan garis tempat blok akan jatuh. */
  .doc :global(.block-handle) {
    position: absolute;
    z-index: 4;
    width: 26px;
    height: 26px;
    padding: 0;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
  }
  .doc :global(.block-handle:hover),
  .doc :global(.block-handle.on) {
    background: var(--surface-2);
    color: var(--text);
  }
  .doc :global(.block-drop) {
    position: absolute;
    z-index: 4;
    height: 3px;
    border-radius: 2px;
    background: var(--accent-strong);
    pointer-events: none;
  }
  /* Elemen yang sedang dipilih (blok kalender, tabel, chip tautan): garis putus-putus di pinggirnya. */
  .doc :global(.ProseMirror-selectednode[data-calendar-block]),
  .doc :global(.ProseMirror-selectednode[data-board-block]) {
    cursor: grab;
  }
  .doc :global(.ProseMirror-selectednode),
  .doc :global(.tiptap .tableWrapper.selected),
  .doc :global(.tiptap table:has(.selectedCell)) {
    outline: 2px dashed var(--edge);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }
  .doc :global(.tiptap .selectedCell::after) {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .doc :global(.note-link) {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 3px;
    padding: 1px 0;
  }
  .doc :global(.page-link) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    margin: 0 1px;
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
    background: var(--accent-soft);
    font-size: 0.92em;
    font-weight: 600;
    line-height: 1.6;
    cursor: pointer;
    vertical-align: baseline;
  }
  .doc :global(.page-link[data-kind="board"]) { background: var(--tint-2); }
  .doc :global(.page-link[data-kind="table"]) { background: var(--tint-3); }
  .doc :global(.page-link[data-kind="folder"]) { background: var(--tint-4); }
  .doc :global(.page-link.gone) {
    background: var(--surface-2);
    color: var(--text-muted);
    border-style: dashed;
    cursor: default;
  }
  .doc :global(.page-link:hover:not(.gone)) { box-shadow: var(--lift); }
  .doc :global(.ProseMirror-selectednode.page-link) { box-shadow: var(--lift); }

  /* Isi dokumen (elemen dibuat Tiptap, jadi aturannya global di bawah .doc). */
  .doc :global(.tiptap) {
    outline: none;
    min-height: 50vh;
    padding-bottom: 30vh;
    line-height: 1.7;
    font-size: 1.05em;
  }
  .doc :global(.tiptap > * + *) {
    margin-top: 0.6em;
  }
  /* Sumber catatan hasil simpan dari ekstensi: kecil dan redup, isi sorotan tetap teks biasa. */
  .doc :global(.tiptap p:has(> a.src)),
  .doc :global(.tiptap p:has(> a.src-part)) {
    font-size: 0.8em;
    margin: 0.2em 0 0.8em;
  }
  .doc :global(.tiptap a.src),
  .doc :global(.tiptap a.src-part) {
    color: var(--text-muted);
    text-decoration: none;
    overflow-wrap: anywhere; /* alamat panjang ditulis sebagai teks: boleh patah di mana saja */
  }
  .doc :global(.tiptap a.src:hover),
  .doc :global(.tiptap a.src-part:hover) {
    color: var(--link);
    text-decoration: underline;
  }
  /* Catatan melayang dibuat ringkas: tautan ke bagian sorotan hanya ada di app utama. */
  :global(html.sticky-mode) .doc :global(.tiptap p:has(> a.src-part)) {
    display: none;
  }
  .doc :global(.tiptap h1) {
    font-size: 1.8em;
    margin-top: 1.1em;
  }
  .doc :global(.tiptap h2) {
    font-size: 1.4em;
    margin-top: 1em;
  }
  .doc :global(.tiptap h3) {
    font-size: 1.15em;
    margin-top: 0.9em;
  }
  .doc :global(.tiptap ul),
  .doc :global(.tiptap ol) {
    padding-left: 1.5em;
  }
  .doc :global(.tiptap ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 0.2em;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li) {
    display: flex;
    gap: 0.5em;
    align-items: flex-start;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li > label) {
    flex: none;
    display: flex;
    align-items: center;
    height: 1lh;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li > label input) {
    border: var(--edge-w) solid var(--edge);
  }
  .doc :global(.tiptap ul[data-type="taskList"] li[data-checked="true"] > label input) {
    background: var(--kind-table);
    border-color: var(--edge);
  }
  .doc :global(.tiptap ul[data-type="taskList"] li > div > p),
  .doc :global(.tiptap li > p) {
    margin: 0;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li) {
    margin-top: 0.2em;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li > div) {
    flex: 1;
  }
  .doc :global(.tiptap ul[data-type="taskList"] li[data-checked="true"] > label input) {
    animation: tick var(--dur-2) var(--ease-spring);
  }
  .doc :global(.tiptap ul[data-type="taskList"] li[data-checked="true"] > div) {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .doc :global(.tiptap blockquote) {
    margin-left: 0;
    padding-left: 1em;
    border-left: 3px solid var(--border);
    color: var(--text-muted);
  }
  .doc :global(.tiptap pre) {
    padding: var(--space-3);
    background: var(--surface-2);
    border-radius: var(--radius);
    overflow-x: auto;
    font-family: var(--font-mono);
  }
  .doc :global(.tiptap code) {
    padding: 1px 5px;
    background: var(--surface-2);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.92em;
  }
  .doc :global(.tiptap pre code) {
    padding: 0;
    background: none;
  }
  .doc :global(.tiptap mark) {
    padding: 0 2px;
    border-radius: 3px;
    color: inherit;
  }
  .doc :global(.tiptap u) {
    text-underline-offset: 2px;
  }
  .doc :global(.tiptap .tableWrapper) {
    overflow-x: auto;
  }
  .doc :global(.tiptap table) {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    margin: 0.8em 0;
  }
  .doc :global(.tiptap th),
  .doc :global(.tiptap td) {
    position: relative;
    min-width: 3em;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    vertical-align: top;
    text-align: left;
  }
  .doc :global(.tiptap th) {
    background: var(--surface-2);
    font-weight: 600;
  }
  .doc :global(.tiptap td > p),
  .doc :global(.tiptap th > p) {
    margin: 0;
  }
  .doc :global(.tiptap .selectedCell::after) {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--accent-soft);
    opacity: 0.6;
    pointer-events: none;
  }
  .doc :global(.tiptap hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.2em 0;
  }
  .doc :global(.tiptap p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-muted);
    pointer-events: none;
  }
  .slash {
    position: fixed;
    z-index: 70;
    width: 260px;
    max-height: 320px;
    overflow: auto;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    animation: pop var(--dur-2) var(--ease-out) both;
    transform-origin: top left;
  }
  .slash button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: auto;
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    cursor: pointer;
  }
  .slash button.on {
    background: var(--accent-soft);
  }
  .slash .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--link);
    flex: none;
  }
  .slash b {
    display: block;
    font-weight: 600;
  }
  .slash small {
    display: block;
    color: var(--text-muted);
  }
</style>
