<script lang="ts">
  import { tr, i18n } from "$lib/i18n.svelte";
  // Blok "Tugas dari Moodle" di dokumen: tugas yang belum dikumpulkan, dibaca langsung dari Moodle (lewat penyimpanan
  // Moodle di app), jadi selalu terbaru dan hilang sendiri setelah dikumpulkan. Hanya baca; catatan sendiri ditulis di bawahnya.
  import { goto } from "$app/navigation";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { GraduationCap } from "@lucide/svelte";
  import { courseName, short } from "$lib/moodle/format";
  import { moodle } from "$lib/stores/moodle.svelte";

  const LIMIT = 8;

  // Tenggat berupa teks ISO UTC, jadi urutan teks sama dengan urutan waktu.
  // Yang terlambat lebih dari 30 hari tidak ditampilkan di sini (tetap ada di Tabel PR).
  const tasks = $derived.by(() => {
    const oldest = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return moodle.items.filter((i) => !i.submitted && i.due >= oldest).sort((a, b) => a.due.localeCompare(b.due));
  });
  const shown = $derived(tasks.slice(0, LIMIT));
  const more = $derived(tasks.length - shown.length);
  const locale = $derived(i18n.lang === "en" ? "en-US" : "id-ID");

  const clock = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  /** "Terlambat 2 hari", "Hari ini 23.59", "Besok 07.00", atau "Sen, 9 Nov". */
  function dueLabel(iso: string): { text: string; late: boolean } {
    const due = new Date(iso);
    const now = new Date();
    const diff = due.getTime() - now.getTime();
    if (diff < 0) {
      const mins = Math.max(1, Math.round(-diff / 60_000));
      if (mins < 60) return { text: tr(`Terlambat ${mins} mnt`, `${mins} min late`), late: true };
      if (mins < 1440) return { text: tr(`Terlambat ${Math.floor(mins / 60)} jam`, `${Math.floor(mins / 60)} h late`), late: true };
      return { text: tr(`Terlambat ${Math.floor(mins / 1440)} hari`, `${Math.floor(mins / 1440)} d late`), late: true };
    }
    const dayDiff = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
    if (dayDiff === 0) return { text: `${tr("Hari ini", "Today")} ${clock(due)}`, late: false };
    if (dayDiff === 1) return { text: `${tr("Besok", "Tomorrow")} ${clock(due)}`, late: false };
    return { text: due.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }), late: false };
  }

  const openTask = (url: string | null) => {
    if (url && isTauri()) void openUrl(url).catch(() => {});
  };
</script>

<div class="block">
  <div class="head">
    <span class="ic" aria-hidden="true"><GraduationCap size={16} /></span>
    <div class="what">
      <b>{tr("Tugas dari Moodle", "Tasks from Moodle")}</b>
      <small>
        {#if !moodle.active}{tr("Terisi otomatis bila Moodle tersambung", "Fills in automatically once Moodle is connected")}
        {:else}{tr(`${tasks.length} belum dikumpulkan, diperbarui otomatis`, `${tasks.length} not submitted yet, updated automatically`)}{/if}
      </small>
    </div>
  </div>

  {#if !moodle.active}
    <p class="empty">
      {tr("Hubungkan Moodle sekolahmu supaya PR dan tugasnya muncul di sini tanpa diketik.", "Connect your school's Moodle so homework and assignments show up here without typing.")}
      <button class="link" onclick={() => void goto("/settings")}>{tr("Buka Pengaturan", "Open Settings")}</button>
    </p>
  {:else if !tasks.length}
    <p class="empty">{tr("Tidak ada tugas Moodle yang tertunda. Semua sudah dikumpulkan.", "No pending Moodle tasks. Everything is submitted.")}</p>
  {:else}
    <ul>
      {#each shown as t (t.id)}
        {@const d = dueLabel(t.due)}
        <li>
          <div class="main">
            {#if t.url}
              <button class="link title" title={t.title} onclick={() => openTask(t.url)}>{short(t.title)}</button>
            {:else}
              <span class="title" title={t.title}>{short(t.title)}</span>
            {/if}
            {#if t.course}<small class="course">{courseName(t.course)}</small>{/if}
          </div>
          <small class="due" class:late={d.late}>{d.text}</small>
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="empty more">{tr(`dan ${more} tugas lainnya. `, `and ${more} more. `)}<button class="link" onclick={() => void goto("/calendar")}>{tr("Lihat di Kalender", "See in Calendar")}</button></p>
    {/if}
  {/if}
</div>

<style>
  .block {
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius);
    box-shadow: var(--lift);
    font-size: 0.95em;
    line-height: 1.4;
  }
  .head { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    background: var(--tint-4);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-2);
  }
  .what { flex: 1; min-width: 0; }
  .what b { display: block; font-family: var(--font-display); }
  .what small, .empty { color: var(--text-muted); }
  .empty { margin: 0; }
  .empty.more { margin-top: var(--space-2); }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  li:first-child { border-top: 0; padding-top: 0; }
  .main { min-width: 0; display: flex; flex-direction: column; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .course { color: var(--text-muted); }
  .due { flex: none; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .due.late { color: var(--danger); font-weight: 600; }
  .link { padding: 0; border: 0; background: none; font: inherit; color: var(--link); cursor: pointer; text-align: left; }
  .link.title { color: var(--text); font-weight: 600; }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; border-radius: var(--radius-1); }
</style>
