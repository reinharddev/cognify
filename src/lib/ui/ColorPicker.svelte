<script lang="ts">
  // Pemilih warna buatan sendiri (nilai "#rrggbb"), pengganti <input type="color">.
  import { tick, type Snippet } from "svelte";
  import { place } from "./place";

  let { value = $bindable("#7e6cf0"), label, id, disabled = false, class: cls = "", onchange, onclear, clearLabel = "Tanpa warna", children }: { class?: string; onclear?: () => void; clearLabel?: string; children?: Snippet; onchange?: (v: string) => void; value: string; label?: string; id?: string; disabled?: boolean } = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  let hue = $state(0);
  let sat = $state(1);
  let val = $state(1);
  let hex = $state("");

  function toHsv(h: string): [number, number, number] {
    const n = parseInt(h.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let hh = 0;
    if (d) hh = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, max ? d / max : 0, max];
  }
  function toHex(h: number, s: number, v: number): string {
    const f = (n: number) => {
      const k = (n + h / 60) % 6;
      return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
    };
    return "#" + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const valid = (h: string) => /^#[0-9a-f]{6}$/i.test(h);

  const SWATCHES = ["#7e6cf0", "#3592be", "#39986c", "#b27f19", "#e26336", "#dd5b92", "#a26cf0", "#3d9793", "#2b2745", "#6a6486", "#ffffff", "#000000"];

  async function show() {
    if (disabled) return;
    if (valid(value)) [hue, sat, val] = toHsv(value);
    hex = value;
    open = true;
    await tick();
    if (trigger && pop) pos = place(trigger, pop);
  }
  function close() {
    open = false;
    trigger?.focus();
  }
  function commit() {
    value = toHex(hue, sat, val);
    hex = value;
    onchange?.(value);
  }
  function drag(node: HTMLElement, on: (x: number, y: number) => void) {
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      on(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
    };
    const down = (e: PointerEvent) => {
      node.setPointerCapture(e.pointerId);
      move(e);
      node.addEventListener("pointermove", move);
    };
    const up = () => node.removeEventListener("pointermove", move);
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    return { destroy: () => (node.removeEventListener("pointerdown", down), node.removeEventListener("pointerup", up), node.removeEventListener("pointercancel", up), up()) };
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

<button bind:this={trigger} {id} type="button" class="cp {cls}" class:open {disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onclick={() => (open ? close() : show())} {onkeydown}>
  {#if children}{@render children()}{:else}
    <span class="chip" style:background={value}></span>
    <span class="code">{value}</span>
  {/if}
</button>

{#if open}
  <div class="scrim" role="presentation" onpointerdown={() => (open = false)} oncontextmenu={(e) => { e.preventDefault(); open = false; }}></div>
  <div class="pop" bind:this={pop} role="dialog" aria-label="Pilih warna" style:left="{pos.left}px" style:top="{pos.top}px" {onkeydown} tabindex="-1">
    <div
      class="area"
      style:background-color="hsl({hue} 100% 50%)"
      use:drag={(x, y) => { sat = x; val = 1 - y; commit(); }}
      role="slider"
      tabindex="0"
      aria-label="Kecerahan dan kejenuhan"
      aria-valuenow={Math.round(sat * 100)}
    >
      <span class="knob" style:left="{sat * 100}%" style:top="{(1 - val) * 100}%"></span>
    </div>
    <div class="hue" use:drag={(x) => { hue = x * 360; commit(); }} role="slider" tabindex="0" aria-label="Rona" aria-valuenow={Math.round(hue)}>
      <span class="knob" style:left="{(hue / 360) * 100}%"></span>
    </div>
    <div class="swatches">
      {#each SWATCHES as c (c)}
        <button type="button" class="sw" class:on={c === value} style:background={c} aria-label={c} onclick={() => { value = c; [hue, sat, val] = toHsv(c); hex = c; onchange?.(c); }}></button>
      {/each}
    </div>
    {#if onclear}<button type="button" class="clear" onclick={() => { onclear(); close(); }}>{clearLabel}</button>{/if}
    <input
      class="hex"
      aria-label="Kode warna"
      spellcheck="false"
      maxlength="7"
      bind:value={hex}
      oninput={() => { if (valid(hex)) { value = hex.toLowerCase(); [hue, sat, val] = toHsv(value); onchange?.(value); } }}
    />
  </div>
{/if}

<style>
  .cp {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .cp:hover:not(:disabled) { border-color: var(--border-strong); }
  .cp.open { border-color: var(--accent-strong); }
  .cp:disabled { opacity: 0.55; cursor: not-allowed; }
  .chip { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--border-strong); }
  .code { font-family: var(--font-mono); font-size: 0.9em; }
  .scrim { position: fixed; inset: 0; z-index: 190; }
  .pop {
    position: fixed;
    z-index: 191;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 220px;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px var(--shadow-4);
    animation: pop var(--dur-2) var(--ease-out) both;
    outline: none;
  }
  .area {
    position: relative;
    height: 130px;
    border-radius: 8px;
    background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
    touch-action: none;
    cursor: crosshair;
  }
  .hue {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    touch-action: none;
    cursor: pointer;
  }
  .knob {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px var(--shadow-2);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .hue .knob { top: 50%; }
  .swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .sw { aspect-ratio: 1; border: 1px solid var(--border-strong); border-radius: 6px; cursor: pointer; padding: 0; }
  .sw.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent-strong); }
  .hex { font-family: var(--font-mono); }
  .clear { padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font: inherit; cursor: pointer; }
  .clear:hover { background: var(--accent-soft); }
</style>
