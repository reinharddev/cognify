<script lang="ts">
  import { dialog } from "$lib/stores/dialog.svelte";
  import { onMount } from "svelte";
  import { RotateCcw, Trash2 } from "@lucide/svelte";
  import { kindIcon } from "$lib/workspace/kinds";
  import { ws } from "$lib/stores/workspace.svelte";
  import { workspace } from "$lib/workspace/api";
  import type { TrashItem } from "$lib/workspace/types";

  let items = $state<TrashItem[] | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      items = await workspace.trash.list();
    } catch (e) {
      error = e instanceof Error ? e.message : "Sampah tidak bisa dimuat.";
    }
  }
  onMount(load);

  async function restore(item: TrashItem) {
    await workspace.pages.restore(item.id);
    await Promise.all([load(), ws.refresh()]);
  }

  async function remove(item: TrashItem) {
    const extra = item.descendants ? `Ada ${item.descendants} halaman di dalamnya yang ikut terhapus.` : undefined;
    if (!(await dialog.confirm(`Hapus "${item.title || "Tanpa judul"}" selamanya?`, { detail: extra, danger: true, okLabel: "Hapus selamanya" }))) return;
    await workspace.pages.deleteForever(item.id);
    await load();
  }

  async function empty() {
    if (!items?.length) return;
    if (!(await dialog.confirm("Kosongkan sampah?", { detail: "Semua halaman di dalamnya terhapus selamanya.", danger: true, okLabel: "Kosongkan" }))) return;
    await workspace.trash.empty();
    await load();
  }
</script>

<div class="trash">
  <header>
    <h1>Sampah</h1>
    {#if items?.length}<button onclick={empty}>Kosongkan sampah</button>{/if}
  </header>
  {#if error}<p class="err">{error}</p>{/if}
  {#if items && !items.length}
    <p class="muted">Sampah kosong. Halaman yang kamu buang muncul di sini dan bisa dipulihkan.</p>
  {/if}
  <ul>
    {#each items ?? [] as item (item.id)}
      {@const KindIcon = kindIcon(item.kind)}
      <li>
        <KindIcon size={16} />
        <span class="t">{item.title || "Tanpa judul"}{#if item.descendants} <small>dan {item.descendants} halaman di dalamnya</small>{/if}</span>
        <button title="Pulihkan" aria-label="Pulihkan" onclick={() => restore(item)}><RotateCcw size={15} /> Pulihkan</button>
        <button class="danger" title="Hapus selamanya" aria-label="Hapus selamanya" onclick={() => remove(item)}><Trash2 size={15} /></button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .trash {
    max-width: 780px;
    margin: 0 auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }
  h1 {
    font-size: 1.9em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small,
  .muted {
    color: var(--text-muted);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--accent-strong);
  }
  .danger:hover {
    border-color: var(--danger);
    color: var(--danger);
  }
  .err {
    color: var(--danger);
  }
</style>
