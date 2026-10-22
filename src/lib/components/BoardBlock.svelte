<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  // Papan di dalam dokumen: gambar papan aslinya, hanya baca. Mengubahnya dilakukan di papan, dan
  // perubahan di sana langsung tampil di sini.
  import { goto } from "$app/navigation";
  import { Shapes } from "@lucide/svelte";
  import { onRemoteChange } from "$lib/pageSync";
  import { ws } from "$lib/stores/workspace.svelte";
  import { workspace } from "$lib/workspace/api";
  import type { WhiteboardScene } from "$lib/workspace/types";
  import Select from "$lib/ui/Select.svelte";

  let { attrs, update }: { attrs: { pageId: string }; update: (patch: { pageId: string }) => void } = $props();

  let svg = $state("");
  let failed = $state(false);
  let loading = $state(false);

  const node = $derived(ws.nodes.find((n) => n.id === attrs.pageId && n.kind === "board"));
  const boards = $derived(ws.nodes.filter((n) => n.kind === "board"));
  const NEW = "__new__";
  const options = $derived([
    { value: "", label: tr("Pilih papan…", "Choose a board…") },
    ...boards.map((b) => ({ value: b.id, label: b.title || tr("Tanpa judul", "Untitled") })),
    { value: NEW, label: tr("Buat papan baru", "Create new board") },
  ]);

  function parse(raw: string): WhiteboardScene | null {
    try {
      const v = JSON.parse(raw);
      return v && Array.isArray(v.elements) ? { type: "excalidraw", version: 2, appState: {}, files: {}, ...v } : null;
    } catch {
      return null;
    }
  }

  // Beberapa perubahan beruntun digambar sekali saja (yang terbaru).
  let token = 0;
  async function draw(raw: string) {
    const mine = ++token;
    const scene = parse(raw);
    if (!scene) {
      svg = "";
      loading = false;
      return;
    }
    try {
      const { sceneToSvg } = await import("$lib/whiteboard/excalidraw");
      const out = await sceneToSvg(scene);
      if (mine === token) svg = out;
      failed = false;
    } catch {
      if (mine === token) failed = true;
    } finally {
      if (mine === token) loading = false;
    }
  }

  $effect(() => {
    const id = attrs.pageId;
    svg = "";
    if (!id || !node) return;
    loading = true;
    void workspace.pages.get(id).then((p) => draw(p.content)).catch(() => (failed = true));
    // Perubahan langsung dari papan yang sedang diedit di jendela atau tab lain.
    return onRemoteChange((c) => c.id === id && c.content !== undefined && void draw(c.content));
  });

  async function pick(value: string) {
    if (value === NEW) {
      const page = await ws.create("board", null, { title: tr("Papan baru", "New board") });
      update({ pageId: page.id });
    } else update({ pageId: value });
  }
</script>

<div class="block">
  <div class="head">
    <span class="ic"><Shapes size={16} /></span>
    <div class="what">
      <b>{node ? node.title || tr("Tanpa judul", "Untitled") : attrs.pageId ? tr("Papan dibuang", "Board removed") : tr("Papan", "Board")}</b>
      <small>{node ? tr("Hanya baca. Ubah dari papannya.", "Read only. Edit it from the board.") : attrs.pageId ? tr("Papan ini sudah dibuang ke sampah.", "This board was moved to the trash.") : tr("Pilih papan yang mau ditampilkan.", "Choose the board to show.")}</small>
    </div>
    {#if !attrs.pageId || !node}
      <div class="sel"><Select value={attrs.pageId} {options} label={tr("Pilih papan", "Choose board")} onchange={pick} /></div>
    {:else}
      <button type="button" class="open" onclick={() => goto(`/p/${attrs.pageId}`)}>{tr("Buka papan", "Open board")}</button>
    {/if}
  </div>
  {#if node}
    {#if failed}
      <p class="empty">{tr("Papan tidak bisa digambar.", "The board could not be drawn.")}</p>
    {:else if svg}
      <div class="art">{@html svg}</div>
    {:else if !loading}
      <p class="empty">{tr("Papan ini masih kosong.", "This board is still empty.")}</p>
    {/if}
  {/if}
</div>

<style>
  .block {
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius);
    box-shadow: var(--lift);
    font-size: 0.95em;
    line-height: 1.4;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    background: var(--tint-2);
    border: var(--edge-w) solid var(--edge);
    border-radius: 8px;
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .what b {
    display: block;
    font-family: var(--font-display);
  }
  .what small,
  .empty {
    color: var(--text-muted);
  }
  .sel {
    width: 210px;
    flex: none;
  }
  .empty {
    margin: 0;
  }
  .art {
    overflow: hidden;
    border: var(--edge-w) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    line-height: 0;
  }
  .art :global(svg) {
    display: block;
    width: 100%;
    height: auto;
    max-height: 460px;
  }
  .open {
    padding: 0;
    border: none;
    background: none;
    color: var(--link);
    cursor: pointer;
  }
  .open:hover {
    text-decoration: underline;
  }
</style>
