<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { Download, RefreshCw, Trash2, X } from "@lucide/svelte";
  import { ago } from "$lib/link/format";
  import { calendar } from "$lib/stores/calendar.svelte";

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

  async function remove(id: string, label: string) {
    if (await dialog.confirm(tr(`Hapus kalender "${label}" dari Cognify?`, `Remove calendar "${label}" from Cognify?`), { detail: tr("Acaranya di sumber asli tidak terhapus.", "Its events at the original source are not deleted."), danger: true })) await calendar.removeSource(id);
  }
</script>

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
    margin-top: var(--space-8);
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
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .on input {
    width: auto;
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
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }
  li button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  li .danger:hover {
    color: var(--danger);
  }
  .import {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--space-2);
    padding: 6px 14px;
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
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
  }
  .tabs button {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-radius: 99px;
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
    padding: 6px 14px;
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
