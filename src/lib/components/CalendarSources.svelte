<script lang="ts">
  import { dialog } from "$lib/stores/dialog.svelte";
  import { RefreshCw, Trash2 } from "@lucide/svelte";
  import { ago } from "$lib/link/format";
  import { calendar } from "$lib/stores/calendar.svelte";

  let name = $state("");
  let url = $state("");
  let fileName = $state("");
  let fileText = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function addUrl(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await calendar.addSource({ name, kind: "url", url });
      name = url = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Kalender tidak bisa ditambahkan.";
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
    } catch (err) {
      error = err instanceof Error ? err.message : "Kalender tidak bisa ditambahkan.";
    } finally {
      busy = false;
    }
  }

  async function remove(id: string, label: string) {
    if (await dialog.confirm(`Hapus kalender "${label}" dari Cognify?`, { detail: "Acaranya di sumber asli tidak terhapus.", danger: true })) await calendar.removeSource(id);
  }
</script>

<section class="sources">
  <h2>Kalender dari luar</h2>
  <p class="muted">Tambahkan kalender Google atau Outlook lewat tautan rahasia iCal-nya, atau berkas .ics. Cognify hanya membacanya, tidak pernah mengubahnya. Tautan diambil dari internet tiap 30 menit selama Cognify berjalan; selain itu tidak ada yang dikirim ke mana pun.</p>

  {#if calendar.sources.length}
    <ul>
      {#each calendar.sources as s (s.id)}
        <li>
          <label class="on"><input type="checkbox" checked={s.enabled} onchange={(e) => calendar.setSourceEnabled(s.id, e.currentTarget.checked)} aria-label="Tampilkan {s.name}" /></label>
          <span class="n">{s.name}
            <small>{s.error ? s.error : s.kind === "file" ? "Dari berkas" : s.fetchedAt ? `Diperbarui ${ago(s.fetchedAt)}` : "Belum diambil"}</small>
          </span>
          {#if s.kind === "url"}<button title="Perbarui sekarang" aria-label="Perbarui {s.name}" disabled={calendar.refreshing} onclick={() => calendar.refreshSource(s.id)}><RefreshCw size={14} /></button>{/if}
          <button class="danger" title="Hapus" aria-label="Hapus {s.name}" onclick={() => remove(s.id, s.name)}><Trash2 size={14} /></button>
        </li>
      {/each}
    </ul>
  {/if}

  <form class="add" onsubmit={addUrl}>
    <input bind:value={name} placeholder="Nama kalender, mis. Sekolah" aria-label="Nama kalender" maxlength="100" />
    <input bind:value={url} placeholder="https://… (tautan rahasia iCal)" aria-label="Tautan kalender" />
    <button disabled={busy || !name.trim() || !url.trim()}>Tambah dari tautan</button>
  </form>
  <div class="add file">
    <input bind:this={fileInput} type="file" accept=".ics,text/calendar" onchange={pickFile} aria-label="Berkas .ics" hidden />
    <button type="button" class="pick" onclick={() => fileInput?.click()}>{fileName || "Pilih berkas .ics"}</button>
    <button disabled={busy || !fileText || !name.trim()} onclick={addFile}>Tambah dari berkas</button>
  </div>
  {#if error}<p class="err">{error}</p>{/if}
</section>

<style>
  .pick { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; background: var(--surface); color: var(--text); border: 1px dashed var(--border-strong); }
  .sources {
    margin-top: var(--space-8);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  h2 {
    font-size: 0.85em;
    font-weight: 600;
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
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .add input {
    flex: 1;
    min-width: 180px;
  }
  .add button {
    padding: 6px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .add button:hover:not(:disabled) {
    border-color: var(--accent-strong);
  }
  .err {
    color: var(--danger);
  }
</style>
