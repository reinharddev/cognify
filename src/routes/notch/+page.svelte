<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { BatteryMedium, CalendarDays, Check, Clipboard, CloudSun, Droplets, ListChecks, Music2, NotepadText, Paperclip, Timer } from "@lucide/svelte";
  import { notchLink as nl } from "$lib/stores/link.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { ago, clock, countdown, dueLabel } from "$lib/link/format";
  import { checklistDoc, docFromText, plainTextOf } from "$lib/workspace/templates";
  import type { NotchNote } from "$lib/link/types";

  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(() => void nl.refresh());

  const fail = (e: unknown) => (error = typeof e === "string" ? e : e instanceof Error ? e.message : tr("Terjadi kesalahan.", "Something went wrong."));

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  const DOWNLOAD_URL = "https://reinharddev.github.io/cognify-notch/";

  async function openDownload() {
    try {
      if (isTauri()) await openUrl(DOWNLOAD_URL);
      else window.open(DOWNLOAD_URL, "_blank", "noopener");
    } catch {
      error = tr(`Halaman unduhan tidak bisa dibuka. Alamatnya: ${DOWNLOAD_URL}`, `The download page could not be opened. Its address: ${DOWNLOAD_URL}`);
    }
  }

  async function noteToPage(note: NotchNote) {
    const first = note.text.split(/\n/)[0].trim();
    const content = docFromText(note.text);
    const page = await ws.create("doc", null, {
      title: first.length > 60 ? `${first.slice(0, 57)}…` : first,
      content: JSON.stringify(content),
      plainText: plainTextOf(content),
    });
    await goto(`/p/${page.id}`);
  }

  async function todosToPage() {
    const items = (nl.data?.todos ?? []).map((t) => ({ text: t.title, done: t.done }));
    if (!items.length) return;
    const content = checklistDoc(tr("Tugas dari Notch", "Tasks from Notch"), items);
    const page = await ws.create("doc", null, { title: tr("Tugas dari Notch", "Tasks from Notch"), content: JSON.stringify(content), plainText: plainTextOf(content) });
    await goto(`/p/${page.id}`);
  }

  // Daftar panjang diringkas dulu; "Tampilkan semua" membukanya.
  let expanded = $state<Record<string, boolean>>({});
  const LIMIT = { todos: 6, agenda: 6, notes: 5, clipboard: 8 } as const;
  const part = <T,>(key: keyof typeof LIMIT, list: T[]) => (expanded[key] ? list : list.slice(0, LIMIT[key]));
  const hidden = (key: keyof typeof LIMIT, list: unknown[]) => Math.max(0, list.length - LIMIT[key]);

  const d = $derived(nl.data);
  const openTodos = $derived((d?.todos ?? []).filter((t) => !t.done));
  const waterToday = $derived((d?.water?.today ?? []).reduce((sum, s) => sum + s.ml, 0));
  const waterMax = $derived(Math.max(d?.water?.goalMl ?? 0, ...(d?.water?.history ?? []).map((h) => h.ml), waterToday, 1));
</script>

