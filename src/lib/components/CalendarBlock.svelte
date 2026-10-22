<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  // Kalender di dalam dokumen: daftar acara untuk rentang waktu yang dipilih sendiri.
  import { goto } from "$app/navigation";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { CalendarDays } from "@lucide/svelte";
  import AgendaList from "$lib/components/AgendaList.svelte";
  import { dayKey, startOfDay } from "$lib/calendar/dates";
  import { rangeLabel, describeRange, resolveRange, type RangeAttrs, type RangeKind } from "$lib/calendar/range";
  import { calendar } from "$lib/stores/calendar.svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import DatePicker from "$lib/ui/DatePicker.svelte";
  import Select from "$lib/ui/Select.svelte";

  let { attrs, update }: { attrs: RangeAttrs; update: (patch: Partial<RangeAttrs>) => void } = $props();

  const options = $derived((["today", "week", "month", "next7", "next14", "next30", "custom"] as RangeKind[]).map((value) => ({ value, label: rangeLabel(value) })));
  const span = $derived(resolveRange(attrs, Date.now(), prefs.value.weekStart));
  const items = $derived(calendar.occurrences(span.from, span.to));

  function pick(range: RangeKind) {
    // Pilihan tanggal sendiri dimulai dari rentang yang sedang ditampilkan.
    if (range === "custom" && !attrs.from) update({ range, from: dayKey(span.from), to: dayKey(startOfDay(span.to)) });
    else update({ range });
  }

  async function join(url: string) {
    if (isTauri()) await openUrl(url).catch(() => {});
    else window.open(url, "_blank", "noopener");
  }
</script>

<div class="block">
  <div class="head">
    <span class="ic"><CalendarDays size={16} /></span>
    <div class="what">
      <b>{tr("Kalender", "Calendar")}</b>
      <small>{describeRange(attrs, prefs.value.weekStart)}</small>
    </div>
    <div class="sel"><Select value={attrs.range} {options} label={tr("Rentang waktu", "Time range")} onchange={pick} /></div>
  </div>
  {#if attrs.range === "custom"}
    <div class="dates">
      <DatePicker value={attrs.from} label={tr("Dari tanggal", "From date")} onchange={(v) => update({ from: v })} />
      <span>{tr("sampai", "to")}</span>
      <DatePicker value={attrs.to} label={tr("Sampai tanggal", "To date")} onchange={(v) => update({ to: v })} />
    </div>
  {/if}
  {#if items.length}
    <AgendaList {items} grouped={span} onjoin={join} />
  {:else}
    <p class="empty">{tr("Tidak ada acara pada periode ini.", "No events in this period.")}</p>
  {/if}
  <button type="button" class="open" onclick={() => goto("/calendar")}>{tr("Buka kalender", "Open calendar")}</button>
</div>

<style>
  .block {
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius);
    box-shadow: var(--lift);
    font-size: 0.95em;
    line-height: 1.4;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    background: var(--tint-4);
    border: var(--edge-w) solid var(--edge);
    border-radius: 8px;
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .what b {
    display: block;
    font-family: var(--font-display);
  }
  .what small,
  .empty {
    color: var(--text-muted);
  }
  .sel {
    width: 190px;
    flex: none;
  }
  .dates {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    color: var(--text-muted);
  }
  .empty {
    margin: 0 0 var(--space-3);
  }
  .open {
    padding: 0;
    border: none;
    background: none;
    color: var(--link);
    cursor: pointer;
  }
  .open:hover {
    text-decoration: underline;
  }
</style>
