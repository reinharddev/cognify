<script lang="ts">
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
    onclose,
  }: { event?: CalEvent | null; day: number; onclose: () => void } = $props();

  // Formulir dibuka dengan nilai awal dari acara atau hari yang dipilih; induknya membuatnya baru
  // setiap kali dibuka, jadi nilai awal cukup dibaca sekali.
  const event = untrack(() => eventProp);
  const day = untrack(() => dayProp);

  const REPEATS: { id: Repeat; label: string }[] = [
    { id: "none", label: "Tidak berulang" },
    { id: "daily", label: "Setiap hari" },
    { id: "weekly", label: "Setiap minggu" },
    { id: "monthly", label: "Setiap bulan" },
    { id: "yearly", label: "Setiap tahun" },
  ];
  const REMINDERS: { min: number | null; label: string }[] = [
    { min: null, label: "Tanpa pengingat" },
    { min: 0, label: "Saat acara mulai" },
    { min: 5, label: "5 menit sebelumnya" },
    { min: 15, label: "15 menit sebelumnya" },
    { min: 30, label: "30 menit sebelumnya" },
    { min: 60, label: "1 jam sebelumnya" },
    { min: 1440, label: "1 hari sebelumnya" },
  ];
  // Warna disimpan sebagai hex; nilainya sama dengan --cat-* tema terang dan terbaca di tema gelap juga.
  const COLORS = ["#7e6cf0", "#3592be", "#b27f19", "#dd5b92", "#39986c", "#e26336"];

  // Nilai awal dari acara yang diubah, atau dari hari yang dipilih (pukul 09.00 sampai 10.00).
  const startMs = event ? (eventStartMs(event) ?? day) : day + 9 * 3_600_000;
  const endMs = event?.end ? (event.allDay ? parseDayKey(event.end) : Date.parse(event.end)) : null;

  let title = $state(event?.title ?? "");
  let allDay = $state(event?.allDay ?? false);
  let startDate = $state(inputDate(startMs));
  let startTime = $state(event && !event.allDay ? inputTime(startMs) : "09:00");
  let endDate = $state(endMs ? inputDate(endMs) : inputDate(startMs));
  let endTime = $state(endMs && !event?.allDay ? inputTime(endMs) : event ? "" : "10:00");
  let repeat = $state<Repeat>(event?.repeat ?? "none");
  let repeatUntil = $state(event?.repeatUntil ?? "");
  let remindMin = $state<number | null>(event?.remindMin ?? null);
  let notes = $state(event?.notes ?? "");
  let color = $state<string | null>(event?.color ?? null);

  let error = $state<string | null>(null);
  let busy = $state(false);

  function build(): EventInput | string {
    if (!title.trim()) return "Beri judul pada acara.";
    if (allDay) {
      const s = parseDayKey(startDate);
      if (s === null) return "Tanggal mulai tidak sah.";
      const e = endDate ? parseDayKey(endDate) : null;
      if (endDate && e === null) return "Tanggal selesai tidak sah.";
      if (e !== null && e < s) return "Acara tidak boleh selesai sebelum mulai.";
      return {
        title, notes, allDay: true, start: dayKey(s), end: e !== null && e > s ? dayKey(e) : null, repeat, color,
        repeatUntil: repeat !== "none" && repeatUntil ? repeatUntil : null, remindMin,
      };
    }
    const s = fromInputs(startDate, startTime);
    if (s === null) return "Waktu mulai tidak sah.";
    let e: number | null = null;
    if (endTime) {
      e = fromInputs(endDate || startDate, endTime);
      if (e === null) return "Waktu selesai tidak sah.";
      if (e < s) return "Acara tidak boleh selesai sebelum mulai.";
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
      error = err instanceof Error ? err.message : "Acara gagal disimpan.";
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!event) return;
    if (!(await dialog.confirm(`Hapus "${event.title}"?`, { detail: event.repeat !== "none" ? "Semua pengulangannya ikut terhapus." : undefined, danger: true }))) return;
    try {
      await calendar.deleteEvent(event.id);
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : "Acara gagal dihapus.";
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
  <div class="box" role="dialog" aria-label={event ? "Ubah acara" : "Acara baru"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
  <form onsubmit={submit}>
    <header>
      <h2>{event ? "Ubah acara" : "Acara baru"}</h2>
      <button type="button" class="x" aria-label="Tutup" onclick={onclose}><X size={16} /></button>
    </header>

    <input class="title" use:focus bind:value={title} placeholder="Judul acara" aria-label="Judul acara" maxlength="300" />

    <label class="check"><input type="checkbox" bind:checked={allDay} /> Sehari penuh</label>

    <div class="row">
      <div class="fld">Mulai <DatePicker bind:value={startDate} label="Tanggal mulai" /></div>
      {#if !allDay}<div class="fld">Jam <TimePicker bind:value={startTime} label="Jam mulai" /></div>{/if}
    </div>
    <div class="row">
      <div class="fld">Selesai <DatePicker bind:value={endDate} label="Tanggal selesai" /></div>
      {#if !allDay}<div class="fld">Jam <TimePicker bind:value={endTime} label="Jam selesai" /></div>{/if}
    </div>

    <div class="row">
      <div class="fld">Pengulangan
        <Select bind:value={repeat} label="Pengulangan" options={REPEATS.map((r) => ({ value: r.id, label: r.label }))} />
      </div>
      {#if repeat !== "none"}<div class="fld">Sampai tanggal <DatePicker bind:value={repeatUntil} label="Sampai tanggal" /></div>{/if}
    </div>

    <div class="fld">Pengingat
      <Select bind:value={remindMin} label="Pengingat" options={REMINDERS.map((r) => ({ value: r.min, label: r.label }))} />
    </div>

    <label>Catatan <textarea bind:value={notes} rows="3"></textarea></label>

    <div class="colors" role="radiogroup" aria-label="Warna">
      <button type="button" class="swatch none" class:on={color === null} aria-label="Warna bawaan" onclick={() => (color = null)}></button>
      {#each COLORS as c (c)}
        <button type="button" class="swatch" class:on={color === c} style:background={c} aria-label="Warna {c}" onclick={() => (color = c)}></button>
      {/each}
    </div>

    {#if event && event.repeat !== "none"}<p class="hint">Mengubah acara ini mengubah semua pengulangannya.</p>{/if}
    {#if error}<p class="err">{error}</p>{/if}

    <footer>
      {#if event}<button type="button" class="danger" onclick={remove}>Hapus</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>Batal</button>
      <button class="primary" disabled={busy}>Simpan</button>
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
