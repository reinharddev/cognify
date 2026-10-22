<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { Plus, Trash2, X } from "@lucide/svelte";
  import CellInput from "./CellInput.svelte";
  import { startPointerDrag } from "$lib/pointerDrag";
  import { addRow, display, lanes, moveCard, removeRow, setCell, type Row, type TableData } from "./model";

  let { data, query, onchange }: { data: TableData; query: string; onchange: (next: TableData) => void } = $props();

  const groupCol = $derived(data.columns.find((c) => c.id === data.groupBy));
  const lanesNow = $derived(lanes(data, query));
  const titleCol = $derived(data.columns[0]);

  let dragId = $state<string | null>(null);
  /** Lajur dan kartu yang sedang disorot saat menyeret. */
  let over = $state<{ lane: string; before: string | null } | null>(null);
  let openId = $state<string | null>(null);
  const openRow = $derived(openId ? (data.rows.find((r) => r.id === openId) ?? null) : null);

  const laneKey = (id: string | null) => id ?? "_none";
  const titleOf = (r: Row) => display(titleCol, r.cells[titleCol.id]) || tr("Tanpa judul", "Untitled");
  const meta = (r: Row) =>
    data.columns
      .filter((c) => c.id !== titleCol.id && c.id !== data.groupBy)
      .map((c) => ({ id: c.id, text: c.type === "checkbox" ? (r.cells[c.id] ? c.name : "") : display(c, r.cells[c.id]) }))
      .filter((m) => m.text);

  /** Seret berbasis pointer (lihat pointerDrag.ts): lajur dan kartu sasaran dicari dari elemen di bawah kursor. */
  function onCardDown(event: PointerEvent, r: Row) {
    startPointerDrag(event, event.currentTarget as HTMLElement, {
      onStart: () => (dragId = r.id),
      onMove: (x, y) => {
        const el = document.elementFromPoint(x, y);
        const laneEl = el?.closest<HTMLElement>("[data-lane]");
        if (!laneEl) {
          over = null;
          return;
        }
        const lane = laneEl.dataset.lane!;
        const cardEl = el?.closest<HTMLElement>("[data-card]");
        const cardId = cardEl?.dataset.card;
        if (cardEl && cardId && cardId !== r.id) {
          const box = cardEl.getBoundingClientRect();
          // "sesudah kartu ini" = sebelum kartu berikutnya di lajur; diselesaikan saat dilepas.
          over = { lane, before: y < box.top + box.height / 2 ? cardId : `after:${cardId}` };
        } else {
          over = { lane, before: cardId === r.id ? over?.before ?? null : null };
        }
      },
      onEnd: (_x, _y, cancelled) => {
        const target = over;
        const id = dragId;
        dragId = null;
        over = null;
        if (cancelled || !target || !id) return;
        const lane = lanesNow.find((l) => laneKey(l.option?.id ?? null) === target.lane);
        if (!lane) return;
        let before: string | null = target.before;
        if (before?.startsWith("after:")) {
          const rows = lane.rows;
          const idx = rows.findIndex((x) => x.id === before!.slice(6));
          before = rows[idx + 1]?.id ?? null;
        }
        if (before === id) return;
        onchange(moveCard(data, id, lane.option?.id ?? null, before));
      },
    });
  }

  /** Fokus ke kolom pertama saat dialog terbuka, supaya langsung bisa mengetik dan Esc bekerja. */
  function focusFirst(node: HTMLElement) {
    node.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }

  function addCard(optionId: string | null) {
    const next = addRow(data, groupCol && optionId ? { [groupCol.id]: optionId } : {});
    onchange(next);
    openId = next.rows[next.rows.length - 1]?.id ?? null;
  }
</script>

