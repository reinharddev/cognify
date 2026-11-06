<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
  import { ArrowLeft, Check, Download, ExternalLink, FolderOpen, RefreshCw, Search, Trash2, X } from "@lucide/svelte";
  import { moodleApi, type MoodleCourse, type MoodleFile, type MoodleLink } from "$lib/moodle/api";
  import { embedConsent } from "$lib/moodle/embedConsent.svelte";
  import { courseName, ext, hostOf, kindLabel, PROVIDER, short, size, stem, tidy } from "$lib/moodle/format";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { moodle } from "$lib/stores/moodle.svelte";

  const id = $derived(Number(page.params.id));

  let course = $state<MoodleCourse | null>(null);
  let files = $state<MoodleFile[]>([]);
  let links = $state<MoodleLink[]>([]);
  let opened = $state<Record<string, boolean>>({});
  let openSec = $state<Record<string, boolean>>({});
  let loading = $state(false);
  let error = $state<string | null>(null);
  let query = $state("");
  let other = $state<{ kind: string; count: number }[]>([]);
  let foreign = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let loadedFor: number | null = null;

  const otherText = $derived(other.map((o) => kindLabel(o.kind, o.count)).join(", "));
  const pct = (f: MoodleFile) => (f.size > 0 ? Math.min(100, Math.round((f.bytesDone / f.size) * 100)) : null);
  const fail = (e: unknown) => (error = e instanceof Error ? e.message : tr("Terjadi kesalahan.", "Something went wrong."));

  // ── Turunan data ───────────────────────────────────────────────────────────────
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter((f) => `${f.filename} ${f.module} ${f.section}`.toLowerCase().includes(q)) : files;
  });

  const shownLinks = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? links.filter((l) => `${l.title} ${l.module} ${l.section} ${l.url} ${l.body}`.toLowerCase().includes(q)) : links;
  });

  const groups = $derived.by(() => {
    const out: { section: string; files: MoodleFile[]; links: MoodleLink[] }[] = [];
    const group = (section: string) => {
      let g = out.find((x) => x.section === section);
      if (!g) out.push((g = { section, files: [], links: [] }));
      return g;
    };
    for (const f of shown) group(f.section).files.push(f);
    for (const l of shownLinks) group(l.section).links.push(l);
    return out;
  });

  /** Bagian pertama terbuka; sisanya tertutup sampai diklik. Saat mencari, semua yang cocok terbuka. */
  const isOpen = (section: string, index: number) => (query.trim() ? true : (openSec[section] ?? index === 0));

  const busy = $derived(files.filter((f) => f.state === "queued" || f.state === "downloading"));
  const saved = $derived(files.filter((f) => f.state === "done").length);
  const pending = $derived(files.filter((f) => f.state === "remote" || f.state === "error"));

  /** Tampilkan embed di dalam Cognify. Memuatnya menghubungi canva.com, jadi minta persetujuan sekali dulu. */
  async function toggleEmbed(l: MoodleLink) {
    if (opened[l.id]) return void (opened[l.id] = false);
    if (!embedConsent.canva) {
      const ok = await dialog.confirm(tr("Muat embed dari canva.com di dalam Cognify?", "Load the embed from canva.com inside Cognify?"), {
        detail: tr("Cognify akan menghubungi server Canva untuk menampilkan desainnya, jadi butuh internet. Hanya embed yang kamu buka yang dimuat. Izin ini bisa dicabut di Pengaturan → Moodle.", "Cognify will contact Canva's server to show the design, so it needs internet. Only embeds you open are loaded. You can revoke this in Settings → Moodle."),
        okLabel: tr("Muat embed", "Load embed"),
      });
      if (!ok) return;
      embedConsent.grant();
    }
    opened[l.id] = true;
  }

  // ── Aksi ───────────────────────────────────────────────────────────────────────
  async function load() {
    const target = id;
    try {
      course = (await moodleApi.courses()).find((c) => c.id === target) ?? null;
      [files, links] = await Promise.all([moodleApi.files(target), moodleApi.links(target)]);
    } catch (e) {
      fail(e);
    }
    await refresh();
  }

  /** Ambil daftar terbaru dari Moodle (hanya daftar; berkasnya belum diunduh). */
  async function refresh() {
    loading = true;
    try {
      const view = await moodleApi.refreshCourse(id);
      files = view.files;
      links = view.links;
      other = view.other;
      foreign = view.foreign;
    } catch (e) {
      fail(e);
    } finally {
      loading = false;
    }
  }

  async function poll() {
    if (busy.length === 0 || !moodle.active) return;
    try {
      files = await moodleApi.files(id);
    } catch {
      /* percobaan berikutnya */
    }
  }

  async function act(job: () => Promise<void>) {
    error = null;
    try {
      await job();
      files = await moodleApi.files(id);
    } catch (e) {
      fail(e);
    }
  }

  const save = (ids: string[]) => (ids.length ? act(() => moodleApi.download(ids)) : Promise.resolve());
  const open = (f: MoodleFile) => f.localPath && openPath(f.localPath).catch(() => fail(new Error(tr("Berkas tidak bisa dibuka.", "The file could not be opened."))));

  // Dimuat begitu Moodle siap, dan lagi bila pindah ke mapel lain.
  $effect(() => {
    if (moodle.active && loadedFor !== id) {
      loadedFor = id;
      course = null;
      files = [];
      links = [];
      other = [];
      foreign = 0;
      opened = {};
      openSec = {};
      query = "";
      error = null;
      void load();
    }
  });

  onMount(() => {
    timer = setInterval(() => void poll(), 1000);
  });
  onDestroy(() => clearInterval(timer));
