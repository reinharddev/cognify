<script lang="ts">
  import { dateLocale, i18n, tr } from "$lib/i18n.svelte";
  // Pemilih tanggal buatan sendiri (nilai "YYYY-MM-DD"), pengganti <input type="date">.
  import { tick } from "svelte";
  import { CalendarDays, ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { place } from "./place";

  let { value = $bindable(""), label, id, disabled = false, class: cls = "", onchange }: { class?: string; onchange?: (v: string) => void; value: string; label?: string; id?: string; disabled?: boolean } = $props();

  const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
  };

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  let viewY = $state(new Date().getFullYear());
  let viewM = $state(new Date().getMonth());

  const text = $derived.by(() => {
    const p = parse(value);
    return p ? new Date(p[0], p[1], p[2]).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" }) : "";
  });
  const title = $derived(new Date(viewY, viewM, 1).toLocaleDateString(dateLocale(), { month: "long", year: "numeric" }));
  const today = key(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  // Senin sebagai hari pertama; sel kosong di depan bulan dibuang.
  const cells = $derived.by(() => {
    const lead = (new Date(viewY, viewM, 1).getDay() + 6) % 7;
    const days = new Date(viewY, viewM + 1, 0).getDate();
    return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  });
  const heads = $derived(i18n.lang === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);

  async function show() {
    if (disabled) return;
    const p = parse(value);
    if (p) [viewY, viewM] = [p[0], p[1]];
    open = true;
    await tick();
    if (trigger && pop) pos = place(trigger, pop);
  }
  function close() {
    open = false;
    trigger?.focus();
  }
  function step(n: number) {
    const d = new Date(viewY, viewM + n, 1);
    [viewY, viewM] = [d.getFullYear(), d.getMonth()];
  }
  function pick(d: number) {
    value = key(viewY, viewM, d);
    onchange?.(value);
    close();
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

<button bind:this={trigger} {id} type="button" class="dp {cls}" class:open {disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onclick={() => (open ? close() : show())} {onkeydown}>
  <span class="val" class:empty={!text}>{text || tr("Pilih tanggal", "Pick a date")}</span>
  <CalendarDays size={15} />
</button>

{#if open}
  <div class="scrim" role="presentation" onpointerdown={() => (open = false)} oncontextmenu={(e) => { e.preventDefault(); open = false; }}></div>
  <div class="pop" bind:this={pop} role="dialog" aria-label={tr("Pilih tanggal", "Pick a date")} style:left="{pos.left}px" style:top="{pos.top}px" {onkeydown} tabindex="-1">
    <div class="bar">
      <button type="button" class="nav" aria-label={tr("Bulan sebelumnya", "Previous month")} onclick={() => step(-1)}><ChevronLeft size={16} /></button>
      <strong>{title}</strong>
      <button type="button" class="nav" aria-label={tr("Bulan berikutnya", "Next month")} onclick={() => step(1)}><ChevronRight size={16} /></button>
    </div>
    <div class="grid">
      {#each heads as h (h)}<span class="head">{h}</span>{/each}
      {#each cells as d, i (i)}
        {#if d === null}<span></span>{:else}
          {@const k = key(viewY, viewM, d)}
          <button type="button" class="day" class:sel={k === value} class:today={k === today} onclick={() => pick(d)}>{d}</button>
        {/if}
      {/each}
    </div>
    <div class="foot">
      <button type="button" class="link" onclick={() => { const n = new Date(); value = key(n.getFullYear(), n.getMonth(), n.getDate()); onchange?.(value); close(); }}>{tr("Hari ini", "Today")}</button>
    </div>
  </div>
{/if}

<style>
  .dp {
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
    text-align: left;
    cursor: pointer;
  }
  .dp:hover:not(:disabled) { border-color: var(--border-strong); }
  .dp.open { border-color: var(--accent-strong); }
  .dp:disabled { opacity: 0.55; cursor: not-allowed; }
  .dp :global(svg) { flex: none; color: var(--text-muted); }
  .val.empty { color: var(--text-muted); }
  .scrim { position: fixed; inset: 0; z-index: 190; }
  .pop {
    position: fixed;
    z-index: 191;
    width: 264px;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px var(--shadow-4);
    animation: pop var(--dur-2) var(--ease-out) both;
    outline: none;
  }
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; text-transform: capitalize; }
  .nav { display: grid; place-items: center; width: 28px; height: 28px; border: none; border-radius: 8px; background: none; color: var(--text); cursor: pointer; }
  .nav:hover { background: var(--surface-2); }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
  .head { padding: 4px 0; font-size: 0.75em; color: var(--text-muted); }
  .day { height: 32px; border: none; border-radius: 8px; background: none; color: var(--text); font: inherit; cursor: pointer; }
  .day:hover { background: var(--surface-2); }
  .day.today { box-shadow: inset 0 0 0 1px var(--accent-strong); }
  .day.sel { background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .foot { display: flex; justify-content: center; margin-top: 6px; }
  .link { border: none; background: none; color: var(--link); font: inherit; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
  .link:hover { background: var(--surface-2); }
</style>
