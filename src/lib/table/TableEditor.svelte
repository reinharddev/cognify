<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { untrack } from "svelte";
  import { Columns3, Search, Table2 } from "@lucide/svelte";
  import { moodle } from "$lib/stores/moodle.svelte";
  import TableBoard from "./TableBoard.svelte";
  import TableGrid from "./TableGrid.svelte";
  import { clearMoodleHidden, mergeMoodle, parseTable, plainText, serialize, setGroupBy, setMoodleOn, setView, type MoodleTask, type TableData } from "./model";

  let { content, onchange }: { content: string; onchange: (json: string, plain: string) => void } = $props();

  // Halaman memasang ulang editor ini untuk setiap halaman ({#key}), jadi isi awal cukup dibaca sekali.
  // svelte-ignore state_referenced_locally
  let data = $state<TableData>(parseTable(content));
  let query = $state("");

  const selects = $derived(data.columns.filter((c) => c.type === "select"));

  function commit(next: TableData) {
    if (next === data) return;
    data = next;
    onchange(serialize(next), plainText(next));
  }

  // Tabel yang diisi dari Moodle (mis. Tabel PR): tugas ditambahkan otomatis dan status mengikuti Moodle saat berubah.
  const tasks = $derived<MoodleTask[]>(moodle.active ? moodle.items.map((i) => ({ id: i.id, course: i.course, title: i.title, due: i.due, state: i.state })) : []);
  $effect(() => {
    const list = tasks;
    const on = data.moodle?.on;
    if (!on || !list.length) return;
    // `data` dibaca tanpa dilacak: efek ini berjalan karena tugas atau saklar berubah, bukan karena tabel sendiri berubah.
    const current = untrack(() => data);
    const merged = mergeMoodle(current, list);
    if (merged !== current) commit(merged);
  });
</script>

<div class="bar">
  <div class="seg" role="group" aria-label={tr("Tampilan", "View")}>
    <button class:on={data.view === "table"} onclick={() => commit(setView(data, "table"))}><Table2 size={14} /> {tr("Tabel", "Table")}</button>
    <button class:on={data.view === "board"} disabled={!selects.length} title={selects.length ? "" : tr("Tambahkan kolom Pilihan untuk memakai papan", "Add a Select column to use the board")} onclick={() => commit(setView(data, "board"))}><Columns3 size={14} /> {tr("Papan", "Board")}</button>
  </div>
  {#if data.view === "board" && selects.length > 1}
    <label class="group">Kelompokkan
      <select value={data.groupBy ?? ""} onchange={(e) => commit(setGroupBy(data, e.currentTarget.value))}>
        {#each selects as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if data.moodle}
    <label class="mdl" title={tr("Tugas dari Moodle ditambahkan otomatis, lengkap dengan statusnya. Baris yang kamu tulis sendiri tidak diubah.", "Moodle tasks are added automatically, with their status. Rows you write yourself are left alone.")}>
      <input type="checkbox" role="switch" checked={data.moodle.on} onchange={(e) => commit(setMoodleOn(data, e.currentTarget.checked))} />
      <span>{tr("Isi dari Moodle", "Fill from Moodle")}</span>
    </label>
    {#if data.moodle.on && !moodle.active}
      <a class="mdl-note" href="/settings">{tr("Hubungkan Moodle", "Connect Moodle")}</a>
    {/if}
    {#if data.moodle.hidden.length}
      <button class="mdl-restore" onclick={() => commit(clearMoodleHidden(data))}>{tr(`Pulihkan ${data.moodle.hidden.length} baris yang dihapus`, `Restore ${data.moodle.hidden.length} deleted rows`)}</button>
    {/if}
  {/if}
  <label class="search"><Search size={14} /><input type="search" placeholder={tr("Cari di tabel", "Search the table")} aria-label={tr("Cari di tabel", "Search the table")} bind:value={query} /></label>
</div>

{#key data.view}
  <div class="view">
    {#if data.view === "board"}
      <TableBoard {data} {query} onchange={commit} />
    {:else}
      <TableGrid {data} {query} onchange={commit} />
    {/if}
  </div>
{/key}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  .mdl { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); cursor: pointer; }
  .mdl-note { color: var(--link); font-size: 0.9em; }
  .mdl-restore { padding: var(--space-1) var(--space-3); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); color: var(--text); font: inherit; font-size: 0.9em; cursor: pointer; }
  .mdl-restore:hover { background: var(--surface-2); }
  .mdl-restore:focus-visible, .mdl-note:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
  .seg {
    display: inline-flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    padding: var(--space-1);
    gap: var(--space-0);
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: 0;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    cursor: pointer;
    color: var(--text-muted);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  .seg button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .group select {
    width: auto;
  }
  .search {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    padding: 0 var(--space-3);
    color: var(--text-muted);
  }
  .search input {
    border: 0;
    background: none;
    width: 180px;
    padding: var(--space-2) 0;
  }
  .search input:focus-visible {
    outline: none;
  }
  .search:focus-within {
    outline: 2px solid var(--accent-strong);
    outline-offset: 2px;
  }
  .view {
    animation: rise var(--dur-3) var(--ease-out) backwards;
  }
</style>
