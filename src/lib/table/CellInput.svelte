<script lang="ts">
  import Select from "$lib/ui/Select.svelte";
  import DatePicker from "$lib/ui/DatePicker.svelte";
  import type { CellValue, Column } from "./model";

  let { column, value, label, onchange }: { column: Column; value: CellValue | undefined; label: string; onchange: (v: CellValue) => void } = $props();
</script>

{#if column.type === "checkbox"}
  <input class="check" type="checkbox" checked={value === true} aria-label={label} onchange={(e) => onchange(e.currentTarget.checked)} />
{:else if column.type === "select"}
  {@const opt = column.options?.find((o) => o.id === value)}
  <div class="pick" style:--c={opt ? `var(--cat-${opt.color})` : "transparent"} class:set={!!opt}>
    <Select
      class="cell-sel"
      value={(value as string | null) ?? ""}
      label={label}
      options={[{ value: "", label: "—" }, ...(column.options ?? []).map((o) => ({ value: o.id, label: o.label }))]}
      onchange={(v) => onchange(v || null)}
    />
  </div>
{:else if column.type === "number"}
  <input type="text" inputmode="decimal" value={value ?? ""} aria-label={label} onchange={(e) => onchange(e.currentTarget.value)} />
{:else if column.type === "date"}
  <div class="pick"><DatePicker class="cell-sel" value={typeof value === "string" ? value : ""} {label} onchange={(v) => onchange(v)} /></div>
{:else}
  <input type="text" value={typeof value === "string" ? value : ""} aria-label={label} oninput={(e) => onchange(e.currentTarget.value)} />
{/if}

<style>
  input:not(.check) {
    width: 100%;
    border: 0;
    border-radius: 6px;
    background: transparent;
    padding: 6px 8px;
    min-height: 34px;
  }
  input:not(.check):hover {
    background: var(--surface-2);
  }
  input:not(.check):focus {
    background: var(--surface);
    outline: 2px solid var(--accent-strong);
    outline-offset: -2px;
  }
  .check {
    width: 18px;
    height: 18px;
    margin: 8px;
    cursor: pointer;
  }
  .pick :global(.cell-sel) {
    border: 0;
    border-radius: 6px;
    background: transparent;
    padding: 6px 8px;
    min-height: 34px;
  }
  .pick :global(.cell-sel:hover:not(:disabled)) {
    background: var(--surface-2);
  }
  .pick.set :global(.cell-sel) {
    background: color-mix(in srgb, var(--c) 24%, var(--surface));
    border-radius: 99px;
    font-weight: 600;
    padding-inline: 12px;
  }
  .pick.set :global(.cell-sel:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--c) 34%, var(--surface));
  }
</style>
