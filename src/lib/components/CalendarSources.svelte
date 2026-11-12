<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { Download, FileUp, RefreshCw, Trash2, X } from "@lucide/svelte";
  import Select from "$lib/ui/Select.svelte";
  import { ago } from "$lib/link/format";
  import { calendar } from "$lib/stores/calendar.svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { school } from "$lib/stores/school.svelte";

  let name = $state("");
  let url = $state("");
  let fileName = $state("");
  let fileText = $state("");
  let busy = $state(false);
  let importing = $state(false);
  let tab = $state<"url" | "file">("url");
  let error = $state<string | null>(null);

  async function addUrl(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await calendar.addSource({ name, kind: "url", url });
      name = url = "";
      importing = false;
    } catch (err) {
      error = err instanceof Error ? err.message : tr("Kalender tidak bisa ditambahkan.", "The calendar could not be added.");
    } finally {
      busy = false;
    }
  }

  let fileInput = $state<HTMLInputElement>();

  async function pickFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    error = null;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return void (error = "Berkas terlalu besar (maksimal 5 MB).");
    fileName = file.name;
    fileText = await file.text();
    if (!name.trim()) name = file.name.replace(/\.ics$/i, "");
  }

  async function addFile() {
    busy = true;
    error = null;
    try {
      await calendar.addSource({ name, kind: "file", ics: fileText });
      name = fileName = fileText = "";
      importing = false;
    } catch (err) {
      error = err instanceof Error ? err.message : tr("Kalender tidak bisa ditambahkan.", "The calendar could not be added.");
    } finally {
      busy = false;
    }
  }

  function openImport() {
    error = null;
    importing = true;
  }

  let timetableInput = $state<HTMLInputElement>();
  let timetableBusy = $state(false);
  let timetableError = $state<string | null>(null);
  let timetableNote = $state<string | null>(null);

  async function pickTimetable(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    timetableError = null;
    timetableNote = null;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return void (timetableError = tr("Berkas terlalu besar (maksimal 10 MB).", "The file is too large (10 MB at most)."));
    timetableBusy = true;
    try {
      const { readPdfItems } = await import("$lib/school/pdfItems");
      const done = await school.importPdf(await readPdfItems(await file.arrayBuffer()), file.name);
      timetableNote =
        done.kind === "exam"
          ? done.replaced ? tr(`Jadwal ${done.label} diganti.`, `The ${done.label} timetable was replaced.`) : tr(`Jadwal ${done.label} ditambahkan.`, `The ${done.label} timetable was added.`)
          : done.replaced ? tr("Jadwal pelajaran induk diganti.", "The master timetable was replaced.") : tr("Jadwal pelajaran induk ditambahkan.", "The master timetable was added.");
    } catch (err) {
      timetableError = err instanceof Error ? err.message : tr("Jadwal tidak bisa dibaca dari PDF ini.", "The timetable could not be read from this PDF.");
    } finally {
      timetableBusy = false;
    }
  }

  const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dateRange = (a: string, b: string) => {
    const [ya, ma, da] = a.split("-").map(Number);
    const [yb, mb, db] = b.split("-").map(Number);
    return a === b ? `${da} ${MONTH[ma - 1]} ${ya}` : `${da}${ma === mb && ya === yb ? "" : ` ${MONTH[ma - 1]}`} - ${db} ${MONTH[mb - 1]} ${yb}`;
  };

  async function removeExam(id: string, label: string) {
    if (await dialog.confirm(tr(`Hapus jadwal ${label}?`, `Remove the ${label} timetable?`), { detail: tr("Kalender kembali memakai jadwal biasa pada tanggal itu.", "The calendar goes back to the regular timetable on those dates."), danger: true })) await school.removeExam(id);
  }

  async function removeTimetable() {
    if (await dialog.confirm(tr("Hapus jadwal unggahan?", "Remove the uploaded timetable?"), { detail: tr("Kalender kembali memakai jadwal dari portal bila ada.", "The calendar goes back to the portal timetable, if there is one."), danger: true })) await school.removeTimetable();
  }

  async function remove(id: string, label: string) {
    if (await dialog.confirm(tr(`Hapus kalender "${label}" dari Cognify?`, `Remove calendar "${label}" from Cognify?`), { detail: tr("Acaranya di sumber asli tidak terhapus.", "Its events at the original source are not deleted."), danger: true })) await calendar.removeSource(id);
  }
