<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import { onDestroy } from "svelte";
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { Download, Lock, LockOpen, Quote, Star, StickyNote, Trash2 } from "@lucide/svelte";
  import CitePanel from "$lib/components/CitePanel.svelte";
  import FolderView from "$lib/components/FolderView.svelte";
  import { kindLabel, kindIcon } from "$lib/workspace/kinds";
  import Board from "$lib/components/Board.svelte";
  import NoteArrows from "$lib/components/NoteArrows.svelte";
  import DocNotes from "$lib/components/DocNotes.svelte";
  import { newNote, readLocked, readNotes, withNotes, type DocNote } from "$lib/workspace/docNotes";
  import Editor from "$lib/components/Editor.svelte";
  import TableEditor from "$lib/table/TableEditor.svelte";
  import TagEditor from "$lib/components/TagEditor.svelte";
  import { createBroadcaster, onRemoteChange } from "$lib/pageSync";
  import { createAutosave } from "$lib/autosave";
  import { pickSavePath } from "$lib/savePath";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { workspace } from "$lib/workspace/api";
  import type { Page, PageUpdate } from "$lib/workspace/types";

  const id = $derived(route.params.id ?? "");

  let current = $state<Page | null>(null);
  let missing = $state(false);
  let status = $state<"saved" | "saving" | "error">("saved");
  let board = $state<{ exportPng(): Promise<Blob>; exportSvg(): Promise<string> }>();
  let notice = $state<string | null>(null);
  let docEditor = $state<{ setRemote(json: string): void; unlinkNote(noteId: string): void }>();
  const sync = createBroadcaster(() => id);

  // Penyimpanan otomatis: satu per satu, dicoba ulang bila gagal, dan segera saat jendela ditinggalkan.
  let pendingId = "";
  const saver = createAutosave<PageUpdate & { pageId: string }>(
    async ({ pageId, ...patch }) => {
      await workspace.pages.update(pageId, patch);
      if (patch.tags) void ws.refreshTags();
    },
    (state) => (status = state),
  );

  function queue(patch: PageUpdate) {
    // Halaman lain yang masih antre disimpan dulu supaya tidak tercampur.
    if (pendingId && pendingId !== id) void saver.flush();
    pendingId = id;
    sync.push({ content: patch.content, title: patch.title });
    saver.push({ ...patch, pageId: id });
  }

  const flush = () => saver.flush();

  $effect(() => {
    const target = id;
    current = null;
    missing = false;
    status = "saved";
    // Tunggu simpanan yang masih jalan, supaya halaman yang baru ditinggalkan dibaca versi terbarunya.
    saver.flush()
      .then(() => workspace.pages.get(target))
      .then((p) => {
        if (target === id) current = p;
      })
      .catch(() => {
        if (target === id) missing = true;
      });
    return () => void flush();
  });

  onDestroy(() => {
    saver.dispose();
    sync.flush();
  });

  // Perubahan dari jendela lain (catatan melayang) langsung tampil di sini. Bila ada ketikan lokal yang
  // belum tersimpan, yang lokal dipertahankan.
  $effect(() =>
    onRemoteChange((c) => {
      if (c.id !== id || !current || saver.dirty()) return;
      if (c.title !== undefined && c.title !== current.title) current.title = c.title;
      if (c.content !== undefined && current.kind === "doc") {
        current.content = c.content;
        docEditor?.setRemote(c.content);
      }
    }),
  );

  function setTitle(title: string) {
    if (current) current.title = title;
    queue({ title });
    ws.patch(id, { title });
  }

  function onTitle(event: Event) {
    setTitle((event.currentTarget as HTMLInputElement).value);
  }

  // Catatan melayang milik dokumen ini; tersimpan di JSON dokumennya.
  let notes = $state<DocNote[]>([]);
  let locked = $state(false);
  let stage = $state<HTMLDivElement>();
  let lastJson = "";
  $effect(() => {
    if (current?.kind === "doc") {
      notes = readNotes(current.content);
      locked = readLocked(current.content);
      lastJson = current.content;
    } else notes = [];
  });

  function saveDoc(json: string, plain: string) {
    lastJson = json;
    queue({ content: withNotes(json, notes, locked), plainText: plain });
  }

  function setNotes(next: DocNote[]) {
    // Catatan yang dihapus: teks yang tadinya dihubungkan ke sana tidak lagi disorot.
    for (const gone of notes.filter((o) => !next.some((n) => n.id === o.id))) docEditor?.unlinkNote(gone.id);
    notes = next;
    if (!current) return;
    const content = withNotes(lastJson || current.content || '{"type":"doc","content":[]}', next, locked);
    current.content = content;
    queue({ content });
  }

  function toggleLock() {
    locked = !locked;
    if (!current) return;
    const content = withNotes(lastJson || current.content || '{"type":"doc","content":[]}', notes, locked);
    current.content = content;
    queue({ content });
  }

  function addNote(): string {
    const note = newNote(notes.length, stage?.clientWidth ?? 780);
    setNotes([...notes, note]);
    return note.id;
  }

  const noteLabel = (n: DocNote, i: number) => {
    const text = (n.title || n.text).trim().replace(/\s+/g, " ");
    return text ? `«${text.length > 22 ? text.slice(0, 22) + "…" : text}»` : `catatan ${i + 1}`;
  };
  const noteChoices = $derived(notes.map((n, i) => ({ id: n.id, label: noteLabel(n, i) })));

  // Halaman lain yang menautkan ke halaman ini (dibaca dari isi dokumen mereka).
  let backlinks = $state<{ id: string; title: string; kind: string }[]>([]);
  $effect(() => {
    const target = id;
    const kind = current?.kind;
    backlinks = [];
    if (kind === undefined) return;
    const needle = `"id":"${target}"`;
    const docs = ws.nodes.filter((n) => n.kind === "doc" && n.id !== target);
    Promise.all(docs.map((n) => workspace.pages.get(n.id).catch(() => null))).then((pages) => {
      if (target !== id) return;
      backlinks = pages
        .filter((p): p is Page => !!p && p.content.includes('"pageLink"') && p.content.includes(needle))
        .map((p) => ({ id: p.id, title: p.title || tr("Tanpa judul", "Untitled"), kind: p.kind }));
    });
  });

  let citeOpen = $state(false);
  $effect(() => {
    id; // pindah halaman menutup panel
    citeOpen = false;
  });

  async function favorite() {
    if (!current) return;
    const next = !current.favorite;
    current.favorite = next;
    await ws.setFavorite(id, next);
  }

  const toBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  async function exportBoard(format: "png" | "svg") {
    if (!board || !current) return;
    notice = null;
    const base = (current.title || "papan").replace(/[\\/:*?"<>|]+/g, " ").trim() || "papan";
    const path = await pickSavePath(`${base}.${format}`, { name: format.toUpperCase(), extensions: [format] });
    if (!path) return;
    try {
      if (!isTauri()) throw new Error(tr("Simpan gambar hanya tersedia di aplikasi Cognify.", "Saving images is only available in the Cognify app."));
      if (format === "png") await invoke("write_base64_file", { path, data: await toBase64(await board.exportPng()) });
      else await invoke("write_text_file", { path, content: await board.exportSvg() });
      notice = tr(`Gambar disimpan di ${path}`, `Image saved to ${path}`);
    } catch (e) {
      notice = typeof e === "string" ? e : e instanceof Error ? e.message : tr("Gambar gagal disimpan.", "The image could not be saved.");
    }
  }

  async function remove() {
    await flush();
    await ws.trash(id);
    await goto("/");
  }
  const HeaderIcon = $derived(kindIcon(current?.kind ?? "doc"));
</script>

{#if missing}
  <div class="msg">
    <h1>{tr("Halaman tidak ditemukan", "Page not found")}</h1>
    <p>{tr("Mungkin sudah dibuang ke sampah atau dihapus.", "It may have been moved to the trash or deleted.")}</p>
    <a href="/">{tr("Kembali ke Beranda", "Back to Home")}</a>
  </div>
{:else if current}
  <div class="stage" bind:this={stage}>
  {#if current.kind === "doc"}<NoteArrows {notes} {stage} />{/if}
  <div class="page" class:wide={current.kind === "board" || current.kind === "table"}>
    <header>
      <span class="kind">
        <HeaderIcon size={15} /> {kindLabel(current.kind)}
      </span>
      <span class="state" class:err={status === "error"}>
        {status === "saving" ? tr("Menyimpan…", "Saving…") : status === "error" ? tr("Gagal menyimpan", "Save failed") : tr("Tersimpan", "Saved")}
      </span>
      {#if current.kind === "board"}
        <button class="icon" aria-label={tr("Simpan gambar PNG", "Save as PNG image")} title={tr("Simpan gambar PNG", "Save as PNG image")} onclick={() => exportBoard("png")}><Download size={16} /></button>
      {/if}
      {#if current.kind === "doc"}
        <button class="icon" aria-label={tr("Catatan melayang", "Floating notes")} title={tr("Tambah catatan melayang", "Add a floating note")} onclick={addNote}><StickyNote size={16} /></button>
        <button class="icon" class:on={locked} aria-label={locked ? tr("Buka kunci objek", "Unlock objects") : tr("Kunci objek", "Lock objects")} title={locked ? tr("Objek terkunci: blok dan catatan tidak bisa bergeser. Klik untuk membuka.", "Objects locked: blocks and notes cannot move. Click to unlock.") : tr("Kunci objek supaya tidak tergeser tanpa sengaja", "Lock objects so they do not move by accident")} onclick={toggleLock}>{#if locked}<Lock size={16} />{:else}<LockOpen size={16} />{/if}</button>
        <button class="icon" aria-label={tr("Kutip", "Cite")} title={tr("Kutip", "Cite")} onclick={() => (citeOpen = true)}><Quote size={16} /></button>
      {/if}
      <button class="icon" class:on={current.favorite} aria-label={current.favorite ? tr("Hapus dari favorit", "Remove from favorites") : tr("Jadikan favorit", "Add to favorites")} title={tr("Favorit", "Favorite")} onclick={favorite}><Star size={16} /></button>
      <button class="icon" aria-label={tr("Buang ke sampah", "Move to trash")} title={tr("Buang ke sampah", "Move to trash")} onclick={remove}><Trash2 size={16} /></button>
    </header>

    <input class="title" value={current.title} placeholder={tr("Tanpa judul", "Untitled")} aria-label={tr("Judul halaman", "Page title")} oninput={onTitle} />

    {#if current.kind !== "folder"}
    <TagEditor tags={current.tags} onchange={(tags) => { if (current) current.tags = tags; queue({ tags }); }} />
    {/if}

    {#if notice}<p class="notice">{notice}</p>{/if}

    {#if current.kind === "board"}
      {#key current.id}
        <Board bind:this={board} viewKey="cognify.board.view.{current.id}" content={current.content} onchange={(json, plain) => queue({ content: json, plainText: plain })} />
      {/key}
    {:else if current.kind === "folder"}
      {#key current.id}
        <FolderView id={current.id} />
      {/key}
    {:else if current.kind === "doc"}
      {#key current.id}
        <Editor bind:this={docEditor} {locked} pageId={current.id} noteLinks={{ notes: noteChoices, create: addNote }} content={current.content} spellcheck={prefs.value.spellcheck} onchange={saveDoc} />
      {/key}
    {:else}
      {#key current.id}
        <TableEditor content={current.content} onchange={(json, plain) => queue({ content: json, plainText: plain })} />
      {/key}
    {/if}
  </div>
  {#if current.kind === "doc" && backlinks.length}
    <section class="back">
      <h2>{tr("Tertaut dari", "Linked from")}</h2>
      <div>
        {#each backlinks as b (b.id)}
          <a href="/p/{b.id}">{b.title}</a>
        {/each}
      </div>
    </section>
  {/if}
  {#if current.kind === "doc"}<DocNotes {notes} {locked} onchange={setNotes} />{/if}
  </div>
{/if}

{#if citeOpen && current}
  <CitePanel pageId={current.id} title={current.title} onTitle={setTitle} onClose={() => (citeOpen = false)} />
{/if}

<style>
  .stage {
    position: relative;
    min-height: 100%;
  }
  .page {
    position: relative;
    z-index: 1;
    max-width: 780px;
    margin: 0 auto;
  }
  .page.wide {
    max-width: none;
  }
  .back {
    max-width: 780px;
    margin: var(--space-8) auto 0;
    padding-top: var(--space-4);
    border-top: var(--edge-w) solid var(--edge);
  }
  .back h2 {
    margin-bottom: var(--space-2);
    color: var(--text-muted);
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .back div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .back a {
    padding: 2px 10px;
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--text);
    font-size: 0.9em;
    font-weight: 600;
    text-decoration: none;
  }
  .back a:hover {
    box-shadow: var(--lift);
  }
  .notice {
    color: var(--text-muted);
    font-size: 0.9em;
    margin: 0 0 var(--space-2);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
  }
  .state.err {
    color: var(--danger);
  }
  .icon {
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
  .icon:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .icon.on {
    color: var(--warn);
  }
  .icon.on :global(svg) {
    fill: currentColor;
  }
  .title {
    width: 100%;
    padding: 0;
    margin-bottom: var(--space-3);
    border: none;
    background: transparent;
    font-size: 2.1em;
    font-weight: 650;
    line-height: 1.2;
  }
  .title:focus {
    outline: none;
  }
  .msg {
    max-width: 520px;
    margin: 12vh auto;
    text-align: center;
    color: var(--text-muted);
  }
  .msg h1 {
    color: var(--text);
    margin-bottom: var(--space-2);
  }
</style>
