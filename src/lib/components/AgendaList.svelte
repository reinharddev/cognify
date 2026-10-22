<script lang="ts">
  import { dateLocale, tr } from "$lib/i18n.svelte";
  // Daftar acara bergaya situs: garis warna di kiri, judul tebal, waktu di bawahnya.
  import { Video } from "@lucide/svelte";
  import { addDays, clock, startOfDay } from "$lib/calendar/dates";
  import type { Occurrence } from "$lib/calendar/types";

  let {
    items,
    grouped = null,
    onedit,
    onjoin,
  }: {
    items: Occurrence[];
    /** Bila diisi, acara dikelompokkan per hari di dalam rentang ini. */
    grouped?: { from: number; to: number } | null;
    onedit?: (o: Occurrence) => void;
    onjoin?: (url: string) => void;
  } = $props();

  const colorOf = (o: Occurrence) => o.color ?? (o.origin === "local" ? "var(--accent-strong)" : o.origin === "ics" ? "var(--cat-1)" : "var(--text-muted)");
  const timeOf = (o: Occurrence) => (o.allDay ? tr("Seharian", "All day") : clock(o.start) + (o.end ? tr(` sampai ${clock(o.end)}`, ` to ${clock(o.end)}`) : ""));
  const dayName = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long" });

  const days = $derived.by(() => {
    if (!grouped) return [];
    const out: { ms: number; items: Occurrence[] }[] = [];
    for (let d = startOfDay(grouped.from); d <= grouped.to && out.length < 366; d = addDays(d, 1)) {
      const next = addDays(d, 1);
      const list = items.filter((o) => o.start < next && (o.end !== null ? o.end > d : o.start >= d));
      if (list.length) out.push({ ms: d, items: list });
    }
    return out;
  });
</script>

{#snippet row(o: Occurrence)}
  <div class="row" style:--c={colorOf(o)}>
    <i></i>
    <span class="t">
      <b>{o.title}</b>
      <small>{timeOf(o)}{#if o.calendar} · {o.calendar}{/if}</small>
    </span>
    {#if o.meeting && onjoin}<button type="button" class="link" onclick={() => onjoin(o.meeting!)}><Video size={14} /> Gabung</button>{/if}
    {#if o.eventId && onedit}<button type="button" class="link" onclick={() => onedit(o)}>{tr("Ubah", "Edit")}</button>{/if}
  </div>
{/snippet}

{#if grouped}
  {#each days as d (d.ms)}
    <div class="day">{dayName(d.ms)}</div>
    <div class="list">{#each d.items as o (o.key)}{@render row(o)}{/each}</div>
  {/each}
{:else}
  <div class="list">{#each items as o (o.key)}{@render row(o)}{/each}</div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    padding: 0;
  }
  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-3);
  }
  i {
    flex: none;
    width: 5px;
    border-radius: 3px;
    background: var(--c);
  }
  .t {
    flex: 1;
    min-width: 0;
    padding: 1px 0;
  }
  b {
    display: block;
    font-size: 1.05em;
    font-weight: 700;
  }
  small {
    display: block;
    color: var(--text-muted);
    font-size: 0.92em;
  }
  .day {
    margin: var(--space-3) 0 var(--space-2);
    color: var(--text-muted);
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .day:first-child {
    margin-top: 0;
  }
  .link {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--link);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
