<script lang="ts">
  import { onMount } from "svelte";
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
    AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Heading1, Heading2, Heading3, Highlighter, IndentDecrease,
    IndentIncrease, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Minus, Quote, Redo2, RemoveFormatting,
    Strikethrough, Subscript as SubIcon, Superscript as SupIcon, Table as TableIcon, Underline as UnderlineIcon, Undo2,
  } from "@lucide/svelte";
  import Select from "$lib/ui/Select.svelte";
  import ColorPicker from "$lib/ui/ColorPicker.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";

  let { content, onchange, spellcheck = true, toolbar = true }: { content: string; onchange: (json: string, plain: string) => void; spellcheck?: boolean; toolbar?: boolean } = $props();

  let element: HTMLDivElement;
  let editor = $state.raw<Editor>();
  // Naik setiap transaksi supaya status tombol (tebal, daftar, dan lainnya) ikut diperbarui.
  let tick = $state(0);

  // Menu "/": ketik "/" di awal baris atau setelah spasi untuk menyisipkan blok.
  type SlashItem = { label: string; hint: string; keys: string; icon: typeof Bold; run: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]> };
  const SLASH: SlashItem[] = [
    { label: "Judul besar", hint: "Judul bagian utama", keys: "judul heading h1 besar", icon: Heading1, run: (c) => c.toggleHeading({ level: 1 }) },
    { label: "Judul", hint: "Judul bagian", keys: "judul heading h2", icon: Heading2, run: (c) => c.toggleHeading({ level: 2 }) },
    { label: "Sub judul", hint: "Judul kecil", keys: "sub judul heading h3", icon: Heading3, run: (c) => c.toggleHeading({ level: 3 }) },
    { label: "Daftar poin", hint: "Daftar dengan titik", keys: "daftar poin bullet list", icon: List, run: (c) => c.toggleBulletList() },
    { label: "Daftar bernomor", hint: "Daftar 1, 2, 3", keys: "daftar nomor numbered urut", icon: ListOrdered, run: (c) => c.toggleOrderedList() },
    { label: "Daftar centang", hint: "Tugas yang bisa dicentang", keys: "centang tugas todo task checklist", icon: ListChecks, run: (c) => c.toggleTaskList() },
    { label: "Kutipan", hint: "Teks kutipan", keys: "kutipan quote", icon: Quote, run: (c) => c.toggleBlockquote() },
    { label: "Blok kode", hint: "Kode berhuruf tetap", keys: "kode code blok", icon: Code, run: (c) => c.toggleCodeBlock() },
    { label: "Garis pemisah", hint: "Garis mendatar", keys: "garis pemisah divider hr", icon: Minus, run: (c) => c.setHorizontalRule() },
    { label: "Tabel", hint: "Tabel 3 × 3", keys: "tabel table kolom baris", icon: TableIcon, run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  ];
  let slash = $state<{ from: number; to: number; query: string; x: number; y: number } | null>(null);
  let slashIndex = $state(0);
  const slashItems = $derived(
    slash ? SLASH.filter((i) => `${i.label} ${i.keys}`.toLowerCase().includes(slash!.query.toLowerCase())) : [],
  );

  function updateSlash(e: Editor) {
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

  const editorProps = () => ({ attributes: { spellcheck: String(spellcheck) }, handleKeyDown: (_view: unknown, event: KeyboardEvent) => slashKey(event) });

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
        Placeholder.configure({ placeholder: "Tulis sesuatu di sini…" }),
      ],
      content: parse(content),
      editorProps: editorProps(),
      onTransaction: ({ editor: e }) => {
        tick++;
        updateSlash(e);
      },
      onBlur: () => (slash = null),
      onUpdate: ({ editor: e }) => onchange(JSON.stringify(e.getJSON()), e.getText({ blockSeparator: "\n" })),
    });
    editor = instance;
    return () => instance.destroy();
  });

  $effect(() => {
    void spellcheck;
    editor?.setOptions({ editorProps: editorProps() });
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
  const BLOCKS = [
    { value: "p", label: "Paragraf" },
    { value: "h1", label: "Judul 1" },
    { value: "h2", label: "Judul 2" },
    { value: "h3", label: "Judul 3" },
  ];
  const FONTS = [
    { value: "", label: "Bawaan" },
    { value: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", label: "Sans" },
    { value: "ui-serif, Georgia, 'Times New Roman', serif", label: "Serif" },
    { value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", label: "Mono" },
    { value: "'Comic Sans MS', 'Chalkboard SE', cursive", label: "Santai" },
  ];
  const SIZES = ["", "10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px"].map((v) => ({ value: v, label: v ? v.replace("px", "") : "Ukuran" }));
  const LINES = [
    { value: "", label: "Jarak baris" },
    { value: "1", label: "1,0" },
    { value: "1.15", label: "1,15" },
    { value: "1.5", label: "1,5" },
    { value: "2", label: "2,0" },
    { value: "2.5", label: "2,5" },
  ];
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
    const input = await dialog.prompt("Alamat tautan (kosongkan untuk melepas):", prev || "https://", { okLabel: "Pasang" });
    if (input === null) return;
    const href = input.trim();
    const chain = editor.chain().focus();
    if (!href || href === "https://") return void chain.extendMarkRange("link").unsetLink().run();
    const full = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
    if (from === to && !editor.isActive("link")) chain.insertContent({ type: "text", text: full, marks: [{ type: "link", attrs: { href: full } }] }).run();
    else chain.extendMarkRange("link").setLink({ href: full }).run();
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
  <button title="Urungkan (⌘Z)" aria-label="Urungkan" onclick={() => run((c) => c.undo())}><Undo2 size={16} /></button>
  <button title="Ulangi (⇧⌘Z)" aria-label="Ulangi" onclick={() => run((c) => c.redo())}><Redo2 size={16} /></button>
  <button title="Hapus format" aria-label="Hapus format" onclick={() => run((c) => c.unsetAllMarks().clearNodes().unsetTextAlign())}><RemoveFormatting size={16} /></button>
  <span class="sep"></span>
  <div class="dd w-block"><Select class="tb-sel" value={blockStyle} options={BLOCKS} label="Gaya paragraf" onchange={setBlock} /></div>
  <div class="dd w-font"><Select class="tb-sel" value={attr("textStyle", "fontFamily")} options={FONTS} label="Jenis huruf" onchange={setFont} /></div>
  <div class="dd w-size"><Select class="tb-sel" value={attr("textStyle", "fontSize")} options={SIZES} label="Ukuran huruf" onchange={setSize} /></div>
  <span class="sep"></span>
  <button class:on={active("bold")} title="Tebal (⌘B)" aria-label="Tebal" onclick={() => run((c) => c.toggleBold())}><Bold size={16} /></button>
  <button class:on={active("italic")} title="Miring (⌘I)" aria-label="Miring" onclick={() => run((c) => c.toggleItalic())}><Italic size={16} /></button>
  <button class:on={active("underline")} title="Garis bawah (⌘U)" aria-label="Garis bawah" onclick={() => run((c) => c.toggleUnderline())}><UnderlineIcon size={16} /></button>
  <button class:on={active("strike")} title="Coret" aria-label="Coret" onclick={() => run((c) => c.toggleStrike())}><Strikethrough size={16} /></button>
  <button class:on={active("subscript")} title="Subskrip" aria-label="Subskrip" onclick={() => run((c) => c.toggleSubscript())}><SubIcon size={16} /></button>
  <button class:on={active("superscript")} title="Superskrip" aria-label="Superskrip" onclick={() => run((c) => c.toggleSuperscript())}><SupIcon size={16} /></button>
  <button class:on={active("code")} title="Kode sebaris" aria-label="Kode sebaris" onclick={() => run((c) => c.toggleCode())}><Code size={16} /></button>
  <ColorPicker
    class="tb-ico"
    label="Warna teks"
    value={attr("textStyle", "color") || "#7e6cf0"}
    onchange={(v) => run((c) => c.setColor(v))}
    onclear={() => run((c) => c.unsetColor())}
  >
    <span class="aa" style:--c={attr("textStyle", "color") || "var(--text-muted)"}>A</span>
  </ColorPicker>
  <ColorPicker
    class="tb-ico"
    label="Warna sorot"
    value={attr("highlight", "color") || "#ffe066"}
    onchange={(v) => run((c) => c.setHighlight({ color: v }))}
    onclear={() => run((c) => c.unsetHighlight())}
  >
    <Highlighter size={16} />
  </ColorPicker>
  <span class="sep"></span>
  <button class:on={active("link")} title="Tautan" aria-label="Tautan" onclick={setLink}><LinkIcon size={16} /></button>
  <button class:on={aligned("left")} title="Rata kiri" aria-label="Rata kiri" onclick={() => run((c) => c.setTextAlign("left"))}><AlignLeft size={16} /></button>
  <button class:on={aligned("center")} title="Rata tengah" aria-label="Rata tengah" onclick={() => run((c) => c.setTextAlign("center"))}><AlignCenter size={16} /></button>
  <button class:on={aligned("right")} title="Rata kanan" aria-label="Rata kanan" onclick={() => run((c) => c.setTextAlign("right"))}><AlignRight size={16} /></button>
  <button class:on={aligned("justify")} title="Rata kiri-kanan" aria-label="Rata kiri-kanan" onclick={() => run((c) => c.setTextAlign("justify"))}><AlignJustify size={16} /></button>
  <div class="dd w-line"><Select class="tb-sel" value={attr("textStyle", "lineHeight")} options={LINES} label="Jarak baris" onchange={setLine} /></div>
  <span class="sep"></span>
  <button class:on={active("bulletList")} title="Daftar poin" aria-label="Daftar poin" onclick={() => run((c) => c.toggleBulletList())}><List size={16} /></button>
  <button class:on={active("orderedList")} title="Daftar bernomor" aria-label="Daftar bernomor" onclick={() => run((c) => c.toggleOrderedList())}><ListOrdered size={16} /></button>
  <button class:on={active("taskList")} title="Daftar centang" aria-label="Daftar centang" onclick={() => run((c) => c.toggleTaskList())}><ListChecks size={16} /></button>
  <button disabled={!canList} title="Kurangi lekukan" aria-label="Kurangi lekukan" onclick={() => indent(-1)}><IndentDecrease size={16} /></button>
  <button disabled={!canList} title="Tambah lekukan" aria-label="Tambah lekukan" onclick={() => indent(1)}><IndentIncrease size={16} /></button>
  <span class="sep"></span>
  <button class:on={active("blockquote")} title="Kutipan" aria-label="Kutipan" onclick={() => run((c) => c.toggleBlockquote())}><Quote size={16} /></button>
  <button class:on={active("codeBlock")} title="Blok kode" aria-label="Blok kode" onclick={() => run((c) => c.toggleCodeBlock())}><Code size={16} /></button>
  <button title="Tabel" aria-label="Sisipkan tabel" onclick={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><TableIcon size={16} /></button>
  <button title="Garis pemisah" aria-label="Garis pemisah" onclick={() => run((c) => c.setHorizontalRule())}><Minus size={16} /></button>
</div>
{#if inTable}
  <div class="bar tbl" role="toolbar" aria-label="Tabel">
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
<div class="doc" bind:this={element} onclickcapture={openLink}></div>

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
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    padding: 4px 0 var(--space-3);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg);
  }
  button {
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    padding: 0;
    border: none;
    background: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  button.on {
    background: var(--accent);
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
    padding-top: 0;
    margin-top: calc(-1 * var(--space-3));
  }
  .dd {
    flex: none;
  }
  .dd.w-block { width: 104px; }
  .dd.w-font { width: 92px; }
  .dd.w-size { width: 82px; }
  .dd.w-line { width: 112px; }
  .dd :global(.tb-sel) {
    padding: 3px 8px;
    font-size: 0.88em;
    background: transparent;
    border-color: transparent;
  }
  .dd :global(.tb-sel:hover:not(:disabled)) {
    background: var(--surface-2);
  }
  .bar :global(.tb-ico) {
    width: 2em;
    height: 2em;
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: none;
    color: var(--text-muted);
  }
  .bar :global(.tb-ico:hover:not(:disabled)) {
    background: var(--surface-2);
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
    margin-top: 0.42em;
    display: flex;
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
