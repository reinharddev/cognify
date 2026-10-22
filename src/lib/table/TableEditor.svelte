<script lang="ts">
  import { Columns3, Search, Table2 } from "@lucide/svelte";
  import TableBoard from "./TableBoard.svelte";
  import TableGrid from "./TableGrid.svelte";
  import { parseTable, plainText, serialize, setGroupBy, setView, type TableData } from "./model";

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
</script>

<div class="bar">
  <div class="seg" role="group" aria-label="Tampilan">
    <button class:on={data.view === "table"} onclick={() => commit(setView(data, "table"))}><Table2 size={14} /> Tabel</button>
    <button class:on={data.view === "board"} disabled={!selects.length} title={selects.length ? "" : "Tambahkan kolom Pilihan untuk memakai papan"} onclick={() => commit(setView(data, "board"))}><Columns3 size={14} /> Papan</button>
  </div>
  {#if data.view === "board" && selects.length > 1}
    <label class="group">Kelompokkan
      <select value={data.groupBy ?? ""} onchange={(e) => commit(setGroupBy(data, e.currentTarget.value))}>
        {#each selects as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="search"><Search size={14} /><input type="search" placeholder="Cari di tabel" aria-label="Cari di tabel" bind:value={query} /></label>
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
  .seg {
    display: inline-flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 3px;
    gap: 2px;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 5px 14px;
    border-radius: 99px;
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
    gap: 8px;
    color: var(--text-muted);
  }
  .group select {
    width: auto;
  }
  .search {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 0 12px;
    color: var(--text-muted);
  }
  .search input {
    border: 0;
    background: none;
    width: 180px;
    padding: 6px 0;
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
