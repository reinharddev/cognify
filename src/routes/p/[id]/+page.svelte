<script lang="ts">
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import { onDestroy } from "svelte";
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { Download, Quote, Star, Trash2 } from "@lucide/svelte";
  import CitePanel from "$lib/components/CitePanel.svelte";
  import FolderView from "$lib/components/FolderView.svelte";
  import { KIND_LABEL, kindIcon } from "$lib/workspace/kinds";
  import Board from "$lib/components/Board.svelte";
  import Editor from "$lib/components/Editor.svelte";
  import TableEditor from "$lib/table/TableEditor.svelte";
  import TagEditor from "$lib/components/TagEditor.svelte";
  import { createBroadcaster, onRemoteChange } from "$lib/pageSync";
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
  let docEditor = $state<{ setRemote(json: string): void }>();
  const sync = createBroadcaster(() => id);

  // Perubahan ditahan sebentar lalu dikirim sekaligus; berpindah halaman mengirim sisanya lebih dulu.
  let pending: PageUpdate = {};
  let pendingId = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    clearTimeout(timer);
    if (!pendingId || !Object.keys(pending).length) return;
    const target = pendingId;
    const patch = pending;
    pending = {};
    status = "saving";
    try {
      await workspace.pages.update(target, patch);
      status = "saved";
      if (patch.tags) void ws.refreshTags();
    } catch {
      status = "error";
    }
  }

  function queue(patch: PageUpdate) {
    pendingId = id;
    pending = { ...pending, ...patch };
    sync.push({ content: patch.content, title: patch.title });
    status = "saving";
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }

  $effect(() => {
    const target = id;
    current = null;
    missing = false;
    status = "saved";
    workspace.pages
      .get(target)
      .then((p) => {
        if (target === id) current = p;
      })
      .catch(() => {
        if (target === id) missing = true;
      });
    return () => void flush();
  });

  onDestroy(() => {
    void flush();
    sync.flush();
  });

  // Perubahan dari jendela lain (catatan melayang) langsung tampil di sini. Bila ada ketikan lokal yang
  // belum tersimpan, yang lokal dipertahankan.
  $effect(() =>
    onRemoteChange((c) => {
      if (c.id !== id || !current || Object.keys(pending).length) return;
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
      if (!isTauri()) throw new Error("Simpan gambar hanya tersedia di aplikasi Cognify.");
      if (format === "png") await invoke("write_base64_file", { path, data: await toBase64(await board.exportPng()) });
      else await invoke("write_text_file", { path, content: await board.exportSvg() });
      notice = `Gambar disimpan di ${path}`;
    } catch (e) {
      notice = typeof e === "string" ? e : e instanceof Error ? e.message : "Gambar gagal disimpan.";
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
    <h1>Halaman tidak ditemukan</h1>
    <p>Mungkin sudah dibuang ke sampah atau dihapus.</p>
    <a href="/">Kembali ke Beranda</a>
  </div>
{:else if current}
  <div class="page" class:wide={current.kind === "board" || current.kind === "table"}>
    <header>
      <span class="kind">
        <HeaderIcon size={15} /> {KIND_LABEL[current.kind]}
      </span>
      <span class="state" class:err={status === "error"}>
        {status === "saving" ? "Menyimpan…" : status === "error" ? "Gagal menyimpan" : "Tersimpan"}
      </span>
      {#if current.kind === "board"}
        <button class="icon" aria-label="Simpan gambar PNG" title="Simpan gambar PNG" onclick={() => exportBoard("png")}><Download size={16} /></button>
      {/if}
      {#if current.kind === "doc"}
        <button class="icon" aria-label="Kutip" title="Kutip" onclick={() => (citeOpen = true)}><Quote size={16} /></button>
      {/if}
      <button class="icon" class:on={current.favorite} aria-label={current.favorite ? "Hapus dari favorit" : "Jadikan favorit"} title="Favorit" onclick={favorite}><Star size={16} /></button>
      <button class="icon" aria-label="Buang ke sampah" title="Buang ke sampah" onclick={remove}><Trash2 size={16} /></button>
    </header>

    <input class="title" value={current.title} placeholder="Tanpa judul" aria-label="Judul halaman" oninput={onTitle} />

    {#if current.kind !== "folder"}
    <TagEditor tags={current.tags} onchange={(tags) => { if (current) current.tags = tags; queue({ tags }); }} />
    {/if}

    {#if notice}<p class="notice">{notice}</p>{/if}

    {#if current.kind === "board"}
      {#key current.id}
        <Board bind:this={board} content={current.content} onchange={(json, plain) => queue({ content: json, plainText: plain })} />
      {/key}
    {:else if current.kind === "folder"}
      {#key current.id}
        <FolderView id={current.id} />
      {/key}
    {:else if current.kind === "doc"}
      {#key current.id}
        <Editor bind:this={docEditor} content={current.content} spellcheck={prefs.value.spellcheck} onchange={(json, plain) => queue({ content: json, plainText: plain })} />
      {/key}
    {:else}
      {#key current.id}
        <TableEditor content={current.content} onchange={(json, plain) => queue({ content: json, plainText: plain })} />
      {/key}
    {/if}
  </div>
{/if}

{#if citeOpen && current}
  <CitePanel pageId={current.id} title={current.title} onTitle={setTitle} onClose={() => (citeOpen = false)} />
{/if}

<style>
  .page {
    max-width: 780px;
    margin: 0 auto;
  }
  .page.wide {
    max-width: none;
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
