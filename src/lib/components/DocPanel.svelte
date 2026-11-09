<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { History, ListTree, MessageSquare, RotateCcw, X } from "@lucide/svelte";
  import type { Editor } from "@tiptap/core";
  import { commentsOf, headingsOf } from "$lib/editor/docstats";
  import { parseDoc, toMarkdown } from "$lib/editor/markdown";
  import { workspace } from "$lib/workspace/api";
  import type { PageVersion, PageVersionInfo } from "$lib/workspace/types";
  import { dialog } from "$lib/stores/dialog.svelte";

  // Panel samping dokumen: daftar isi, komentar pada teks, dan riwayat versi. Hidup di dalam Editor supaya langsung
  // memakai instance editornya; semua data berasal dari dokumen itu sendiri (kecuali riwayat versi, dari database lokal).
  let {
    editor,
    tick,
    pageId,
    tab = $bindable("outline"),
    draft = $bindable(null),
    onclose,
  }: {
    editor: Editor;
    tick: number;
    pageId: string;
    tab?: "outline" | "comments" | "history";
    draft?: { from: number; to: number } | null;
    onclose: () => void;
  } = $props();

  const headings = $derived.by(() => {
    void tick;
    return headingsOf(editor.state.doc);
  });
  const comments = $derived.by(() => {
    void tick;
    return commentsOf(editor.state.doc);
  });
  const minLevel = $derived(headings.length ? Math.min(...headings.map((h) => h.level)) : 1);

  function scrollTo(pos: number) {
    const node = editor.view.nodeDOM(pos) ?? editor.view.domAtPos(pos).node;
    const el = node instanceof HTMLElement ? node : node.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function jumpComment(c: { from: number; quote: string }) {
    scrollTo(c.from);
    editor.commands.setTextSelection({ from: c.from, to: c.from + c.quote.length });
  }

  let text = $state("");
  function addComment() {
    const value = text.trim();
    if (!draft || !value) return;
    const { from, to } = draft;
    editor.chain().setTextSelection({ from, to }).setComment({ id: crypto.randomUUID(), text: value.slice(0, 500), at: new Date().toISOString() }).run();
    text = "";
    draft = null;
  }
  const cancelDraft = () => {
    text = "";
    draft = null;
  };

  const when = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? "" : new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  // ── Riwayat versi ──
  let versions = $state<PageVersionInfo[]>([]);
  let picked = $state<PageVersion | null>(null);
  let busy = $state(false);
  let failed = $state(false);

  async function loadVersions() {
    try {
      versions = await workspace.pages.versions(pageId);
      failed = false;
    } catch {
      versions = [];
      failed = true;
    }
  }

  $effect(() => {
    if (tab === "history") void loadVersions();
    else picked = null;
  });

  async function pick(v: PageVersionInfo) {
    try {
      picked = await workspace.pages.version(v.id);
    } catch {
      picked = null;
    }
  }

  const preview = $derived(picked ? toMarkdown(picked.content).slice(0, 1200) : "");

  async function restore() {
    if (!picked || busy) return;
    const ok = await dialog.confirm(tr("Pulihkan versi ini? Isi dokumen sekarang disimpan dulu sebagai versi, jadi bisa kamu kembalikan lagi.", "Restore this version? The current content is saved as a version first, so you can switch back."), { okLabel: tr("Pulihkan", "Restore") });
    if (!ok) return;
    busy = true;
    try {
      await workspace.pages.versionAdd(pageId, "", JSON.stringify(editor.getJSON()));
      const doc = parseDoc(picked.content);
      editor.commands.setContent(doc as object, { emitUpdate: true });
      picked = null;
      await loadVersions();
    } finally {
      busy = false;
    }
  }
</script>

<aside class="panel" data-noprint aria-label={tr("Panel dokumen", "Document panel")}>
  <header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "outline"} class:on={tab === "outline"} onclick={() => (tab = "outline")}><ListTree size={14} /> {tr("Daftar isi", "Outline")}</button>
      <button role="tab" aria-selected={tab === "comments"} class:on={tab === "comments"} onclick={() => (tab = "comments")}><MessageSquare size={14} /> {tr("Komentar", "Comments")}{#if comments.length}<span class="n">{comments.length}</span>{/if}</button>
      <button role="tab" aria-selected={tab === "history"} class:on={tab === "history"} onclick={() => (tab = "history")}><History size={14} /> {tr("Riwayat", "History")}</button>
    </div>
    <button class="x" aria-label={tr("Tutup panel", "Close panel")} onclick={onclose}><X size={16} /></button>
  </header>

  {#if tab === "outline"}
    {#if headings.length}
      <ul class="outline">
        {#each headings as h (h.pos)}
          <li><button style:padding-left="calc(var(--space-2) + {(h.level - minLevel) * 12}px)" onclick={() => scrollTo(h.pos)}>{h.text}</button></li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{tr("Belum ada judul. Beri judul bagian (Judul 1 sampai 6) supaya daftar isi muncul di sini.", "No headings yet. Add section headings (Heading 1 to 6) and the outline appears here.")}</p>
    {/if}
  {:else if tab === "comments"}
    {#if draft}
      <div class="draft">
        <p class="muted">{tr("Komentar untuk teks yang dipilih:", "Comment on the selected text:")}</p>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea bind:value={text} rows="3" maxlength="500" placeholder={tr("Tulis komentar…", "Write a comment…")} autofocus onkeydown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addComment(); }}></textarea>
        <div class="acts"><button class="btn primary" disabled={!text.trim()} onclick={addComment}>{tr("Tambah", "Add")}</button><button class="btn" onclick={cancelDraft}>{tr("Batal", "Cancel")}</button></div>
      </div>
    {/if}
    {#if comments.length}
      <ul class="comments">
        {#each comments as c (c.id)}
          <li>
            <button class="quote" onclick={() => jumpComment(c)} title={tr("Lompat ke teks", "Jump to the text")}>“{c.quote.length > 80 ? c.quote.slice(0, 80) + "…" : c.quote}”</button>
            <p>{c.text}</p>
            <div class="meta"><span class="muted">{when(c.at)}</span><button class="link" onclick={() => editor.commands.removeComment(c.id)}>{tr("Selesai", "Resolve")}</button></div>
          </li>
        {/each}
      </ul>
    {:else if !draft}
      <p class="muted">{tr("Belum ada komentar. Pilih teks, lalu klik tombol Komentar di bilah alat.", "No comments yet. Select some text, then click the Comment button in the toolbar.")}</p>
    {/if}
  {:else}
    {#if failed}
      <p class="muted">{tr("Riwayat versi hanya tersedia di aplikasi Cognify.", "Version history is only available in the Cognify app.")}</p>
    {:else if versions.length === 0}
      <p class="muted">{tr("Belum ada versi tersimpan. Versi dibuat otomatis saat kamu mengedit, paling sering tiap 10 menit.", "No saved versions yet. Versions are created automatically while you edit, at most every 10 minutes.")}</p>
    {:else}
      <ul class="versions">
        {#each versions as v (v.id)}
          <li><button class:on={picked?.id === v.id} onclick={() => pick(v)}><span>{when(v.createdAt)}</span><small class="muted">{Math.max(1, Math.round(v.size / 1000))} KB</small></button></li>
        {/each}
      </ul>
      {#if picked}
        <pre class="prev">{preview}</pre>
        <button class="btn primary" disabled={busy} onclick={restore}><RotateCcw size={14} /> {tr("Pulihkan versi ini", "Restore this version")}</button>
      {/if}
    {/if}
  {/if}
</aside>

<style>
  .panel { position: fixed; top: var(--space-5); right: var(--space-3); bottom: var(--space-3); z-index: 30; width: 330px; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); overflow-y: auto; background: var(--surface); border: var(--edge-w) solid var(--edge); border-radius: var(--radius-3); box-shadow: var(--lift); }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); }
  .tabs { display: flex; gap: var(--space-0); background: var(--surface-2); border-radius: var(--radius-pill); padding: var(--space-0); }
  .tabs button { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-pill); background: none; color: var(--text-muted); font-size: 0.82em; font-weight: 600; white-space: nowrap; cursor: pointer; }
  .tabs button.on { background: var(--accent-soft); color: var(--link); }
  .n { padding: 0 var(--space-1); border-radius: var(--radius-pill); background: var(--accent-strong); color: var(--accent-contrast); font-size: 0.85em; }
  .x { display: grid; place-items: center; padding: var(--space-1); border: 0; border-radius: var(--radius-1); background: none; color: var(--text-muted); cursor: pointer; }
  .x:hover { background: var(--surface-2); color: var(--text); }
  .muted { color: var(--text-muted); font-size: 0.88em; margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-0); }
  .outline button { width: 100%; text-align: left; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-1); background: none; color: var(--text); font-size: 0.92em; cursor: pointer; }
  .outline button:hover, .versions button:hover { background: var(--surface-2); }
  .comments { gap: var(--space-2); }
  .comments li { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-2); }
  .quote { text-align: left; border: 0; background: none; padding: 0; color: var(--text-muted); font-size: 0.82em; font-style: italic; cursor: pointer; }
  .comments p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.8em; }
  .link { border: 0; background: none; padding: 0; color: var(--link); font-size: inherit; cursor: pointer; }
  .draft { display: grid; gap: var(--space-2); padding: var(--space-2); border-radius: var(--radius-2); background: var(--accent-soft); }
  .draft textarea { width: 100%; resize: vertical; padding: var(--space-2); border: 1px solid var(--border-strong); border-radius: var(--radius-1); background: var(--surface); color: var(--text); font: inherit; }
  .acts { display: flex; gap: var(--space-2); }
  .versions button { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-1); background: none; color: var(--text); font-size: 0.9em; cursor: pointer; }
  .versions button.on { background: var(--accent-soft); }
  .prev { margin: 0; max-height: 220px; overflow: auto; padding: var(--space-2); border-radius: var(--radius-2); background: var(--surface-2); font-family: var(--font-mono); font-size: 0.78em; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 900px) { .panel { width: min(330px, calc(100vw - var(--space-4))); } }
</style>
