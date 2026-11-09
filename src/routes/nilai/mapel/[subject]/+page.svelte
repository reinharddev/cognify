<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { page } from "$app/state";
  import { ArrowLeft } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { neededAverage, scored } from "$lib/school/stats";
  import { signed, statusHint, statusLabel, statusTone, tone } from "$lib/school/labels";
  import { clock, longDate } from "$lib/calendar/dates";

  const name = $derived(decodeURIComponent(page.params.subject ?? ""));
  const stat = $derived(school.subjects.find((s) => s.subject === name));
  const items = $derived(school.shown.filter((i) => i.subject === name).sort((a, b) => (b.due ?? 0) - (a.due ?? 0)));
  const timeline = $derived(scored(items).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(-14));
  let targetPick = $state<number | null>(null);
  const target = $derived(targetPick ?? school.calc.target);
  const needs = $derived([1, 2, 3].map((n) => ({ n, avg: neededAverage(items, target, n) })));

  const when = (t: number | null) => (t === null ? "" : `${clock(t)}, ${longDate(t)}`);
  const short = (t: number | null) => (t === null ? "" : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  const verdict = (avg: number | null) =>
    avg === null ? "" : avg > 100 ? tr("Tidak tercapai dengan jumlah ini", "Not reachable with this many") : avg <= 0 ? tr("Sudah tercapai", "Already reached") : String(avg);
</script>

<p class="back"><a href="/nilai/mapel"><ArrowLeft size={14} /> {tr("Semua mapel", "All subjects")}</a></p>

{#if !stat}
  <section class="card pad"><p class="muted">{tr("Mapel ini tidak ada di periode yang dipilih. Ganti tahun ajaran atau semester di atas.", "This subject has no data in the selected period. Change the school year or term above.")}</p></section>
{:else}
  <header class="head">
    <h2>{name}</h2>
    {#if stat.major}<span class="chip mid">{school.calc.major.name ? tr(`Peminatan ${school.calc.major.name}`, `${school.calc.major.name} major`) : tr("Peminatan", "Major")}</span>{/if}
    <span class="chip {statusTone(stat.status)}" title={statusHint(stat.status)}>{statusLabel(stat.status)}</span>
  </header>
  <p class="muted note">{statusHint(stat.status)}</p>

  <section class="stats">
    <div class="card stat"><small class="muted">{tr("Rata-rata berbobot", "Weighted average")}</small><b class="big {tone(stat.weighted, school.calc)}">{stat.weighted ?? "-"}</b><small class="muted">{tr("Selisih dari semua mapel", "Gap from all subjects")}: {signed(stat.gap)}</small></div>
    <div class="card stat"><small class="muted">{tr("Sederhana / median", "Plain / median")}</small><b class="big">{stat.average ?? "-"} <span class="muted slash">/</span> {stat.median ?? "-"}</b></div>
    <div class="card stat"><small class="muted">{tr("Tertinggi / terendah", "Highest / lowest")}</small><b class="big">{stat.max ?? "-"} <span class="muted slash">/</span> {stat.min ?? "-"}</b></div>
    <div class="card stat"><small class="muted">{tr("Tren terbaru", "Latest trend")}</small><b class="big {stat.trend === null ? '' : stat.trend >= 0 ? 'good' : 'low'}">{signed(stat.trend)}</b><small class="muted">{stat.trend === null ? tr("Butuh 3 nilai", "Needs 3 scores") : tr("poin dari nilai sebelumnya", "points vs earlier scores")}</small></div>
    <div class="card stat"><small class="muted">{tr("Kestabilan (±)", "Spread (±)")}</small><b class="big">{stat.stdev ?? "-"}</b><small class="muted">{stat.stdev === null ? "" : stat.stdev <= 5 ? tr("stabil", "steady") : stat.stdev <= 10 ? tr("cukup naik turun", "some ups and downs") : tr("naik turun besar", "very uneven")}</small></div>
    <div class="card stat"><small class="muted">{tr(`Di bawah ${school.calc.passMark}`, `Below ${school.calc.passMark}`)}</small><b class="big {stat.below ? 'low' : ''}">{stat.below}</b><small class="muted">{stat.graded} / {stat.total} {tr("dinilai", "graded")}</small></div>
  </section>

  {#if timeline.length > 1}
    <h2>{tr("Nilai dari waktu ke waktu", "Scores over time")}</h2>
    <ul class="card cols" aria-label={tr("Nilai per penilaian", "Score per assessment")}>
      {#each timeline as i (i.key)}
        <li title={i.description || i.kind}><span class="v">{i.score}</span><span class="col"><i class={tone(i.score, school.calc)} style:height="{i.score}%"></i></span><span class="l">{short(i.due)}</span></li>
      {/each}
    </ul>
  {/if}

  {#if stat.kinds.length}
    <h2>{tr("Rata-rata menurut jenis", "Average by type")}</h2>
    <ul class="card bars">
      {#each stat.kinds as k (k.label)}
        <li><span class="name">{k.label}</span><span class="track"><i class={tone(k.average, school.calc)} style:width="{k.average ?? 0}%"></i></span><b>{k.average}</b><small class="muted">{k.count}×</small></li>
      {/each}
    </ul>
  {/if}

  {#if stat.graded}
    <h2>{tr("Berapa nilai yang kamu butuhkan?", "What score do you need?")}</h2>
    <section class="card need">
      <label>{tr("Target rata-rata", "Target average")}
        <input type="number" min="1" max="100" value={target} oninput={(e) => (targetPick = Number(e.currentTarget.value) || null)} />
      </label>
      <ul>
        {#each needs as r (r.n)}
          <li><span>{tr(`Jika ${r.n} penilaian lagi`, `With ${r.n} more`)}</span><b class={r.avg !== null && r.avg > 100 ? "low" : ""}>{verdict(r.avg)}</b></li>
        {/each}
      </ul>
      <small class="muted">{tr("Memakai rata-rata sederhana dari semua nilai di periode ini. Rumus sekolahmu bisa berbeda (bobot), jadi anggap ini perkiraan.", "Uses the plain average of all scores in this period. Your school's formula may differ (weights), so treat it as an estimate.")}</small>
    </section>
  {/if}

  <h2>{tr("Semua penilaian", "All assessments")} <small>({items.length})</small></h2>
  <ul class="list">
    {#each items as i (i.key)}
      <li class="card row">
        <span class="tile {tone(i.score, school.calc)}">{i.score ?? "·"}{#if i.adjusted}<sup title={tr("Nilai disesuaikan oleh sekolah", "Score adjusted by the school")}>*</sup>{/if}</span>
        <span class="txt"><b>{i.description || i.kind}</b><small>{i.kind}{i.score === null ? ` · ${tr("belum dinilai", "not graded yet")}` : ""}</small></span>
        <time>{when(i.due)}</time>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .back { margin: 0; }
  .back a { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--link); text-decoration: none; }
  .head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .head h2 { margin: 0; font-size: 1.5em; }
  .pad { padding: var(--space-4); }
  .slash { font-size: 0.6em; }
  .need { display: grid; gap: var(--space-3); }
  .need label { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .need input { width: 6em; }
  .need ul { display: grid; gap: var(--space-2); }
  .need li { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border); }
</style>
