<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { untrack } from "svelte";
  import { X } from "@lucide/svelte";
  import Select from "$lib/ui/Select.svelte";
  import DatePicker from "$lib/ui/DatePicker.svelte";
  import TimePicker from "$lib/ui/TimePicker.svelte";
  import { dayKey, fromInputs, inputDate, inputTime, parseDayKey } from "$lib/calendar/dates";
  import { eventStartMs } from "$lib/calendar/expand";
  import { ensureNotificationPermission } from "$lib/calendar/reminders";
  import type { CalEvent, EventInput, Repeat } from "$lib/calendar/types";
  import { calendar } from "$lib/stores/calendar.svelte";

  let {
    event: eventProp = null,
    day: dayProp,
    endDay: endDayProp,
    onclose,
  }: { event?: CalEvent | null; day: number; /** Hari terakhir bila beberapa hari dipilih sekaligus. */ endDay?: number; onclose: () => void } = $props();

  // Formulir dibuka dengan nilai awal dari acara atau hari yang dipilih; induknya membuatnya baru
  // setiap kali dibuka, jadi nilai awal cukup dibaca sekali.
  const event = untrack(() => eventProp);
  const day = untrack(() => dayProp);
  const endDay = untrack(() => endDayProp);

  const REPEATS = $derived<{ id: Repeat; label: string }[]>([
    { id: "none", label: tr("Tidak berulang", "Does not repeat") },
    { id: "daily", label: tr("Setiap hari", "Every day") },
    { id: "weekly", label: tr("Setiap minggu", "Every week") },
    { id: "monthly", label: tr("Setiap bulan", "Every month") },
    { id: "yearly", label: tr("Setiap tahun", "Every year") },
  ]);
  const REMINDERS = $derived<{ min: number | null; label: string }[]>([
    { min: null, label: tr("Tanpa pengingat", "No reminder") },
    { min: 0, label: tr("Saat acara mulai", "When the event starts") },
    { min: 5, label: tr("5 menit sebelumnya", "5 minutes before") },
    { min: 15, label: tr("15 menit sebelumnya", "15 minutes before") },
    { min: 30, label: tr("30 menit sebelumnya", "30 minutes before") },
    { min: 60, label: tr("1 jam sebelumnya", "1 hour before") },
    { min: 1440, label: tr("1 hari sebelumnya", "1 day before") },
  ]);
  // Warna disimpan sebagai hex; nilainya sama dengan --cat-* tema terang dan terbaca di tema gelap juga.
  const COLORS = ["#7e6cf0", "#328ab4", "#ab7a18", "#db508b", "#379268", "#df5524"];

  // Nilai awal dari acara yang diubah, atau dari hari yang dipilih (pukul 09.00 sampai 10.00).
  const startMs = event ? (eventStartMs(event) ?? day) : day + 9 * 3_600_000;
  const endMs = event?.end ? (event.allDay ? parseDayKey(event.end) : Date.parse(event.end)) : null;

  let title = $state(event?.title ?? "");
  let allDay = $state(event?.allDay ?? endDay !== undefined);
  let startDate = $state(inputDate(startMs));
  let startTime = $state(event && !event.allDay ? inputTime(startMs) : "09:00");
  let endDate = $state(endMs ? inputDate(endMs) : inputDate(endDay ?? startMs));
  let endTime = $state(endMs && !event?.allDay ? inputTime(endMs) : event ? "" : "10:00");
  let repeat = $state<Repeat>(event?.repeat ?? "none");
  let repeatUntil = $state(event?.repeatUntil ?? "");
  let remindMin = $state<number | null>(event?.remindMin ?? null);
  let notes = $state(event?.notes ?? "");
  let color = $state<string | null>(event?.color ?? null);

  let error = $state<string | null>(null);
  let busy = $state(false);

  function build(): EventInput | string {
    if (!title.trim()) return tr("Beri judul pada acara.", "Give the event a title.");
    if (allDay) {
      const s = parseDayKey(startDate);
      if (s === null) return tr("Tanggal mulai tidak sah.", "The start date is not valid.");
      const e = endDate ? parseDayKey(endDate) : null;
      if (endDate && e === null) return tr("Tanggal selesai tidak sah.", "The end date is not valid.");
      if (e !== null && e < s) return tr("Acara tidak boleh selesai sebelum mulai.", "An event cannot end before it starts.");
      return {
        title, notes, allDay: true, start: dayKey(s), end: e !== null && e > s ? dayKey(e) : null, repeat, color,
        repeatUntil: repeat !== "none" && repeatUntil ? repeatUntil : null, remindMin,
      };
    }
    const s = fromInputs(startDate, startTime);
    if (s === null) return tr("Waktu mulai tidak sah.", "The start time is not valid.");
    let e: number | null = null;
    if (endTime) {
      e = fromInputs(endDate || startDate, endTime);
      if (e === null) return tr("Waktu selesai tidak sah.", "The end time is not valid.");
      if (e < s) return tr("Acara tidak boleh selesai sebelum mulai.", "An event cannot end before it starts.");
    }
    return {
      title, notes, allDay: false, start: new Date(s).toISOString(), end: e === null ? null : new Date(e).toISOString(), repeat, color,
      repeatUntil: repeat !== "none" && repeatUntil ? repeatUntil : null, remindMin,
    };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const input = build();
    if (typeof input === "string") return void (error = input);
    busy = true;
    error = null;
    try {
      if (input.remindMin !== null && input.remindMin !== undefined) await ensureNotificationPermission();
      await calendar.saveEvent(input, event?.id);
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : tr("Acara gagal disimpan.", "The event could not be saved.");
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!event) return;
    if (!(await dialog.confirm(tr(`Hapus "${event.title}"?`, `Delete "${event.title}"?`), { detail: event.repeat !== "none" ? tr("Semua pengulangannya ikut terhapus.", "All its repeats are deleted too.") : undefined, danger: true }))) return;
    try {
      await calendar.deleteEvent(event.id);
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : tr("Acara gagal dihapus.", "The event could not be deleted.");
    }
  }

  // Menggeser tanggal mulai membawa tanggal selesai bila keduanya tadinya sama.
  let lastStart = untrack(() => startDate);
  $effect(() => {
    if (startDate !== lastStart) {
      if (endDate === lastStart || endDate < startDate) endDate = startDate;
      lastStart = startDate;
    }
  });

  const focus = (node: HTMLInputElement) => node.focus();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" role="presentation" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="box" role="dialog" aria-label={event ? tr("Ubah acara", "Edit event") : tr("Acara baru", "New event")} tabindex="-1" onclick={(e) => e.stopPropagation()}>
  <form onsubmit={submit}>
    <header>
      <h2>{event ? tr("Ubah acara", "Edit event") : tr("Acara baru", "New event")}</h2>
      <button type="button" class="x" aria-label={tr("Tutup", "Close")} onclick={onclose}><X size={16} /></button>
    </header>

    <input class="title" use:focus bind:value={title} placeholder={tr("Judul acara", "Event title")} aria-label={tr("Judul acara", "Event title")} maxlength="300" />

    <label class="check"><input type="checkbox" bind:checked={allDay} /> {tr("Sehari penuh", "All day")}</label>

    <div class="row">
      <div class="fld">{tr("Mulai", "Starts")} <DatePicker bind:value={startDate} label={tr("Tanggal mulai", "Start date")} /></div>
      {#if !allDay}<div class="fld">{tr("Jam", "Time")} <TimePicker bind:value={startTime} label={tr("Jam mulai", "Start time")} /></div>{/if}
    </div>
    <div class="row">
      <div class="fld">{tr("Selesai", "Ends")} <DatePicker bind:value={endDate} label={tr("Tanggal selesai", "End date")} /></div>
      {#if !allDay}<div class="fld">{tr("Jam", "Time")} <TimePicker bind:value={endTime} label={tr("Jam selesai", "End time")} /></div>{/if}
    </div>

    <div class="row">
      <div class="fld">Pengulangan
        <Select bind:value={repeat} label={tr("Pengulangan", "Repeat")} options={REPEATS.map((r) => ({ value: r.id, label: r.label }))} />
      </div>
      {#if repeat !== "none"}<div class="fld">{tr("Sampai tanggal", "Until")} <DatePicker bind:value={repeatUntil} label={tr("Sampai tanggal", "Until")} /></div>{/if}
    </div>

    <div class="fld">Pengingat
      <Select bind:value={remindMin} label={tr("Pengingat", "Reminder")} options={REMINDERS.map((r) => ({ value: r.min, label: r.label }))} />
    </div>

    <label>{tr("Catatan", "Notes")} <textarea bind:value={notes} rows="3"></textarea></label>

    <div class="colors" role="radiogroup" aria-label={tr("Warna", "Color")}>
      <button type="button" class="swatch none" class:on={color === null} aria-label={tr("Warna bawaan", "Default color")} onclick={() => (color = null)}></button>
      {#each COLORS as c (c)}
        <button type="button" class="swatch" class:on={color === c} style:background={c} aria-label="{tr("Warna", "Color")} {c}" onclick={() => (color = c)}></button>
      {/each}
    </div>

    {#if event && event.repeat !== "none"}<p class="hint">{tr("Mengubah acara ini mengubah semua pengulangannya.", "Changing this event changes all its repeats.")}</p>{/if}
    {#if error}<p class="err">{error}</p>{/if}

    <footer>
      {#if event}<button type="button" class="danger" onclick={remove}>{tr("Hapus", "Delete")}</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>{tr("Batal", "Cancel")}</button>
      <button class="primary" disabled={busy}>{tr("Simpan", "Save")}</button>
    </footer>
  </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    padding: var(--space-4);
  }
  .box {
    width: min(460px, 100%);
    max-height: 92vh;
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 1.1em;
  }
  .x {
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    border: none;
    background: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface-2);
  }
  .title {
    font-size: 1.15em;
    font-weight: 600;
  }
  label,
  .fld {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
    color: var(--text-muted);
    flex: 1;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  .check input {
    width: auto;
  }
  .row {
    display: flex;
    gap: var(--space-3);
  }
  .colors {
    display: flex;
    gap: 8px;
  }
  .swatch {
    width: 1.6em;
    height: 1.6em;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch.none {
    background: var(--surface-2);
    border: 1px dashed var(--border);
  }
  .swatch.on {
    border-color: var(--text);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
  footer {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  footer button {
    padding: 6px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  footer .primary {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  footer .danger {
    color: var(--danger);
  }
</style>
