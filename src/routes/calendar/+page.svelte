<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ChevronLeft, ChevronRight, Plus, Video } from "@lucide/svelte";
  import AgendaList from "$lib/components/AgendaList.svelte";
  import CalendarSources from "$lib/components/CalendarSources.svelte";
  import EventForm from "$lib/components/EventForm.svelte";
  import { monthName, addDays, clock, longDate, monthGrid, sameDay, startOfDay, weekdayLabels } from "$lib/calendar/dates";
  import { prefs } from "$lib/stores/prefs.svelte";
  import type { CalEvent, Occurrence } from "$lib/calendar/types";
  import { calendar } from "$lib/stores/calendar.svelte";

  const today = startOfDay(Date.now());
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth());
  let selected = $state(today);
  let form = $state<{ event: CalEvent | null; day: number; endDay?: number } | null>(null);
  // Seret di kalender atau Shift+klik untuk memilih beberapa hari sekaligus.
  let anchor = $state<number | null>(null);
  let hover = $state<number | null>(null);
  const span = $derived(anchor !== null && hover !== null ? [Math.min(anchor, hover), Math.max(anchor, hover)] : null);
  const inSpan = (ms: number) => !!span && span[0] !== span[1] && ms >= span[0] && ms <= span[1];

  function press(e: PointerEvent, ms: number) {
    if (e.button !== 0) return;
    if (e.shiftKey && selected !== ms) {
      form = { event: null, day: Math.min(selected, ms), endDay: Math.max(selected, ms) };
      return;
    }
    anchor = hover = ms;
  }

  function release() {
    if (anchor !== null && span && span[0] !== span[1]) {
      selected = span[0];
      form = { event: null, day: span[0], endDay: span[1] };
    }
    anchor = hover = null;
  }

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

<svelte:window onpointerup={release} onpointercancel={() => (anchor = hover = null)} />

<div class="cal">
  <header>
    <h1>{monthName(month)} {year}</h1>
    <div class="nav">
      <button aria-label={tr("Bulan sebelumnya", "Previous month")} onclick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button onclick={goToday}>{tr("Hari ini", "Today")}</button>
      <button aria-label={tr("Bulan berikutnya", "Next month")} onclick={() => shift(1)}><ChevronRight size={16} /></button>
    </div>
    <button class="primary" onclick={() => (form = { event: null, day: selected })}><Plus size={15} /> {tr("Acara baru", "New event")}</button>
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
        class:range={inSpan(cell.ms)}
        onpointerdown={(e) => press(e, cell.ms)}
        onpointerenter={() => anchor !== null && (hover = cell.ms)}
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
      <p class="muted">{tr("Tidak ada acara.", "No events.")} <button class="link" onclick={() => (form = { event: null, day: selected })}>{tr("Tambah acara", "Add event")}</button></p>
    {/if}
    <AgendaList items={dayList} onedit={edit} onjoin={join} />
  </section>

  <CalendarSources />
</div>

{#if form}
  {#key `${form.event?.id ?? "baru"}:${form.day}:${form.endDay ?? ""}`}
    <EventForm event={form.event} day={form.day} endDay={form.endDay} onclose={() => (form = null)} />
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
    font-family: var(--font-display);
    font-size: 1.9em;
    letter-spacing: -0.02em;
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
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-sm);
    box-shadow: var(--lift);
    cursor: pointer;
    transition: transform var(--dur-1), box-shadow var(--dur-1);
  }
  .nav button:hover,
  .primary:hover {
    transform: translate(var(--hop), var(--hop));
    box-shadow: var(--lift-lg);
  }
  .nav button:active,
  .primary:active {
    transform: translate(var(--press), var(--press));
    box-shadow: none;
  }
  .primary {
    background: var(--accent);
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
    font-size: 0.78em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border: var(--edge-w) solid var(--edge);
    border-right: none;
    border-bottom: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--lift-lg);
    overflow: hidden;
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
  .cell.range {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 var(--edge-w) var(--edge);
  }
  .cell {
    user-select: none;
  }
  .cell.sel {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 var(--edge-w) var(--edge);
  }
  .num {
    align-self: flex-start;
    min-width: 1.7em;
    padding: 1px 4px;
    border: var(--edge-w) solid transparent;
    border-radius: 99px;
    font-size: 0.9em;
    text-align: center;
  }
  .today .num {
    background: var(--accent);
    border-color: var(--edge);
    color: var(--accent-contrast);
    font-weight: 700;
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
  .chip i {
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
    font-family: var(--font-display);
    font-size: 1.25em;
    margin-bottom: var(--space-2);
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