<div class="lanes" data-stagger>
  {#each lanesNow as lane (laneKey(lane.option?.id ?? null))}
    {@const key = laneKey(lane.option?.id ?? null)}
    <section
      class="lane"
      class:hot={over?.lane === key}
      aria-label={lane.option?.label ?? tr("Tanpa nilai", "No value")}
      data-lane={key}
    >
      <header>
        <span class="tag" style:--c={lane.option ? `var(--cat-${lane.option.color})` : "var(--border-strong)"}>{lane.option?.label ?? tr("Tanpa nilai", "No value")}</span>
        <small>{lane.rows.length}</small>
      </header>
      <div class="cards">
        {#each lane.rows as r, i (r.id)}
          <div class="gap" class:show={over?.lane === key && over.before === r.id}></div>
          <button
            class="card"
            class:dragging={dragId === r.id}
            style:--i={i}
            data-card={r.id}
            onpointerdown={(e) => onCardDown(e, r)}
            onclick={() => (openId = r.id)}
          >
            <strong>{titleOf(r)}</strong>
            {#if meta(r).length}<span class="meta">{#each meta(r) as m (m.id)}<i>{m.text}</i>{/each}</span>{/if}
          </button>
          {#if i === lane.rows.length - 1}<div class="gap" class:show={over?.lane === key && over.before === `after:${r.id}`}></div>{/if}
        {/each}
        {#if !lane.rows.length}<div class="gap" class:show={over?.lane === key}></div>{/if}
      </div>
      {#if lane.option}<button class="add" onclick={() => addCard(lane.option!.id)}><Plus size={14} /> {tr("Kartu", "Card")}</button>{/if}
    </section>
  {/each}
</div>

{#if openRow}
  <div class="backdrop" role="presentation" onclick={() => (openId = null)}>
    <div class="sheet" role="dialog" aria-label={tr("Detail kartu", "Card details")} tabindex="-1" use:focusFirst onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && (openId = null)}>
      <header>
        <strong>{titleOf(openRow)}</strong>
        <button class="close" aria-label={tr("Tutup", "Close")} onclick={() => (openId = null)}><X size={16} /></button>
      </header>
      {#each data.columns as c (c.id)}
        <div class="field"><span>{c.name}</span><CellInput column={c} value={openRow.cells[c.id]} label={c.name} onchange={(v) => onchange(setCell(data, openRow.id, c.id, v))} /></div>
      {/each}
      <button class="remove" onclick={() => { const id = openRow.id; openId = null; onchange(removeRow(data, id)); }}><Trash2 size={14} /> {tr("Hapus kartu", "Delete card")}</button>
    </div>
  </div>
{/if}

<style>
  .lanes {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    padding-bottom: var(--space-3);
    align-items: flex-start;
  }
  .lane {
    flex: 0 0 260px;
    background: var(--surface-2);
    border: 2px solid transparent;
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    transition: border-color var(--dur-1) ease, background-color var(--dur-1) ease;
  }
  .lane.hot {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
  }
  .lane > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .tag {
    background: color-mix(in srgb, var(--c) 26%, var(--surface));
    border-radius: 99px;
    padding: 2px 12px;
    font-weight: 600;
  }
  small {
    color: var(--text-muted);
  }
  .cards {
    display: flex;
    flex-direction: column;
    min-height: 12px;
  }
  .gap {
    height: 0;
    border-radius: 99px;
    background: var(--accent-strong);
    transition: height var(--dur-1) ease, margin var(--dur-1) ease;
  }
  .gap.show {
    height: 3px;
    margin: 3px 0;
  }
  .card {
    display: grid;
    gap: 6px;
    text-align: left;
    width: 100%;
    margin: 3px 0;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: grab;
    animation: rise var(--dur-3) var(--ease-out) backwards;
    animation-delay: calc(var(--i, 0) * 35ms);
  }
  .card:hover {
    border-color: var(--accent-strong);
    transform: translateY(-2px);
  }
  .card.dragging {
    opacity: 0.4;
    transform: scale(0.97);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .meta i {
    font-style: normal;
    font-size: 0.8em;
    color: var(--text-muted);
    background: var(--surface-2);
    border-radius: 99px;
    padding: 1px 8px;
  }
  .add {
    margin-top: var(--space-2);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 0;
    color: var(--text-muted);
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .add:hover {
    background: var(--border);
    color: var(--text);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--text) 30%, transparent);
    animation: fade var(--dur-2) ease both;
  }
  .sheet {
    width: min(460px, 92vw);
    max-height: 86vh;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    animation: pop var(--dur-2) var(--ease-out) both;
  }
  .sheet > header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .close {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    background: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--surface-2);
  }
  .field {
    display: grid;
    grid-template-columns: 110px 1fr;
    align-items: center;
    gap: var(--space-2);
  }
  .field > span {
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .remove {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    padding: 6px 12px;
    color: var(--danger);
    cursor: pointer;
  }
</style>
