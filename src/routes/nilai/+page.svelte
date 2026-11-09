<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { ranked } from "$lib/school/stats";
  import { signed, statusLabel, statusTone, tone } from "$lib/school/labels";
  import { clock, longDate } from "$lib/calendar/dates";

  const o = $derived(school.overview);
  const order = $derived(ranked(school.visibleSubjects));
  const m = $derived(school.calc.major);
  const levelText = $derived(school.levels.length ? tr(`Kelas ${school.levels.join(" dan ")}`, `Class ${school.levels.join(" and ")}`) : "");
  const general = $derived(school.levels.length > 0 && school.levels.every((l) => l < m.fromLevel));
  const weak = $derived(order.slice(0, 3));
  const strong = $derived([...order].reverse().filter((s) => !weak.includes(s) || order.length < 4).slice(0, 3));
  const upcoming = $derived(
    school.shown.filter((i) => i.score === null && i.due !== null && i.due >= Date.now()).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, 4),
  );
  const when = (t: number | null) => (t === null ? "" : `${clock(t)}, ${longDate(t)}`);
</script>

{#if levelText}
  <p class="card context">
    <b>{levelText}</b>
    {#if school.hasMajor}· {m.name ? tr(`Jurusan ${m.name}`, `${m.name} major`) : tr("Berjurusan", "With a major")}
    {:else if m.enabled && general}· {tr(`Masih umum, penjurusan mulai kelas ${m.fromLevel}`, `Still general, majors start in class ${m.fromLevel}`)}
    {:else if !m.enabled && school.levels.some((l) => l >= m.fromLevel)}· <a href="/nilai/hitungan">{tr("Aktifkan penjurusan supaya nilai dianalisis sesuai jurusan", "Turn on majors so scores are analysed for yours")}</a>
    {:else}· {tr("Kelas umum", "General class")}{/if}
  </p>
{/if}

<section class="stats">
  <div class="card stat">
    <small class="muted">{tr("Rata-rata berbobot", "Weighted average")}</small>
    <b class="big {tone(o.weighted, school.calc)}">{o.weighted ?? "-"}</b>
    <small class="muted">{tr("Sederhana", "Plain")}: {o.average ?? "-"}</small>
  </div>
  {#if school.overview.majorAverage !== null}
    <div class="card stat">
      <small class="muted">{tr("Mapel peminatan", "Major subjects")}</small>
      <b class="big {tone(school.overview.majorAverage, school.calc)}">{school.overview.majorAverage}</b>
      <small class="muted">{tr("Umum", "General")}: {school.overview.generalAverage ?? "-"}</small>
    </div>
  {/if}
  <div class="card stat">
    <small class="muted">{tr("Sudah dinilai", "Graded")}</small>
    <b class="big">{o.gradedPct ?? "-"}{o.gradedPct !== null ? "%" : ""}</b>
    <small class="muted">{o.graded} / {o.total}</small>
  </div>
  <div class="card stat">
    <small class="muted">{tr(`Di bawah ${school.calc.passMark}`, `Below ${school.calc.passMark}`)}</small>
    <b class="big {o.belowMark ? 'low' : ''}">{o.belowMark}</b>
    <small class="muted">{tr("penilaian", "assessments")}</small>
  </div>
  <div class="card stat">
    <small class="muted">{tr("Tertinggi / terendah", "Highest / lowest")}</small>
    <b class="big">{o.highest ?? "-"} <span class="muted slash">/</span> {o.lowest ?? "-"}</b>
  </div>
</section>
{#if school.last}
  <p class="muted note" role="status">{tr(`Diperbarui dari portal: ${school.last.added} baru, ${school.last.updated} berubah.`, `Updated from the portal: ${school.last.added} new, ${school.last.updated} changed.`)}</p>
{/if}

{#if order.length}
  <div class="two">
    <section>
      <h2><TrendingUp size={16} /> {tr("Mapel yang kamu kuasai", "Your strongest subjects")}</h2>
      <ul class="list">
        {#each strong as s (s.subject)}
          <li><a class="card row" href="/nilai/mapel/{encodeURIComponent(s.subject)}">
            <span class="tile {tone(s.weighted, school.calc)}">{s.weighted}</span>
            <span class="txt"><b>{s.subject}</b><small>{tr("Selisih dari rata-rata semua mapel", "Gap from your overall average")}: {signed(s.gap)}</small></span>
            <span class="tags">{#if s.major}<span class="chip mid">{tr("Peminatan", "Major")}</span>{/if}<span class="chip {statusTone(s.status)}">{statusLabel(s.status)}</span></span>
          </a></li>
        {/each}
      </ul>
    </section>
    <section>
      <h2><TrendingDown size={16} /> {tr("Perlu ditingkatkan", "Needs improvement")}</h2>
      <ul class="list">
        {#each weak as s (s.subject)}
          <li><a class="card row" href="/nilai/mapel/{encodeURIComponent(s.subject)}">
            <span class="tile {tone(s.weighted, school.calc)}">{s.weighted}</span>
            <span class="txt">
              <b>{s.subject}</b>
              <small>
                {#if s.below}{tr(`${s.below} penilaian di bawah ${school.calc.passMark}`, `${s.below} below ${school.calc.passMark}`)}{:else}{tr("Selisih", "Gap")}: {signed(s.gap)}{/if}
                {#if s.trend !== null}
                  · {#if s.trend > 0}<ArrowUpRight size={12} />{:else if s.trend < 0}<ArrowDownRight size={12} />{:else}<Minus size={12} />{/if} {signed(s.trend)}
                {/if}
              </small>
            </span>
            <span class="tags">{#if s.major}<span class="chip mid">{tr("Peminatan", "Major")}</span>{/if}<span class="chip {statusTone(s.status)}">{statusLabel(s.status)}</span></span>
          </a></li>
        {/each}
      </ul>
    </section>
  </div>
  <p class="muted note">{tr("Urutan memakai rata-rata berbobot (bobot jenis penilaian bisa diatur di bagian Hitungan). Buka satu mapel untuk melihat penyebabnya dan berapa nilai yang dibutuhkan.", "Ranking uses the weighted average (set the weights under Calculation). Open a subject to see why and what score you need.")}</p>
{/if}

{#if upcoming.length}
  <h2>{tr("Tenggat terdekat", "Next deadlines")} <small><a href="/nilai/tugas">{tr("Lihat semua", "See all")}</a></small></h2>
  <ul class="list">
    {#each upcoming as i (i.key)}
      <li class="card row"><span class="txt"><b>{i.subject}</b><small>{i.description || i.kind}</small></span><time>{when(i.due)}</time></li>
    {/each}
  </ul>
{/if}

<style>
  .slash { font-size: 0.6em; }
  .context { margin: 0; padding: var(--space-2) var(--space-3); }
  .tags { display: flex; gap: var(--space-1); flex-wrap: wrap; justify-content: flex-end; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-4); }
  .two h2 { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
</style>
