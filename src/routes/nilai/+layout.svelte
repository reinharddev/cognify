<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { ClipboardList, X } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import Select from "$lib/ui/Select.svelte";

  let { children }: { children: Snippet } = $props();

  const path = $derived(page.url.pathname);
  const tabs = $derived([
    { href: "/nilai", label: tr("Ringkasan", "Overview"), exact: true },
    { href: "/nilai/mapel", label: tr("Mata pelajaran", "Subjects") },
    { href: "/nilai/statistik", label: tr("Statistik", "Statistics") },
    { href: "/nilai/tugas", label: tr("Tugas", "Tasks") },
    { href: "/nilai/kehadiran", label: tr("Kehadiran", "Attendance") },
    { href: "/nilai/hitungan", label: tr("Hitungan", "Calculation") },
  ]);
  const on = (t: { href: string; exact?: boolean }) => (t.exact ? path === t.href : path.startsWith(t.href));
  // Hitungan dan panduan impor tetap bisa dibuka walau data belum ada.
  const needsData = $derived(!path.startsWith("/nilai/hitungan") && !path.startsWith("/nilai/kehadiran"));
</script>

<div class="nl">
  <header>
    <h1>{tr("Nilai", "Grades")}</h1>
    {#if school.items.length}
      <span class="filters">
        <Select value={school.year} options={school.years.map((y) => ({ value: y, label: tr(`Tahun ajaran ${y}`, `School year ${y}`) }))} onchange={(v: string) => school.setYear(v)} label={tr("Tahun ajaran", "School year")} disabled={school.years.length === 0} />
        <Select value={school.term} options={[{ value: "", label: tr("Semua semester", "All terms") }, ...school.terms.map((t) => ({ value: t, label: tr(`Semester ${t}`, `Term ${t}`) }))]} onchange={(v: string) => (school.term = v)} label={tr("Semester", "Term")} />
      </span>
    {/if}
  </header>
  {#if school.stored.length}
    <p class="stored" aria-label={tr("Data tersimpan di Cognify", "Data stored in Cognify")}>
      <span class="muted">{tr("Data di Cognify:", "Data in Cognify:")}</span>
      {#each school.stored as p (p.key)}
        <span class="pill" title={p.subjects.join(", ")}>
          {p.label} <small class="muted">{p.count}</small>
          <button aria-label={tr(`Hapus ${p.label}`, `Delete ${p.label}`)} title={tr("Hapus periode ini dari Cognify (data di portal tidak berubah)", "Delete this period from Cognify (the portal is untouched)")} onclick={() => school.removePeriod(p.key)}><X size={12} /></button>
        </span>
      {/each}
    </p>
  {/if}
  {#if school.items.length && school.hasMajor}
    <div class="seg" role="group" aria-label={tr("Kelompok mapel", "Subject group")}>
      <button class:on={school.group === "all"} onclick={() => (school.group = "all")}>{tr("Semua mapel", "All subjects")}</button>
      <button class:on={school.group === "major"} onclick={() => (school.group = "major")}>{school.calc.major.name ? tr(`Peminatan ${school.calc.major.name}`, `${school.calc.major.name} major`) : tr("Peminatan", "Major")}</button>
      <button class:on={school.group === "general"} onclick={() => (school.group = "general")}>{tr("Umum", "General")}</button>
    </div>
  {/if}
  <p class="muted lastpost" role="status">
    {#if school.lastPost}
      {tr("Kiriman terakhir dari ekstensi", "Last send from the extension")}: {new Date(school.lastPost.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      · {({ exam: tr("nilai", "grades"), schedule: tr("jadwal", "timetable"), attendance: tr("kehadiran", "attendance") } as Record<string, string>)[school.lastPost.kind] ?? school.lastPost.kind}
      {school.lastPost.period ? `· ${school.lastPost.period}` : ""} · {school.lastPost.rows} {tr("baris", "rows")}
    {:else}
      {tr("Belum ada kiriman dari ekstensi.", "Nothing has been sent from the extension yet.")}
    {/if}
  </p>
  {#if school.report?.lines.length}
    <details class="report">
      <summary>
        {tr("Laporan pengiriman terakhir", "Last send report")}
        {#if school.report.lines.some((l) => l.includes("GAGAL") || l.includes("tidak termuat"))}<span class="chip low">{tr("ada yang gagal", "something failed")}</span>{/if}
      </summary>
      <pre>{school.report.lines.join("\n")}</pre>
    </details>
  {/if}
  <nav aria-label={tr("Bagian Nilai", "Grades sections")}>
    {#each tabs as t (t.href)}<a href={t.href} class:on={on(t)}>{t.label}</a>{/each}
  </nav>

  {#if !school.loaded}
    <p class="muted">{tr("Memuat...", "Loading...")}</p>
  {:else if needsData && school.items.length === 0}
    <section class="card empty">
      <span class="bubble"><ClipboardList size={22} /></span>
      <h2>{tr("Belum ada data sekolah", "No school data yet")}</h2>
      <p class="muted">{tr("Tugas, ujian, dan nilai dari portal sekolahmu muncul di sini. Cognify tidak masuk ke portal; ekstensi browser membaca halaman yang sudah kamu buka.", "Assignments, exams and scores from your school portal show up here. Cognify never signs in to the portal; the browser extension reads the page you already opened.")}</p>
      <ol>
        <li>{tr("Nyalakan jembatan ekstensi di Pengaturan > Data dan pasangkan ekstensinya.", "Turn on the extension bridge in Settings > Data and pair the extension.")}</li>
        <li>{tr("Buka halaman Assignment & Exam di portal sekolah.", "Open the Assignment & Exam page on your school portal.")}</li>
        <li>{tr("Klik ikon ekstensi lalu \"Kirim nilai sekolah ke Cognify\". Semua semester terkirim sekaligus.", "Click the extension icon, then \"Send school grades to Cognify\". All terms are sent at once.")}</li>
      </ol>
    </section>
  {:else}
    {@render children()}
  {/if}
</div>

<style>
  .nl { max-width: 960px; margin: 0 auto; padding: var(--space-5) var(--space-4); display: grid; gap: var(--space-3); align-content: start; }
  header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
  h1 { margin: 0; }
  .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .stored { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .pill { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-0) var(--space-1) var(--space-0) var(--space-2); border-radius: var(--radius-pill); background: var(--surface-2); border: 1px solid var(--border); }
  .pill button { display: grid; place-items: center; width: 1.6em; height: 1.6em; border: 0; border-radius: var(--radius-pill); background: none; cursor: pointer; color: var(--text-muted); }
  @media (hover: hover) { .pill button:hover { background: var(--danger-soft); color: var(--danger); } }
  .lastpost { margin: 0; font-size: 0.85em; }
  .report { font-size: 0.85em; }
  .report summary { cursor: pointer; color: var(--text-muted); }
  .report pre { margin: var(--space-2) 0 0; padding: var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); }
  .seg { display: inline-flex; justify-self: start; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: var(--space-1); gap: var(--space-0); flex-wrap: wrap; }
  .seg button { background: none; border: 0; padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill); cursor: pointer; color: var(--text-muted); font-weight: 600; }
  .seg button.on { background: var(--accent); color: var(--accent-contrast); }
  nav { display: flex; gap: var(--space-1); overflow-x: auto; padding-bottom: var(--space-1); border-bottom: 1px solid var(--border); }
  nav a { flex: none; padding: var(--space-2) var(--space-3); border-radius: var(--radius-pill); color: var(--text-muted); font-weight: 600; text-decoration: none; }
  nav a.on { background: var(--accent-soft); color: var(--link); }
  @media (hover: hover) { nav a:not(.on):hover { background: var(--surface-2); color: var(--text); } }
  .empty { display: grid; justify-items: start; gap: var(--space-2); padding: var(--space-5); }
  .empty h2, .empty p { margin: 0; }
  .empty ol { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-1); }
  .bubble { display: grid; place-items: center; width: 3.2em; height: 3.2em; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--link); }

  /* Gaya bersama halaman-halaman di bawah Nilai. */
  .nl :global(h2) { margin: var(--space-4) 0 0; font-size: 1.05em; }
  .nl :global(h2 small) { font-weight: 400; color: var(--text-muted); }
  .nl :global(ul) { list-style: none; margin: 0; padding: 0; }
  .nl :global(.stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-3); }
  .nl :global(.stat) { display: grid; gap: var(--space-1); }
  .nl :global(.big) { font-size: 2em; line-height: 1.1; font-family: var(--font-display); }
  .nl :global(.good) { color: var(--ok); }
  .nl :global(.mid) { color: var(--warn); }
  .nl :global(.low) { color: var(--danger); }
  .nl :global(.list) { display: grid; gap: var(--space-2); }
  .nl :global(.row) { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); }
  .nl :global(.txt) { flex: 1; min-width: 0; display: grid; }
  .nl :global(.txt small) { color: var(--text-muted); overflow-wrap: anywhere; }
  .nl :global(time) { flex: none; font-size: 0.85em; color: var(--text-muted); text-align: right; }
  .nl :global(.tile) { flex: none; display: grid; place-items: center; width: 2.6em; height: 2.6em; border-radius: var(--radius-3); background: var(--surface-2); font-weight: 700; }
  .nl :global(.tile.good) { background: var(--ok-soft); color: var(--ok); }
  .nl :global(.tile.mid) { background: var(--warn-soft); color: var(--warn); }
  .nl :global(.tile.low) { background: var(--danger-soft); color: var(--danger); }
  .nl :global(.chip) { display: inline-block; padding: 0 var(--space-2); border-radius: var(--radius-pill); font-size: 0.8em; font-weight: 700; background: var(--surface-2); color: var(--text-muted); white-space: nowrap; }
  .nl :global(.chip.good) { background: var(--ok-soft); color: var(--ok); }
  .nl :global(.chip.mid) { background: var(--info-soft); color: var(--info); }
  .nl :global(.chip.low) { background: var(--danger-soft); color: var(--danger); }
  .nl :global(.bars) { display: grid; gap: var(--space-2); padding: var(--space-3); }
  .nl :global(.bars li) { display: grid; grid-template-columns: minmax(90px, 170px) 1fr auto auto; gap: var(--space-3); align-items: center; }
  .nl :global(.bars .name) { overflow-wrap: anywhere; }
  .nl :global(.track) { height: var(--space-2); border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
  .nl :global(.track i) { display: block; height: 100%; border-radius: var(--radius-pill); background: var(--text-muted); }
  .nl :global(.track i.good) { background: var(--ok); }
  .nl :global(.track i.mid) { background: var(--warn); }
  .nl :global(.track i.low) { background: var(--danger); }
  .nl :global(.cols) { display: flex; align-items: flex-end; gap: var(--space-2); height: 190px; padding: var(--space-3) var(--space-3) var(--space-2); overflow-x: auto; }
  .nl :global(.cols li) { flex: 1 0 var(--space-5); min-width: var(--space-5); height: 100%; display: grid; grid-template-rows: auto 1fr auto; justify-items: center; gap: var(--space-1); }
  .nl :global(.cols .col) { width: 100%; max-width: var(--space-5); display: flex; align-items: flex-end; }
  .nl :global(.cols .col i) { display: block; width: 100%; min-height: var(--space-1); border-radius: var(--radius-1) var(--radius-1) 0 0; background: var(--text-muted); }
  .nl :global(.cols .col i.good) { background: var(--ok); }
  .nl :global(.cols .col i.mid) { background: var(--warn); }
  .nl :global(.cols .col i.low) { background: var(--danger); }
  .nl :global(.cols .v) { font-size: 0.8em; font-weight: 700; }
  .nl :global(.cols .l) { font-size: 0.75em; color: var(--text-muted); white-space: nowrap; }
  .nl :global(.note) { margin: 0; }
  .nl :global(a.card) { text-decoration: none; color: inherit; }
  @media (max-width: 560px) {
    .nl :global(.row) { flex-wrap: wrap; }
    .nl :global(time) { text-align: left; }
    .nl :global(.bars li) { grid-template-columns: 1fr auto; }
    .nl :global(.bars .track) { grid-column: 1 / -1; }
  }
</style>
