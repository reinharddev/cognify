<script lang="ts">
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ChevronLeft, ChevronRight, Plus, Video } from "@lucide/svelte";
  import CalendarSources from "$lib/components/CalendarSources.svelte";
  import EventForm from "$lib/components/EventForm.svelte";
  import { MONTHS, addDays, clock, longDate, monthGrid, sameDay, startOfDay, weekdayLabels } from "$lib/calendar/dates";
  import { prefs } from "$lib/stores/prefs.svelte";
  import type { CalEvent, Occurrence } from "$lib/calendar/types";
  import { calendar } from "$lib/stores/calendar.svelte";

  const today = startOfDay(Date.now());
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth());
  let selected = $state(today);
  let form = $state<{ event: CalEvent | null; day: number } | null>(null);

  const grid = $derived(monthGrid(year, month, prefs.value.weekStart));
  const range = $derived({ from: grid[0].ms, to: addDays(grid[41].ms, 1) - 1 });
  // Dibaca ulang saat acara, langganan, atau data Notch berubah (store memakai state).
  const occurrences = $derived(calendar.occurrences(range.from, range.to));
  const byDay = $derived.by(() => {
    const map = new Map<number, Occurrence[]>();
    for (const cell of grid) {
      const dayStart = cell.ms;
      const dayEnd = addDays(dayStart, 1);
      // Akhir acara eksklusif: acara yang selesai tepat tengah malam tidak ikut hari berikutnya.
      map.set(dayStart, occurrences.filter((o) => o.start < dayEnd && (o.end !== null ? o.end > dayStart : o.start >= dayStart)));
    }
    return map;
  });
  const dayList = $derived(byDay.get(selected) ?? []);

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    year = d.getFullYear();
    month = d.getMonth();
  }

  function goToday() {
    year = new Date().getFullYear();
    month = new Date().getMonth();
    selected = today;
  }

  const colorOf = (o: Occurrence) => o.color ?? (o.origin === "local" ? "var(--accent-strong)" : o.origin === "ics" ? "var(--cat-1)" : "var(--text-muted)");

  async function join(url: string) {
    if (isTauri()) await openUrl(url).catch(() => {});
    else window.open(url, "_blank", "noopener");
  }

  function edit(o: Occurrence) {
    const ev = calendar.events.find((e) => e.id === o.eventId);
    if (ev) form = { event: ev, day: selected };
  }
</script>

<div class="cal">
  <header>
    <h1>{MONTHS[month]} {year}</h1>
    <div class="nav">
      <button aria-label="Bulan sebelumnya" onclick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button onclick={goToday}>Hari ini</button>
      <button aria-label="Bulan berikutnya" onclick={() => shift(1)}><ChevronRight size={16} /></button>
    </div>
    <button class="primary" onclick={() => (form = { event: null, day: selected })}><Plus size={15} /> Acara baru</button>
  </header>

  {#if calendar.error}<p class="err">{calendar.error}</p>{/if}

  <div class="weekdays">{#each weekdayLabels(prefs.value.weekStart) as w (w)}<span>{w}</span>{/each}</div>
  <div class="grid">
    {#each grid as cell (cell.ms)}
      {@const list = byDay.get(cell.ms) ?? []}
      <button
        class="cell"
        class:out={!cell.inMonth}
        class:today={cell.ms === today}
        class:sel={sameDay(cell.ms, selected)}
        onclick={() => (selected = cell.ms)}
        ondblclick={() => (form = { event: null, day: cell.ms })}
        aria-label="{longDate(cell.ms)}, {list.length} acara"
      >
        <span class="num">{new Date(cell.ms).getDate()}</span>
        {#each list.slice(0, 3) as o (o.key)}
          <span class="chip" style:--c={colorOf(o)}><i></i>{o.title}</span>
        {/each}
        {#if list.length > 3}<span class="more">+{list.length - 3} lagi</span>{/if}
      </button>
    {/each}
  </div>

  <section class="day">
    <h2>{longDate(selected)}</h2>
    {#if !dayList.length}
      <p class="muted">Tidak ada acara. <button class="link" onclick={() => (form = { event: null, day: selected })}>Tambah acara</button></p>
    {/if}
    <ul>
      {#each dayList as o (o.key)}
        <li style:--c={colorOf(o)}>
          <i></i>
          <span class="time">{o.allDay ? "Seharian" : clock(o.start) + (o.end ? ` sampai ${clock(o.end)}` : "")}</span>
          <span class="t">{o.title}{#if o.calendar}<small>{o.calendar}</small>{/if}</span>
          {#if o.meeting}<button class="link" onclick={() => join(o.meeting!)}><Video size={14} /> Gabung</button>{/if}
          {#if o.eventId}<button class="link" onclick={() => edit(o)}>Ubah</button>{/if}
        </li>
      {/each}
    </ul>
  </section>

  <CalendarSources />
</div>

{#if form}
  {#key `${form.event?.id ?? "baru"}:${form.day}`}
    <EventForm event={form.event} day={form.day} onclose={() => (form = null)} />
  {/key}
{/if}

<style>
  .cal {
    max-width: 960px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  h1 {
    font-size: 1.7em;
    flex: 1;
  }
  .nav {
    display: flex;
    gap: 4px;
  }
  .nav button,
  .primary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .nav button:hover {
    border-color: var(--accent-strong);
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  @media (max-width: 640px) {
    header {
      flex-wrap: wrap;
    }
    .cell {
      min-height: 4.4em;
      padding: 2px 3px;
    }
  }
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    padding: 0 2px 6px;
    color: var(--text-muted);
    font-size: 0.85em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 6.2em;
    padding: 4px 5px;
    background: var(--surface);
    border: none;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .cell:hover {
    background: var(--accent-soft);
  }
  .cell.out {
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .cell.sel {
    outline: 2px solid var(--accent-strong);
    outline-offset: -2px;
  }
  .num {
    align-self: flex-start;
    min-width: 1.7em;
    padding: 1px 4px;
    border-radius: 99px;
    font-size: 0.9em;
    text-align: center;
  }
  .today .num {
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chip i,
  li i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }
  .more {
    font-size: 0.78em;
    color: var(--text-muted);
  }
  .day {
    margin-top: var(--space-6);
  }
  .day h2 {
    font-size: 1.05em;
    margin-bottom: var(--space-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }
  .time {
    width: 9.5em;
    flex: none;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .t {
    flex: 1;
    min-width: 0;
  }
  small {
    display: block;
    color: var(--text-muted);
  }
  .link {
    display: inline-flex;
    align-items: center;
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
  .muted {
    color: var(--text-muted);
  }
  .err {
    color: var(--danger);
  }
</style>