{#snippet outdated()}
  {#if nl.status?.notchOutdated}
    <div class="old">
      <p>
        <strong>{tr(`Cognify Notch versi ${nl.status.notchVersion} belum bisa mengirim data ke Cognify.`, `Cognify Notch version ${nl.status.notchVersion} cannot send data to Cognify yet.`)}</strong>
        {tr(`Dibutuhkan versi ${nl.status.minNotchVersion} atau lebih baru.`, `Version ${nl.status.minNotchVersion} or newer is required.`)}
      </p>
      <ol>
        <li>{tr("Buka Cognify Notch, klik ikonnya di menu bar, lalu pilih", "Open Cognify Notch, click its icon in the menu bar, then choose")} <em>{tr("Periksa pembaruan", "Check for updates")}</em>.</li>
        <li>{tr("Atau unduh versi terbaru dari situsnya.", "Or download the latest version from its website.")}</li>
        <li>{tr("Setelah diperbarui, datanya muncul di sini sendiri. Tidak perlu menghubungkan ulang.", "After updating, its data shows up here on its own. No need to reconnect.")}</li>
      </ol>
      <button class="link" onclick={openDownload}>{tr("Buka halaman unduhan", "Open download page")}</button>
    </div>
  {/if}
{/snippet}

{#snippet more(key: keyof typeof LIMIT, list: unknown[])}
  {#if hidden(key, list) > 0 || expanded[key]}
    <button class="more" onclick={() => (expanded[key] = !expanded[key])}>{expanded[key] ? tr("Ringkas", "Show less") : tr(`Tampilkan semua (${list.length})`, `Show all (${list.length})`)}</button>
  {/if}
{/snippet}

<div class="notch">
  <h1>Cognify Notch</h1>

  {#if !nl.loaded}
    <p class="muted">{tr("Memuat…", "Loading…")}</p>
  {:else if !nl.connected}
    <section class="connect">
      <h2>{tr("Tampilkan data Notch di Cognify", "Show Notch data in Cognify")}</h2>
      {#if nl.status && !nl.status.linkAvailable}
        <p class="warn">{tr("Cognify Notch di sistem ini belum bisa terhubung ke Cognify. Notch tetap berjalan sendiri seperti biasa; hubungannya menyusul di pembaruan berikutnya.", "Cognify Notch on this system cannot connect to Cognify yet. Notch keeps working on its own as usual; the connection follows in a later update.")}</p>
      {/if}
      <p>{tr("Tugas, catatan cepat, agenda, timer, dan lainnya dari Notch bisa dilihat di sini, lalu dijadikan halaman. Hubungannya hanya lewat berkas di komputer ini, tanpa internet, dan kamu bisa memutuskannya kapan saja.", "Tasks, quick notes, agenda, timers, and more from Notch can be viewed here and turned into pages. The link only goes through a file on this computer, with no internet, and you can disconnect at any time.")}</p>
      {#if nl.status && nl.status.linkAvailable && !nl.status.notchInstalled}
        <p class="warn">{tr("Cognify Notch belum terpasang di komputer ini. Pasang dulu, lalu kembali ke sini.", "Cognify Notch is not installed on this computer. Install it first, then come back here.")}</p>
      {/if}
      {@render outdated()}
      {#if nl.status?.linkAvailable}
        <button class="primary" disabled={busy} onclick={() => run(() => nl.connect(false))}>{tr("Hubungkan ke Cognify Notch", "Connect to Cognify Notch")}</button>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
    </section>
  {:else}
    <header class="status">
      <span class="dot" class:on={nl.online}></span>
      <span class="msg">
        {#if nl.status?.needsNewerCognify}{tr("Data Notch memakai format yang lebih baru. Perbarui Cognify untuk melihatnya.", "Notch data uses a newer format. Update Cognify to see it.")}
        {:else if nl.online}{tr("Terhubung. Data diperbarui", "Connected. Data updated")} {ago(nl.status?.lastUpdate, nl.now)}.
        {:else if nl.status?.lastUpdate}{tr("Terhubung, tapi Notch belum berjalan. Data terakhir", "Connected, but Notch is not running. Last data")} {ago(nl.status.lastUpdate, nl.now)}.
        {:else}{tr("Terhubung. Menunggu data pertama dari Notch, pastikan Notch berjalan.", "Connected. Waiting for the first data from Notch; make sure Notch is running.")}{/if}
      </span>
      <label class="switch" title={tr("Bisa memuat hal pribadi, jadi bawaannya mati. Bila dinyalakan, Notch menulis riwayatnya ke satu berkas di komputer ini.", "May contain private things, so it is off by default. When on, Notch writes its history to one file on this computer.")}>
        <span>{tr("Riwayat clipboard", "Clipboard history")}</span>
        <input type="checkbox" role="switch" checked={nl.status?.shareClipboard} disabled={busy} onchange={(e) => run(() => nl.setShareClipboard(e.currentTarget.checked))} />
      </label>
      <button class="link" disabled={busy} onclick={() => run(() => nl.disconnect())}>{tr("Putuskan", "Disconnect")}</button>
    </header>
    {#if error || nl.error}<p class="err">{error ?? nl.error}</p>{/if}

    {#if !d}
      <section class="waiting">
        <h2>{tr("Menunggu data dari Notch", "Waiting for data from Notch")}</h2>
        <p>{tr("Hubungan sudah aktif, tapi Notch belum mengirim apa pun. Pastikan Cognify Notch sedang berjalan (ikonnya ada di menu bar atau tray).", "The link is active, but Notch has not sent anything yet. Make sure Cognify Notch is running (its icon is in the menu bar or tray).")}</p>
        {@render outdated()}
      </section>
    {:else}
      {#if d.now && (d.now.weather || d.now.playing || d.now.battery)}
        <div class="now">
          {#if d.now.weather}<div class="chip"><CloudSun size={16} /><span>{d.now.weather.tempC !== null ? `${Math.round(d.now.weather.tempC)}° ` : ""}{d.now.weather.summary}{d.now.weather.place ? `, ${d.now.weather.place}` : ""}</span></div>{/if}
          {#if d.now.playing}<div class="chip"><Music2 size={16} /><span class="clip">{d.now.playing.title}{d.now.playing.artist ? `, ${d.now.playing.artist}` : ""}</span></div>{/if}
          {#if d.now.battery}<div class="chip"><BatteryMedium size={16} /><span>{d.now.battery.percent}%{d.now.battery.charging ? tr(" (mengisi)", " (charging)") : ""}</span></div>{/if}
        </div>
      {/if}

      <div class="grid">
        <section class="card">
          <div class="head">
            <span class="ic t1"><ListChecks size={15} /></span>
            <h2>{tr("Tugas", "Tasks")}</h2>
            {#if d.todos.length}<span class="count">{openTodos.length} / {d.todos.length}</span>{/if}
            {#if d.todos.length}<button class="link" onclick={todosToPage}>{tr("Jadikan halaman", "Make a page")}</button>{/if}
          </div>
          {#if !d.todos.length}<p class="empty">{tr("Belum ada tugas di Notch.", "No tasks in Notch yet.")}</p>{/if}
          <ul>
            {#each part("todos", d.todos) as t (t.id)}
              <li class:done={t.done}>
                <span class="box">{#if t.done}<Check size={12} strokeWidth={3.5} />{/if}</span>
                <span class="t" title={t.title}>{t.title}</span>
                {#if t.dueAt && !t.done}<small>{dueLabel(t.dueAt, nl.now)}</small>{/if}
              </li>
            {/each}
          </ul>
          {@render more("todos", d.todos)}
        </section>

        <section class="card">
          <div class="head">
            <span class="ic t2"><CalendarDays size={15} /></span>
            <h2>{tr("Agenda hari ini", "Today's agenda")}</h2>
            {#if d.agenda.length}<span class="count">{d.agenda.length}</span>{/if}
          </div>
          {#if !d.agenda.length}<p class="empty">{tr("Tidak ada acara hari ini.", "No events today.")}</p>{/if}
          <ul>
            {#each part("agenda", d.agenda) as e (e.id)}
              <li>
                <span class="time">{e.allDay ? tr("Seharian", "All day") : clock(e.start)}</span>
                <span class="t" title={e.title}>{e.title}</span>
                {#if e.calendar}<small>{e.calendar}</small>{/if}
              </li>
            {/each}
          </ul>
          {@render more("agenda", d.agenda)}
        </section>

        <section class="card">
          <div class="head">
            <span class="ic t3"><NotepadText size={15} /></span>
            <h2>{tr("Catatan cepat", "Quick notes")}</h2>
            {#if d.notes.length}<span class="count">{d.notes.length}</span>{/if}
          </div>
          {#if !d.notes.length}<p class="empty">{tr("Belum ada catatan cepat.", "No quick notes yet.")}</p>{/if}
          <ul>
            {#each part("notes", d.notes) as n (n.id)}
              <li class="note">
                <span class="t" title={n.text}>{n.text}</span>
                <small>{ago(n.createdAt, nl.now)}</small>
                <button class="link" onclick={() => noteToPage(n)}>{tr("Jadikan halaman", "Make a page")}</button>
              </li>
            {/each}
          </ul>
          {@render more("notes", d.notes)}
        </section>

        {#if d.timers.length}
          <section class="card">
            <div class="head">
              <span class="ic t4"><Timer size={15} /></span>
              <h2>Timer</h2>
              <span class="count">{d.timers.length}</span>
            </div>
            <ul>
              {#each d.timers as m (m.id)}
                <li><span class="t" title={m.title}>{m.title}</span><small class="tag" class:run={m.running}>{m.running ? countdown(m.endsAt, nl.now) : tr("berhenti", "stopped")}</small></li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if d.tray.length}
          <section class="card">
            <div class="head">
              <span class="ic t5"><Paperclip size={15} /></span>
              <h2>{tr("Rak file", "File shelf")}</h2>
              <span class="count">{d.tray.length}</span>
            </div>
            <ul>
              {#each d.tray as f (f.id)}
                <li class="file"><span class="t" title={f.name}>{f.name}</span><small class="path" title={f.path}>{f.path}</small></li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if d.water}
          <section class="card">
            <div class="head">
              <span class="ic t6"><Droplets size={15} /></span>
              <h2>{tr("Catatan minum", "Water log")}</h2>
            </div>
            <p class="water"><b>{waterToday} ml</b>{d.water.goalMl ? tr(` dari ${d.water.goalMl} ml`, ` of ${d.water.goalMl} ml`) : ""} {tr("hari ini", "today")}</p>
            {#if d.water.goalMl}
              <div class="meter" role="progressbar" aria-valuenow={waterToday} aria-valuemax={d.water.goalMl} aria-label={tr("Target minum hari ini", "Today's water goal")}><span style:width="{Math.min(100, Math.round((waterToday / d.water.goalMl) * 100))}%"></span></div>
            {/if}
            <div class="bars" aria-label={tr("Minum beberapa hari terakhir", "Water over the last few days")}>
              {#each d.water.history as h (h.date)}
                <div class="bar" title="{h.date}: {h.ml} ml"><span style:height="{Math.round((h.ml / waterMax) * 100)}%"></span></div>
              {/each}
              <div class="bar today" title="Hari ini: {waterToday} ml"><span style:height="{Math.round((waterToday / waterMax) * 100)}%"></span></div>
            </div>
          </section>
        {/if}

        {#if nl.status?.shareClipboard}
          <section class="card wide">
            <div class="head">
              <span class="ic t1"><Clipboard size={15} /></span>
              <h2>{tr("Riwayat clipboard", "Clipboard history")}</h2>
              {#if d.clipboard.length}<span class="count">{d.clipboard.length}</span>{/if}
            </div>
            {#if !d.clipboard.length}<p class="empty">{tr("Belum ada riwayat.", "No history yet.")}</p>{/if}
            <ul class="clips">
              {#each part("clipboard", d.clipboard) as c (c.id)}
                <li><span class="t clip" title={c.text}>{c.text}</span><small>{ago(c.at, nl.now)}</small></li>
              {/each}
            </ul>
            {@render more("clipboard", d.clipboard)}
          </section>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .notch {
    max-width: 960px;
    margin: 0 auto;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 2em;
    letter-spacing: -0.02em;
    margin-bottom: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .muted,
  small {
    color: var(--text-muted);
  }
  small {
    flex: none;
    font-size: 0.85em;
  }

  /* Kartu */
  .card,
  .status,
  .connect,
  .waiting {
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-lg);
    box-shadow: var(--lift);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .card {
    padding: var(--space-3) var(--space-4) var(--space-3);
    min-width: 0;
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .head .link {
    margin-left: auto;
    font-size: 0.9em;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border: var(--edge-w) solid var(--edge);
    border-radius: 8px;
  }
  .t1 { background: var(--tint-1); }
  .t2 { background: var(--tint-5); }
  .t3 { background: var(--tint-4); }
  .t4 { background: var(--tint-2); }
  .t5 { background: var(--tint-3); }
  .t6 { background: var(--tint-6); }
  .count {
    padding: 0 8px;
    background: var(--surface-2);
    border-radius: 99px;
    color: var(--text-muted);
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  /* Status */
  .status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
  }
  .msg {
    flex: 1;
    min-width: 200px;
    color: var(--text-muted);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    flex: none;
  }
  .dot.on {
    background: var(--ok);
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: 0.92em;
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--link);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }

  /* Info singkat: cuaca, lagu, baterai */
  .now {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 4px 12px;
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
  }
  .chip .clip {
    max-width: 280px;
  }

  /* Daftar */
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  li:first-child {
    border-top: none;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    width: 4.8em;
    flex: none;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  /* Catatan cepat boleh dua baris sebelum dipotong. */
  .note .t {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    word-break: break-word;
  }
  .note .link {
    flex: none;
    font-size: 0.9em;
  }
  .file .path {
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    padding: 0 8px;
    background: var(--surface-2);
    border-radius: 99px;
  }
  .tag.run {
    background: var(--tint-3);
    color: var(--text);
  }
  .box {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: var(--edge-w) solid var(--edge);
    border-radius: 5px;
    flex: none;
    align-self: center;
  }
  li.done .t {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  li.done .box {
    background: var(--kind-table);
    color: var(--surface);
  }
  .more {
    width: 100%;
    margin-top: var(--space-2);
    padding: 6px;
    background: var(--surface-2);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .more:hover {
    color: var(--text);
  }

  /* Minum */
  .water {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
  }
  .water b {
    color: var(--text);
    font-size: 1.3em;
  }
  .meter {
    height: 10px;
    margin-bottom: var(--space-3);
    background: var(--surface-2);
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--tint-5);
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 64px;
  }
  .bar {
    flex: 1;
    max-width: 36px;
    height: 100%;
    display: flex;
    align-items: flex-end;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    width: 100%;
    background: var(--cat-1);
  }
  .bar.today span {
    background: var(--accent);
  }

  /* Belum terhubung, menunggu, atau versi lama */
  .connect,
  .waiting {
    max-width: 560px;
    padding: var(--space-5, 20px) var(--space-6);
  }
  .connect h2,
  .waiting h2 {
    margin-bottom: var(--space-2);
    font-family: var(--font-display);
    font-size: 1.2em;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }
  .connect p,
  .waiting p {
    color: var(--text-muted);
  }
  .old {
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border: var(--edge-w) dashed var(--edge);
    border-radius: var(--radius-sm);
  }
  .old p {
    margin: 0 0 var(--space-2);
    color: var(--text);
  }
  .old li {
    display: list-item;
    padding: 2px 0;
    border: none;
  }
  .old ol {
    margin: 0 0 var(--space-2);
    padding-left: 1.3em;
    color: var(--text-muted);
  }
  .primary {
    padding: 8px 16px;
    background: var(--accent);
    color: var(--accent-contrast);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-sm);
    box-shadow: var(--lift);
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .warn {
    color: var(--warn);
  }
  .err {
    color: var(--danger);
  }
</style>
