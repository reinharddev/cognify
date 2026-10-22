<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Plus, Trash2, X } from "@lucide/svelte";
  import CellInput from "./CellInput.svelte";
  import {
    COL_TYPES, addColumn, addOption, addRow, cycleSort, recolorOption, removeColumn, removeOption, removeRow, renameColumn, renameOption, setCell, setColumnType, visibleRows,
    type ColType, type TableData,
  } from "./model";

  let { data, query, onchange }: { data: TableData; query: string; onchange: (next: TableData) => void } = $props();

  const TYPE_LABEL: Record<ColType, string> = { text: "Teks", number: "Angka", date: "Tanggal", select: "Pilihan", checkbox: "Kotak centang" };

  const rows = $derived(visibleRows(data, query));
  let menu = $state<string | null>(null);
  let newOption = $state("");
  /** Posisi menu kolom di layar; `fixed` supaya tidak terpotong pembungkus tabel yang menggulir. */
  let menuAt = $state({ x: 0, y: 0, maxH: 400 });

  const sortIcon = (id: string) => (data.sort?.col !== id ? ArrowUpDown : data.sort.dir === "asc" ? ArrowUp : ArrowDown);

  function toggleMenu(event: MouseEvent, id: string) {
    event.stopPropagation();
    newOption = "";
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const w = 260;
    menuAt = {
      x: Math.max(8, Math.min(box.left, window.innerWidth - w - 8)),
      y: box.bottom + 4,
      maxH: Math.max(160, window.innerHeight - box.bottom - 16),
    };
    menu = menu === id ? null : id;
  }
</script>

<svelte:window onclick={() => (menu = null)} />

<div class="scroll">
  <table>
    <thead>
      <tr>
        {#each data.columns as c (c.id)}
          {@const Sort = sortIcon(c.id)}
          <th aria-sort={data.sort?.col === c.id ? (data.sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <div class="head">
              <button class="name" title="Urutkan" onclick={() => onchange(cycleSort(data, c.id))}>
                <span>{c.name}</span><Sort size={13} class={data.sort?.col === c.id ? "on" : "dim"} />
              </button>
              <button class="more" aria-label="Pengaturan kolom {c.name}" aria-expanded={menu === c.id} onclick={(e) => toggleMenu(e, c.id)}><MoreHorizontal size={15} /></button>
            </div>
            {#if menu === c.id}
              <div class="menu" style:left="{menuAt.x}px" style:top="{menuAt.y}px" style:max-height="{menuAt.maxH}px" role="dialog" aria-label="Kolom {c.name}" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && (menu = null)}>
                <label>Nama<input value={c.name} onchange={(e) => onchange(renameColumn(data, c.id, e.currentTarget.value))} /></label>
                <label>Tipe
                  <select value={c.type} onchange={(e) => onchange(setColumnType(data, c.id, e.currentTarget.value as ColType))}>
                    {#each COL_TYPES as t (t)}<option value={t}>{TYPE_LABEL[t]}</option>{/each}
                  </select>
                </label>
                {#if c.type === "select"}
                  <div class="opts">
                    <b>Pilihan</b>
                    {#each c.options ?? [] as o (o.id)}
                      <div class="opt">
                        <button class="dot" style:--c="var(--cat-{o.color})" aria-label="Ganti warna {o.label}" onclick={() => onchange(recolorOption(data, c.id, o.id, o.color + 1))}></button>
                        <input value={o.label} aria-label="Nama pilihan" onchange={(e) => onchange(renameOption(data, c.id, o.id, e.currentTarget.value))} />
                        <button class="x" aria-label="Hapus pilihan {o.label}" onclick={() => onchange(removeOption(data, c.id, o.id))}><X size={13} /></button>
                      </div>
                    {/each}
                    <form onsubmit={(e) => { e.preventDefault(); onchange(addOption(data, c.id, newOption)); newOption = ""; }}>
                      <input placeholder="Pilihan baru" bind:value={newOption} aria-label="Pilihan baru" />
                    </form>
                  </div>
                {/if}
                <button class="danger" disabled={data.columns.length <= 1} onclick={() => { menu = null; onchange(removeColumn(data, c.id)); }}><Trash2 size={14} /> Hapus kolom</button>
              </div>
            {/if}
          </th>
        {/each}
        <th class="add"><button aria-label="Tambah kolom" title="Tambah kolom" onclick={() => onchange(addColumn(data, "Kolom"))}><Plus size={15} /></button></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          {#each data.columns as c (c.id)}
            <td><CellInput column={c} value={r.cells[c.id]} label={c.name} onchange={(v) => onchange(setCell(data, r.id, c.id, v))} /></td>
          {/each}
          <td class="del"><button aria-label="Hapus baris" title="Hapus baris" onclick={() => onchange(removeRow(data, r.id))}><Trash2 size={14} /></button></td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !rows.length}
    <p class="empty">{query.trim() ? "Tidak ada baris yang cocok." : "Belum ada baris."}</p>
  {/if}
</div>
<button class="addrow" onclick={() => onchange(addRow(data))}><Plus size={15} /> Baris baru</button>

<style>
  .scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: max-content;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    padding: 0;
    min-width: 140px;
    vertical-align: middle;
  }
  th:last-child,
  td:last-child {
    border-right: 0;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr {
    animation: fade var(--dur-2) ease both;
  }
  th {
    position: relative;
    background: var(--surface-2);
    text-align: left;
    font-weight: 600;
  }
  th.add,
  td.del {
    min-width: 0;
    width: 40px;
    text-align: center;
  }
  .head {
    display: flex;
    align-items: center;
  }
  .name {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
    font-weight: 600;
    min-width: 0;
  }
  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name :global(.dim) {
    opacity: 0.35;
  }
  .name :global(.on) {
    color: var(--link);
  }
  .more,
  .add button,
  .del button,
  .x {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    background: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
  }
  .more:hover,
  .add button:hover,
  .del button:hover,
  .x:hover {
    background: var(--border);
    color: var(--text);
  }
  .del button {
    opacity: 0;
  }
  tr:hover .del button,
  .del button:focus-visible {
    opacity: 1;
  }
  .menu {
    position: fixed;
    z-index: 60;
    width: min(260px, calc(100vw - 16px));
    overflow-y: auto;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    display: grid;
    gap: var(--space-3);
    font-weight: 400;
    animation: pop var(--dur-2) var(--ease-out) both;
    transform-origin: top left;
  }
  .menu label {
    display: grid;
    gap: 4px;
    color: var(--text-muted);
    font-size: 0.85em;
  }
  .opts {
    display: grid;
    gap: 6px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .opt input {
    flex: 1;
  }
  .dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 0;
    padding: 0;
    background: var(--c);
    cursor: pointer;
    flex: none;
  }
  .danger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    padding: 6px 12px;
    color: var(--danger);
    cursor: pointer;
    justify-self: start;
  }
  .danger:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .empty {
    margin: 0;
    padding: var(--space-4);
    color: var(--text-muted);
  }
  .addrow {
    margin-top: var(--space-3);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: var(--accent-contrast);
    border: 0;
    border-radius: 99px;
    padding: 7px 16px;
    cursor: pointer;
    font-weight: 600;
  }
  .addrow:hover {
    background: var(--accent-hover);
  }
</style>
