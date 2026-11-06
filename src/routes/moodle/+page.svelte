<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { Check, ChevronRight, Search } from "@lucide/svelte";
  import { moodleApi, type MoodleCourse } from "$lib/moodle/api";
  import { courseName, isAssessment } from "$lib/moodle/format";
  import { moodle } from "$lib/stores/moodle.svelte";

  const HIDE_KEY = "cognify.moodle.hideAssessment";
  const readHide = () => {
    try {
      return localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  };

  let courses = $state<MoodleCourse[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let query = $state("");
  /** Saring mapel "Assessment". Tetap berlaku sampai pengguna mematikannya (disimpan di perangkat ini). */
  let hideAssessment = $state(readHide());

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return courses
      .filter((c) => !(hideAssessment && isAssessment(c.name)))
      .filter((c) => !q || `${courseName(c.name)} ${c.name}`.toLowerCase().includes(q));
  });
  /** Warna kategori yang tetap untuk satu mapel (dari namanya), supaya mapel mudah dikenali sekilas. */
  const hueOf = (name: string) => {
    let h = 0;
    for (const ch of courseName(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 8;
  };
  const pctOf = (c: MoodleCourse) => (c.files ? Math.round((c.saved / c.files) * 100) : 0);
  const hiddenCount = $derived(courses.filter((c) => isAssessment(c.name)).length);

  function setHide(on: boolean) {
    hideAssessment = on;
    try {
      localStorage.setItem(HIDE_KEY, on ? "1" : "0");
    } catch {
      /* hanya kenyamanan: tanpa penyimpanan, saringan berlaku sampai app ditutup */
    }
  }

  // Dimuat begitu Moodle siap (status dimuat setelah app dibuka, bisa lebih lambat dari halaman ini).
  $effect(() => {
    if (!moodle.active) return;
    void (async () => {
      try {
        courses = await moodleApi.courses();
        error = null;
      } catch (e) {
        error = e instanceof Error ? e.message : tr("Terjadi kesalahan.", "Something went wrong.");
      } finally {
        loaded = true;
      }
    })();
  });
</script>

<div class="page">
  <h1>{tr("Materi", "Materials")}</h1>

  {#if !moodle.active}
    <p class="hint">{tr("Moodle belum dinyalakan.", "Moodle is not turned on.")} <a href="/settings">{tr("Buka Pengaturan", "Open Settings")}</a></p>
  {:else}
    <p class="hint">{tr("Pilih mata pelajaran untuk melihat materinya. Materi yang disimpan bisa dibuka tanpa internet, dan unduhan berjalan di latar.", "Pick a course to see its materials. Saved materials open without internet, and downloads run in the background.")}</p>

    <div class="bar">
      <label class="search"><Search size={15} /><input type="search" placeholder={tr("Cari mata pelajaran…", "Search courses…")} aria-label={tr("Cari mata pelajaran", "Search courses")} bind:value={query} /></label>
      <label class="flt" title={tr("Sembunyikan mapel yang namanya mengandung Assessment. Tetap berlaku sampai kamu mematikannya.", "Hide courses whose name contains Assessment. Stays on until you turn it off.")}>
        <input type="checkbox" role="switch" checked={hideAssessment} onchange={(e) => setHide(e.currentTarget.checked)} />
        <span>{tr("Sembunyikan Assessment", "Hide Assessment")}</span>
        {#if hideAssessment && hiddenCount}<small>{hiddenCount}</small>{/if}
      </label>
    </div>

    {#if error}<p class="err" role="alert">{error}</p>{/if}

    {#if visible.length}
      <ul class="grid">
        {#each visible as c (c.id)}
          {@const done = c.files > 0 && c.saved === c.files}
          <li>
            <a class="card course" href="/moodle/{c.id}" title={c.name} style="--hue: var(--cat-{hueOf(c.name)})">
              <span class="tile" aria-hidden="true">{courseName(c.name).charAt(0).toUpperCase()}</span>
              <span class="txt">
                <span class="name">{courseName(c.name)}</span>
                <span class="meta" class:done>
                  {#if c.files}
                    {#if done}<Check size={13} />{/if}{tr(`${c.saved}/${c.files} tersimpan`, `${c.saved}/${c.files} saved`)}
                  {:else}
                    {tr("Buka materi", "Open materials")}
                  {/if}
                </span>
              </span>
              <ChevronRight class="go" size={18} />
              {#if c.files}
                <span class="bar2" role="progressbar" aria-label={tr("Tersimpan", "Saved")} aria-valuenow={pctOf(c)} aria-valuemin="0" aria-valuemax="100"><i style="width:{pctOf(c)}%"></i></span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {:else if loaded}
      <p class="hint">
        {#if courses.length === 0}{tr("Belum ada mata pelajaran. Sinkronkan dulu di Pengaturan → Moodle.", "No courses yet. Sync first in Settings → Moodle.")}
        {:else if query}{tr("Tidak ada mata pelajaran yang cocok.", "No matching courses.")}
        {:else}{tr("Semua mata pelajaran tersembunyi oleh saringan Assessment.", "Every course is hidden by the Assessment filter.")}{/if}
      </p>
    {/if}
  {/if}
</div>

<style>
  .page { padding: var(--space-4); max-width: 1040px; margin: 0 auto; min-width: 0; }
  h1 { margin: 0 0 var(--space-2); }
  .hint { color: var(--text-muted); max-width: 560px; margin: 0 0 var(--space-4); }
  .err { color: var(--danger); margin: var(--space-2) 0; }

  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); margin-bottom: var(--space-5); }
  .search { flex: 1 1 240px; max-width: 360px; display: flex; align-items: center; gap: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: var(--space-2) var(--space-3); color: var(--text-muted); background: var(--surface); }
  .search input { flex: 1; border: 0; background: none; outline: none; font: inherit; color: var(--text); min-width: 0; }
  .search:focus-within { border-color: var(--accent-strong); }
  .flt { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); cursor: pointer; }
  .flt small { background: var(--surface-2); border-radius: var(--radius-pill); padding: 0 var(--space-2); font-variant-numeric: tabular-nums; }

  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: var(--space-3); }
  /* Kartu horizontal: kotak warna di kiri, nama dan status di tengah, panah di kanan. Dasarnya kelas .card global
     (garis tinta dan bayangan), jadi tampilannya serumpun dengan kartu di Beranda dan Alat. */
  .course {
    /* Radius bersarang konsentris: kartu 20 − jarak 12 = 8 untuk kotak warna (rumus di docs/UI_SCALE.md). */
    --r-out: var(--radius-4);
    --pad: var(--space-3);
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    box-sizing: border-box;
    height: 100%;
    padding: var(--pad);
    text-decoration: none;
    color: var(--text);
    overflow: hidden;
    transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
  }
  .course:hover { transform: translate(var(--hop), var(--hop)); box-shadow: var(--lift-lg); }
  .course:active { transform: none; box-shadow: none; }
  .course:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 3px; }
  .tile {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: max(calc(var(--r-out) - var(--pad)), var(--radius-1));
    background: color-mix(in srgb, var(--hue) 20%, var(--surface));
    color: color-mix(in srgb, var(--hue) 78%, var(--text));
    font-weight: 700;
    font-size: 1.15em;
  }
  .txt { min-width: 0; display: flex; flex-direction: column; gap: var(--space-0); }
  .name { font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text-muted); font-size: 0.88em; }
  .meta.done { color: var(--accent-strong); font-weight: 600; }
  .course :global(.go) { color: var(--text-muted); transition: transform var(--dur-1) var(--ease-out), color var(--dur-1); }
  .course:hover :global(.go) { color: var(--text); transform: translateX(var(--space-1)); }
  /* Bilah kemajuan tipis di dasar kartu, selebar kartu */
  .bar2 { position: absolute; inset: auto 0 0 0; height: var(--space-1); background: var(--surface-2); }
  .bar2 i { display: block; height: 100%; background: var(--hue); }
  @media (prefers-reduced-motion: reduce) { .course, .course :global(.go) { transition: none; } .course:hover { transform: none; } .course:hover :global(.go) { transform: none; } }
</style>