</script>

<div class="page">
  <a class="back" href="/moodle"><ArrowLeft size={16} />{tr("Semua mata pelajaran", "All courses")}</a>

  {#if !moodle.active}
    <p class="hint">{tr("Moodle belum dinyalakan.", "Moodle is not turned on.")} <a href="/settings">{tr("Buka Pengaturan", "Open Settings")}</a></p>
  {:else}
    <section>
      <header>
        <div class="title">
          <h2 title={course?.name ?? ""}>{course ? courseName(course.name) : tr("Mata pelajaran", "Course")}</h2>
          <p class="sub">
            {#if loading && !files.length}{tr("Memuat daftar…", "Loading list…")}
            {:else}{tr(`${files.length} berkas · ${saved} tersimpan`, `${files.length} files · ${saved} saved`)}{#if links.length}{tr(` · ${links.length} tautan`, ` · ${links.length} links`)}{/if}{#if busy.length}{tr(` · ${busy.length} diunduh`, ` · ${busy.length} downloading`)}{/if}{/if}
          </p>
        </div>
        <div class="tools">
          <button class="ghost icon" title={tr("Perbarui daftar dari Moodle", "Refresh list from Moodle")} aria-label={tr("Perbarui daftar", "Refresh list")} disabled={loading} onclick={() => void refresh()}><span class:spin={loading}><RefreshCw size={16} /></span></button>
          {#if busy.length}
            <button class="ghost" onclick={() => void act(() => moodleApi.cancel(busy.map((f) => f.id)))}>{tr("Batalkan", "Cancel")}</button>
          {/if}
          <button class="solid" disabled={!pending.length} onclick={() => void save(pending.map((f) => f.id))}><Download size={15} />{pending.length ? tr(`Simpan semua (${pending.length})`, `Save all (${pending.length})`) : files.length ? tr("Semua tersimpan", "All saved") : tr("Simpan semua", "Save all")}</button>
        </div>
      </header>

      {#if files.length > 6}
        <label class="search"><Search size={15} /><input type="search" placeholder={tr("Cari berkas…", "Search files…")} aria-label={tr("Cari berkas", "Search files")} bind:value={query} /></label>
      {/if}
      {#if error}<p class="err" role="alert">{error}</p>{/if}

      {#if files.length && otherText}
        <p class="hint">{tr(`Selain berkas, mata pelajaran ini berisi ${otherText} yang belum bisa disimpan offline.`, `Besides files, this course contains ${otherText} that cannot be saved offline yet.`)}</p>
      {/if}
      {#each groups as g, gi (g.section)}
        {@const open_ = isOpen(g.section, gi)}
        {@const todo = g.files.filter((f) => f.state === "remote" || f.state === "error")}
        {@const have = g.files.filter((f) => f.state === "done").length}
        <div class="sec" class:open={open_}>
          <button class="head" aria-expanded={open_} onclick={() => (openSec[g.section] = !open_)}>
            <span class="chev" aria-hidden="true">{open_ ? "▾" : "▸"}</span>
            <span class="st" title={tidy(g.section)}>{short(g.section) || tr("Umum", "General")}</span>
            <span class="cnt">{g.files.length + g.links.length}</span>
          </button>
          {#if todo.length}
            <button class="ghost icon sv" title={tr("Simpan semua di bagian ini", "Save everything in this section")} aria-label={tr("Simpan semua di bagian ini", "Save everything in this section")} onclick={() => void save(todo.map((f) => f.id))}><Download size={15} /></button>
          {:else if g.files.length && have === g.files.length}
            <span class="ok sv" title={tr("Semua tersimpan", "All saved")}><Check size={15} /></span>
          {/if}
        </div>
        {#if open_}
          <ul>
            {#each g.files as f (f.id)}
              <li class:done={f.state === "done"} title={f.module}>
                <span class="ext" aria-hidden="true">{ext(f.filename) || "FILE"}</span>
                <div class="main">
                  {#if f.state === "done"}
                    <button class="link" title={f.filename} onclick={() => void open(f)}>{stem(f.filename)}</button>
                  {:else}
                    <span class="fn" title={f.filename}>{stem(f.filename)}</span>
                  {/if}
                  {#if f.state === "downloading"}
                    <div class="prog" role="progressbar" aria-valuenow={pct(f) ?? 0} aria-valuemin="0" aria-valuemax="100"><i class:indet={pct(f) === null} style="width:{pct(f) ?? 40}%"></i></div>
                  {/if}
                  {#if f.state === "error" && f.error}<small class="err">{f.error}</small>{/if}
                </div>
                <small class="meta">
                  {#if f.state === "downloading"}{pct(f) !== null ? `${pct(f)}%` : size(f.bytesDone)}
                  {:else if f.state === "queued"}{tr("Mengantre", "Queued")}
                  {:else}{size(f.size)}{/if}
                </small>
                <div class="acts">
                  {#if f.state === "done"}
                    <span class="ok" title={tr("Tersimpan offline", "Saved offline")}><Check size={15} /></span>
                    <button class="ghost icon" title={tr("Buka", "Open")} aria-label={tr("Buka", "Open")} onclick={() => void open(f)}><FolderOpen size={15} /></button>
                    <button class="ghost icon" title={tr("Hapus salinan", "Delete copy")} aria-label={tr("Hapus salinan", "Delete copy")} onclick={() => void act(() => moodleApi.deleteLocal([f.id]))}><Trash2 size={15} /></button>
                    <button class="ghost icon more" title={tr("Tampilkan di Finder", "Show in Finder")} aria-label={tr("Tampilkan di Finder", "Show in Finder")} onclick={() => f.localPath && void revealItemInDir(f.localPath)}>↗</button>
                  {:else if f.state === "queued" || f.state === "downloading"}
                    <button class="ghost icon" title={tr("Batalkan", "Cancel")} aria-label={tr("Batalkan", "Cancel")} onclick={() => void act(() => moodleApi.cancel([f.id]))}><X size={15} /></button>
                  {:else}
                    <button class="ghost" onclick={() => void save([f.id])}><Download size={14} />{f.state === "error" ? tr("Ulangi", "Retry") : tr("Simpan", "Save")}</button>
                  {/if}
                </div>
              </li>
            {/each}
            {#each g.links as l (l.id)}
              <li class="lk" title={tidy(l.title)}>
                <span class="ext" aria-hidden="true">{l.kind === "page" ? tr("TEKS", "TEXT") : (PROVIDER[l.provider] ?? "LINK")}</span>
                <div class="main">
                  <span class="fn">{short(l.title)}</span>
                  <small class="note">
                    {#if l.kind === "page"}{tr("Teks, tersimpan offline", "Text, saved offline")}
                    {:else}{hostOf(l.url)} · {tr("butuh internet", "needs internet")}{/if}
                  </small>
                </div>
                <div class="acts">
                  {#if l.kind === "page"}
                    <button class="ghost" onclick={() => (opened[l.id] = !opened[l.id])}>{opened[l.id] ? tr("Tutup", "Close") : tr("Baca", "Read")}</button>
                  {:else}
                    {#if l.embedUrl}<button class="ghost" onclick={() => void toggleEmbed(l)}>{opened[l.id] ? tr("Sembunyikan", "Hide") : tr("Tampilkan", "Show")}</button>{/if}
                    <button class="ghost icon" title={tr("Buka di browser", "Open in browser")} aria-label={tr("Buka di browser", "Open in browser")} onclick={() => void openUrl(l.url).catch(() => fail(new Error(tr("Tautan tidak bisa dibuka.", "The link could not be opened."))))}><ExternalLink size={15} /></button>
                  {/if}
                </div>
                {#if opened[l.id]}
                  <div class="expand">
                    {#if l.kind === "page"}
                      <pre class="text">{l.body}</pre>
                    {:else if l.embedUrl}
                      <div class="frame"><iframe src={l.embedUrl} title={l.title} sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" loading="lazy" allowfullscreen></iframe></div>
                      <small class="note">{tr("Dimuat dari canva.com. Butuh internet; tidak tersimpan offline.", "Loaded from canva.com. Needs internet; not saved offline.")}</small>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        {#if !loading}
          {#if query}
            <p class="hint">{tr("Tidak ada berkas yang cocok.", "No matching files.")}</p>
          {:else}
            <div class="none">
              <b>{tr("Tidak ada berkas yang bisa diunduh di sini.", "There are no downloadable files here.")}</b>
              <p>
                {#if otherText}{tr(`Mata pelajaran ini berisi ${otherText}. Itu bukan berkas, jadi belum bisa disimpan offline. Kemungkinan gurumu belum mengunggah file (PDF, dokumen, slide) ke sini.`, `This course contains ${otherText}. Those are not files, so they cannot be saved offline yet. Your teacher may not have uploaded any files (PDF, documents, slides) here.`)}
                {:else}{tr("Moodle tidak mengembalikan isi apa pun untuk mata pelajaran ini. Mungkin gurumu belum mengisinya, atau akunmu belum diizinkan melihatnya.", "Moodle returned nothing for this course. Your teacher may not have filled it in yet, or your account may not be allowed to see it.")}{/if}
              </p>
            </div>
          {/if}
          {#if foreign > 0}<p class="hint">{tr(`${foreign} berkas ada di server lain dan dilewati demi keamanan.`, `${foreign} files are on another server and were skipped for safety.`)}</p>{/if}
        {/if}
      {/each}

    </section>
  {/if}
</div>

<style>
  .page { padding: var(--space-4); max-width: 860px; margin: 0 auto; min-width: 0; }
  .back { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); text-decoration: none; margin-bottom: var(--space-3); padding: var(--space-1) var(--space-2) var(--space-1) var(--space-0); border-radius: var(--radius-sm); }
  .back:hover { color: var(--text); }
  .back:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
  .hint { color: var(--text-muted); max-width: 560px; }
  .err { color: var(--danger); margin: var(--space-2) 0; }
  .none { padding: var(--space-5) 0; max-width: 520px; }
  .none p { color: var(--text-muted); margin: var(--space-1) 0 0; }




  header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; margin-bottom: var(--space-4); }
  .title { min-width: 0; }
  .title h2 { margin: 0; font-size: 1.35em; overflow-wrap: anywhere; }
  .sub { margin: var(--space-0) 0 0; color: var(--text-muted); }
  .tools { display: flex; align-items: center; gap: var(--space-2); }

  .search { display: flex; align-items: center; gap: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3); color: var(--text-muted); background: var(--surface); }
  .search input { flex: 1; border: 0; background: none; outline: none; font: inherit; color: var(--text); min-width: 0; }
  .search:focus-within { border-color: var(--accent-strong); }

  .sec { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); border-bottom: 1px solid var(--border); }
  .head { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); background: none; border: 0; padding: var(--space-3) var(--space-0); cursor: pointer; text-align: left; font: inherit; color: var(--text); }
  .head:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; border-radius: var(--radius-sm); }
  .chev { color: var(--text-muted); width: 16px; flex: none; font-size: 1.25em; line-height: 1; }
  .st { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cnt { flex: none; color: var(--text-muted); font-size: 0.85em; background: var(--surface-2); border-radius: var(--radius-pill); padding: 1px var(--space-2); font-variant-numeric: tabular-nums; }
  .sv { flex: none; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-2); border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
  li:hover { background: var(--surface-2); }

  .ext { width: 40px; text-align: center; font-size: 0.66em; font-weight: 600; letter-spacing: 0.04em; color: var(--text-muted); background: var(--surface-2); border-radius: var(--radius-2); padding: var(--space-1) 0; }
  li.done .ext { color: var(--accent-strong); background: var(--accent-soft); }
  .main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fn, .link, .note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { background: none; border: 0; padding: 0; text-align: left; font: inherit; color: var(--accent-strong); font-weight: 600; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .note { color: var(--text-muted); }
  .meta { color: var(--text-muted); opacity: 0.8; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
  .acts { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-0); min-width: 84px; }
  .ok { color: var(--accent-strong); display: inline-flex; margin-right: var(--space-0); }

  .ghost { display: inline-flex; align-items: center; gap: var(--space-1); background: none; border: 1px solid transparent; border-radius: var(--radius-pill); padding: var(--space-1) var(--space-3); cursor: pointer; color: var(--text); font: inherit; }
  .ghost:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border); }
  .ghost.icon { padding: var(--space-2); border-radius: var(--radius-sm); }
  .ghost.more { font-size: 0.95em; }
  .ghost:disabled { opacity: 0.5; cursor: default; }
  .solid { display: inline-flex; align-items: center; gap: var(--space-2); background: var(--accent); color: var(--accent-contrast); border: 1px solid var(--accent-strong); border-radius: var(--radius-pill); padding: var(--space-2) var(--space-4); font: inherit; font-weight: 600; cursor: pointer; }
  .solid:disabled { opacity: 0.5; cursor: default; }
  .solid:hover:not(:disabled) { background: var(--accent-hover); }

  li.lk { grid-template-columns: auto minmax(0, 1fr) auto; }
  .lk .ext { width: auto; min-width: 38px; padding: var(--space-1) var(--space-2); }
  .lk .fn { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .expand { grid-column: 1 / -1; padding: 0 0 var(--space-2); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: var(--space-3); background: var(--surface-2); border-radius: var(--radius-sm); font: inherit; max-height: 320px; overflow-y: auto; }
  .frame { position: relative; aspect-ratio: 16 / 9; width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-2); margin-bottom: var(--space-1); }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .prog { height: 4px; background: var(--surface-2); border-radius: var(--radius-pill); overflow: hidden; margin-top: var(--space-1); }
  .prog i { display: block; height: 100%; background: var(--accent-strong); transition: width 0.3s; }
  .prog i.indet { animation: slide 1.2s infinite ease-in-out; }
  .spin { display: inline-flex; animation: rot 1s linear infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
  @keyframes rot { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .prog i, .prog i.indet, .spin { animation: none; transition: none; } }

  @media (max-width: 760px) {
    li { grid-template-columns: auto minmax(0, 1fr) auto; }
    .meta { display: none; }
  }
</style>