</script>

<section class="sources lessons">
  <h2>{tr("Jadwal sekolah", "School timetable")}</h2>
  <p class="muted">{tr("Jadwal di portal kadang berbeda dari yang berlaku di kelas. Unggah PDF jadwal induk sekolah untuk memakai jadwal yang benar, atau PDF jadwal ujian (STS, SAS) yang menggantikan jadwal biasa pada tanggalnya. Jenisnya dikenali otomatis, dan mengunggah ulang menggantikan yang lama. Ekstensi tetap menerima jadwal portal; hanya sumber yang dipilih yang tampil di Kalender, Beranda, dan Notch.", "The portal timetable sometimes differs from the real one. Upload the school's master timetable PDF to use the right one, or an exam timetable PDF (STS, SAS) that replaces the regular one on its dates. The type is detected automatically, and uploading again replaces the old one. The extension keeps receiving the portal timetable; only the chosen source shows in the Calendar, Home and Notch.")}</p>
  <ul>
    <li>
      <label class="on"><input type="checkbox" checked={prefs.value.showLessons} onchange={(e) => prefs.set({ showLessons: e.currentTarget.checked })} aria-label={tr("Tampilkan jadwal pelajaran", "Show the lesson timetable")} /></label>
      <span class="n">{tr("Tampilkan jadwal pelajaran", "Show the lesson timetable")}
        <small>{school.schedulePeriod ?? tr("Belum ada jadwal", "No timetable yet")}</small>
      </span>
    </li>
    <li>
      <label class="on"><input type="radio" name="schedule-source" checked={school.scheduleSource === "portal"} disabled={!school.lessons.length && school.scheduleSource !== "portal"} onchange={() => school.setScheduleSource("portal")} aria-label={tr("Jadwal dari portal sekolah", "Timetable from the school portal")} /></label>
      <span class="n">{tr("Dari portal sekolah (CIS)", "From the school portal (CIS)")}
        <small>{school.lessons.length ? tr(`${school.lessons.length} pelajaran dari ekstensi`, `${school.lessons.length} lessons from the extension`) : tr("Belum ada kiriman dari ekstensi", "Nothing from the extension yet")}</small>
      </span>
    </li>
    <li>
      <label class="on"><input type="radio" name="schedule-source" checked={school.scheduleSource === "upload"} disabled={!school.timetable} onchange={() => school.setScheduleSource("upload")} aria-label={tr("Jadwal dari PDF unggahan", "Timetable from the uploaded PDF")} /></label>
      <span class="n">{tr("Dari PDF unggahan", "From the uploaded PDF")}
        <small>{school.timetable ? `${school.timetable.name} · ${tr("kelas", "class")} ${school.activeClass}` : tr("Belum ada PDF", "No PDF yet")}</small>
      </span>
      {#if school.timetable}
        <button class="danger" title={tr("Hapus jadwal unggahan", "Remove the uploaded timetable")} aria-label={tr("Hapus jadwal unggahan", "Remove the uploaded timetable")} onclick={removeTimetable}><Trash2 size={14} /></button>
      {/if}
    </li>
    {#each school.exams as e (e.id)}
      <li>
        <span class="n">{tr("Jadwal ujian", "Exam timetable")}: {e.label}
          <small>{e.days[0] ? dateRange(e.days[0].date, e.days[e.days.length - 1].date) : ""} · {e.name}{school.activeClass && !e.classes.includes(school.activeClass) ? ` · ${tr("kelasmu tidak ada di PDF ini", "your class is not in this PDF")}` : ""}</small>
        </span>
        <button class="danger" title={tr("Hapus jadwal ujian", "Remove the exam timetable")} aria-label="{tr("Hapus jadwal ujian", "Remove the exam timetable")} {e.label}" onclick={() => removeExam(e.id, e.label)}><Trash2 size={14} /></button>
      </li>
    {/each}
    {#if school.pdfClasses.length}
      <li class="cls">
        <span class="n">{tr("Kelas saya", "My class")}
          <small>{tr("Pilih kelasmu di jadwal induk.", "Pick your class in the master timetable.")}</small>
        </span>
        <Select value={school.activeClass} options={school.pdfClasses.map((c) => ({ value: c, label: c }))} label={tr("Kelas saya", "My class")} onchange={(v) => school.setMyClass(v)} />
      </li>
    {/if}
  </ul>
  <input bind:this={timetableInput} type="file" accept="application/pdf,.pdf" onchange={pickTimetable} aria-label={tr("Berkas PDF jadwal", "Timetable PDF file")} hidden />
  <button type="button" class="import" disabled={timetableBusy} onclick={() => timetableInput?.click()}><FileUp size={15} /> {timetableBusy ? tr("Membaca PDF…", "Reading the PDF…") : school.timetable || school.exams.length ? tr("Unggah atau ganti PDF jadwal", "Upload or replace a timetable PDF") : tr("Unggah PDF jadwal", "Upload a timetable PDF")}</button>
  {#if timetableError}<p class="err">{timetableError}</p>{/if}
  {#if timetableNote}<p class="muted note" role="status">{timetableNote}</p>{/if}
  <p class="muted note">{tr("PDF dibaca di perangkat ini dan tidak dikirim ke mana pun.", "The PDF is read on this device and is not sent anywhere.")}</p>
</section>


<section class="sources">
  <h2>{tr("Kalender dari luar", "External calendars")}</h2>
  <p class="muted">{tr("Tampilkan kalender Google atau Outlook di sini. Cognify hanya membacanya, tidak pernah mengubahnya.", "Show your Google or Outlook calendar here. Cognify only reads it and never changes it.")}</p>

  {#if calendar.sources.length}
    <ul>
      {#each calendar.sources as s (s.id)}
        <li>
          <label class="on"><input type="checkbox" checked={s.enabled} onchange={(e) => calendar.setSourceEnabled(s.id, e.currentTarget.checked)} aria-label="Tampilkan {s.name}" /></label>
          <span class="n">{s.name}
            <small>{s.error ? s.error : s.kind === "file" ? tr("Dari berkas", "From file") : s.fetchedAt ? tr(`Diperbarui ${ago(s.fetchedAt)}`, `Updated ${ago(s.fetchedAt)}`) : tr("Belum diambil", "Not fetched yet")}</small>
          </span>
          {#if s.kind === "url"}<button title={tr("Perbarui sekarang", "Refresh now")} aria-label="{tr("Perbarui", "Refresh")} {s.name}" disabled={calendar.refreshing} onclick={() => calendar.refreshSource(s.id)}><RefreshCw size={14} /></button>{/if}
          <button class="danger" title={tr("Hapus", "Delete")} aria-label="{tr("Hapus", "Delete")} {s.name}" onclick={() => remove(s.id, s.name)}><Trash2 size={14} /></button>
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="import" onclick={openImport}><Download size={15} /> {tr("Impor kalender", "Import calendar")}</button>
</section>

<svelte:window onkeydown={(e) => importing && e.key === "Escape" && (importing = false)} />

{#if importing}
  <div class="scrim" role="presentation" onpointerdown={() => (importing = false)}>
    <div class="box" role="dialog" aria-modal="true" aria-label={tr("Impor kalender", "Import calendar")} tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
      <header>
        <h3>{tr("Impor kalender", "Import calendar")}</h3>
        <button type="button" class="x" aria-label={tr("Tutup", "Close")} onclick={() => (importing = false)}><X size={16} /></button>
      </header>
      <div class="tabs" role="tablist" aria-label={tr("Cara impor", "Import method")}>
        <button type="button" role="tab" aria-selected={tab === "url"} class:on={tab === "url"} onclick={() => { tab = "url"; error = null; }}>{tr("Dari tautan", "From link")}</button>
        <button type="button" role="tab" aria-selected={tab === "file"} class:on={tab === "file"} onclick={() => { tab = "file"; error = null; }}>{tr("Dari berkas", "From file")}</button>
      </div>

      {#if tab === "url"}
        <form onsubmit={addUrl}>
          <p class="muted">{tr("Tempel tautan rahasia iCal dari Google Calendar atau Outlook. Tautan diambil dari internet tiap 30 menit selama Cognify berjalan.", "Paste the secret iCal link from Google Calendar or Outlook. The link is fetched from the internet every 30 minutes while Cognify is running.")}</p>
          <input bind:value={name} placeholder={tr("Nama kalender, mis. Sekolah", "Calendar name, e.g. School")} aria-label={tr("Nama kalender", "Calendar name")} maxlength="100" />
          <input bind:value={url} placeholder={tr("https://… (tautan rahasia iCal)", "https://… (secret iCal link)")} aria-label={tr("Tautan kalender", "Calendar link")} />
          {#if error}<p class="err">{error}</p>{/if}
          <button class="go" disabled={busy || !name.trim() || !url.trim()}>{tr("Tambah dari tautan", "Add from link")}</button>
        </form>
      {:else}
        <div class="form">
          <p class="muted">{tr("Pilih berkas .ics (maksimal 5 MB). Isinya disalin sekali dan tidak diperbarui otomatis.", "Choose an .ics file (5 MB at most). Its contents are copied once and not updated automatically.")}</p>
          <input bind:this={fileInput} type="file" accept=".ics,text/calendar" onchange={pickFile} aria-label={tr("Berkas .ics", ".ics file")} hidden />
          <input bind:value={name} placeholder={tr("Nama kalender, mis. Sekolah", "Calendar name, e.g. School")} aria-label={tr("Nama kalender", "Calendar name")} maxlength="100" />
          <button type="button" class="pick" onclick={() => fileInput?.click()}>{fileName || tr("Pilih berkas .ics", "Choose an .ics file")}</button>
          {#if error}<p class="err">{error}</p>{/if}
          <button class="go" disabled={busy || !fileText || !name.trim()} onclick={addFile}>{tr("Tambah dari berkas", "Add from file")}</button>
        </div>
      {/if}
      <p class="muted note">{tr("Cognify hanya membaca kalender ini dan tidak pernah mengubahnya. Selain mengambil tautan, tidak ada yang dikirim ke mana pun.", "Cognify only reads this calendar and never changes it. Apart from fetching the link, nothing is sent anywhere.")}</p>
    </div>
  </div>
{/if}

<style>
  .pick { width: 100%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; background: var(--surface); color: var(--text); border: var(--edge-w) dashed var(--edge); cursor: pointer; }
  .sources {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: var(--edge-w) solid var(--edge);
  }
  h2 {
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: var(--space-2);
  }
  .muted {
    color: var(--text-muted);
    max-width: 640px;
  }
  ul {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .on input {
    width: 18px;
    height: 18px;
  }
  .n {
    flex: 1;
    min-width: 0;
  }
  small {
    display: block;
    color: var(--text-muted);
  }
  li button {
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    padding: 0;
    border: none;
    background: none;
    border-radius: var(--radius-2);
    color: var(--text-muted);
    cursor: pointer;
  }
  li button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  li.cls {
    flex-direction: column;
    align-items: stretch;
    border-bottom: none;
  }
  /* Kontrol bulat digambar di app.css (18 px); jangan diubah lebarnya atau jadi gepeng. */
  li input[type="radio"] {
    width: 18px;
    height: 18px;
  }
  .import:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  li .danger:hover {
    color: var(--danger);
  }
  .import {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-sm);
    box-shadow: var(--lift);
    cursor: pointer;
    transition: transform var(--dur-1), box-shadow var(--dur-1);
  }
  .import:hover {
    transform: translate(var(--hop), var(--hop));
    box-shadow: var(--lift-lg);
  }
  .import:active {
    transform: translate(var(--press), var(--press));
    box-shadow: none;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: color-mix(in srgb, var(--text) 38%, transparent);
  }
  .box {
    width: min(480px, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-lg);
    box-shadow: var(--lift-lg);
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    font-family: var(--font-display);
    font-size: 1.2em;
  }
  .x {
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    padding: 0;
    border: none;
    background: none;
    border-radius: var(--radius-2);
    color: var(--text-muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tabs {
    display: flex;
    gap: var(--space-0);
    padding: var(--space-1);
    background: var(--surface-2);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-pill);
  }
  .tabs button {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tabs button.on {
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  form,
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .box input:not([hidden]) {
    border: var(--edge-w) solid var(--edge);
  }
  .box .muted {
    margin: 0;
  }
  .note {
    font-size: 0.85em;
  }
  .go {
    align-self: flex-end;
    padding: var(--space-2) var(--space-3);
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-sm);
    box-shadow: var(--lift);
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    color: var(--danger);
  }
</style>
