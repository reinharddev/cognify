<script lang="ts">
  // Pemilih jam buatan sendiri (nilai "HH:MM", 24 jam), pengganti <input type="time">.
  import { tick } from "svelte";
  import { Clock } from "@lucide/svelte";
  import { place } from "./place";

  let { value = $bindable(""), label, id, disabled = false, minuteStep = 5, class: cls = "", onchange }: { class?: string; onchange?: (v: string) => void; value: string; label?: string; id?: string; disabled?: boolean; minuteStep?: number } = $props();

  const two = (n: number) => String(n).padStart(2, "0");
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = $derived(Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep));

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });

  const parts = $derived.by(() => {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
  });

  async function show() {
    if (disabled) return;
    open = true;
    await tick();
    if (trigger && pop) pos = place(trigger, pop);
    for (const el of pop?.querySelectorAll<HTMLElement>(".on") ?? []) el.scrollIntoView({ block: "center" });
  }
  function close() {
    open = false;
    trigger?.focus();
  }
  function set(h: number, m: number) {
    value = `${two(h)}:${two(m)}`;
    onchange?.(value);
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onblur={() => (open = false)} />

<button bind:this={trigger} {id} type="button" class="tp {cls}" class:open {disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onclick={() => (open ? close() : show())} {onkeydown}>
  <span class="val" class:empty={!parts}>{parts ? value : "--:--"}</span>
  <Clock size={15} />
</button>

{#if open}
  <div class="scrim" role="presentation" onpointerdown={() => (open = false)} oncontextmenu={(e) => { e.preventDefault(); open = false; }}></div>
  <div class="pop" bind:this={pop} role="dialog" aria-label="Pilih jam" style:left="{pos.left}px" style:top="{pos.top}px" {onkeydown} tabindex="-1">
    <div class="col" role="listbox" aria-label="Jam">
      {#each hours as h (h)}
        <button type="button" role="option" aria-selected={parts?.h === h} class:on={parts?.h === h} onclick={() => set(h, parts?.m ?? 0)}>{two(h)}</button>
      {/each}
    </div>
    <div class="col" role="listbox" aria-label="Menit">
      {#each minutes as m (m)}
        <button type="button" role="option" aria-selected={parts?.m === m} class:on={parts?.m === m} onclick={() => set(parts?.h ?? 9, m)}>{two(m)}</button>
      {/each}
    </div>
    <button type="button" class="done" onclick={close}>Selesai</button>
  </div>
{/if}

<style>
  .tp {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: left;
    cursor: pointer;
  }
  .tp:hover:not(:disabled) { border-color: var(--border-strong); }
  .tp.open { border-color: var(--accent-strong); }
  .tp:disabled { opacity: 0.55; cursor: not-allowed; }
  .tp :global(svg) { flex: none; color: var(--text-muted); }
  .val.empty { color: var(--text-muted); }
  .scrim { position: fixed; inset: 0; z-index: 190; }
  .pop {
    position: fixed;
    z-index: 191;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    width: 156px;
    padding: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px var(--shadow-4);
    animation: pop var(--dur-2) var(--ease-out) both;
    outline: none;
  }
  .col { display: flex; flex-direction: column; gap: 2px; max-height: 196px; overflow-y: auto; }
  .col button { padding: 6px 0; border: none; border-radius: 8px; background: none; color: var(--text); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
  .col button:hover { background: var(--surface-2); }
  .col button.on { background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .done { grid-column: 1 / -1; padding: 6px; border: none; border-radius: 8px; background: var(--surface-2); color: var(--text); font: inherit; cursor: pointer; }
  .done:hover { background: var(--accent-soft); }
</style>
