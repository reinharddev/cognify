<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
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
      error = e instanceof Error ? e.message : tr("Sampah tidak bisa dimuat.", "The trash could not be loaded.");
    }
  }
  onMount(load);

  async function restore(item: TrashItem) {
    await workspace.pages.restore(item.id);
    await Promise.all([load(), ws.refresh()]);
  }

  async function remove(item: TrashItem) {
    const extra = item.descendants ? tr(`Ada ${item.descendants} halaman di dalamnya yang ikut terhapus.`, `${item.descendants} pages inside will be deleted too.`) : undefined;
    if (!(await dialog.confirm(tr(`Hapus "${item.title || "Tanpa judul"}" selamanya?`, `Delete "${item.title || "Untitled"}" forever?`), { detail: extra, danger: true, okLabel: tr("Hapus selamanya", "Delete forever") }))) return;
    await workspace.pages.deleteForever(item.id);
    await load();
  }

  async function empty() {
    if (!items?.length) return;
    if (!(await dialog.confirm(tr("Kosongkan sampah?", "Empty the trash?"), { detail: tr("Semua halaman di dalamnya terhapus selamanya.", "Every page in it is deleted forever."), danger: true, okLabel: tr("Kosongkan", "Empty") }))) return;
    await workspace.trash.empty();
    await load();
  }
</script>

<div class="trash">
  <header>
    <h1>{tr("Sampah", "Trash")}</h1>
    {#if items?.length}<button onclick={empty}>{tr("Kosongkan sampah", "Empty trash")}</button>{/if}
  </header>
  {#if error}<p class="err">{error}</p>{/if}
  {#if items && !items.length}
    <p class="muted">{tr("Sampah kosong. Halaman yang kamu buang muncul di sini dan bisa dipulihkan.", "The trash is empty. Pages you remove show up here and can be restored.")}</p>
  {/if}
  <ul>
    {#each items ?? [] as item (item.id)}
      {@const KindIcon = kindIcon(item.kind)}
      <li>
        <KindIcon size={16} />
        <span class="t">{item.title || tr("Tanpa judul", "Untitled")}{#if item.descendants} <small>{tr(`dan ${item.descendants} halaman di dalamnya`, `and ${item.descendants} pages inside`)}</small>{/if}</span>
        <button title={tr("Pulihkan", "Restore")} aria-label={tr("Pulihkan", "Restore")} onclick={() => restore(item)}><RotateCcw size={15} /> {tr("Pulihkan", "Restore")}</button>
        <button class="danger" title={tr("Hapus selamanya", "Delete forever")} aria-label={tr("Hapus selamanya", "Delete forever")} onclick={() => remove(item)}><Trash2 size={15} /></button>
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
