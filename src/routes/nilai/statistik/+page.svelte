<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { school } from "$lib/stores/school.svelte";
  import { byKind, byPeriod, distribution, monthly, ranked } from "$lib/school/stats";
  import { tone } from "$lib/school/labels";

  const trend = $derived(monthly(school.shown));
  const spread = $derived(distribution(school.shown, school.calc));
  const kinds = $derived(byKind(school.shown));
  const periods = $derived(byPeriod(school.items)); // membandingkan semester butuh semua data, bukan hanya yang terfilter
  const order = $derived([...ranked(school.visibleSubjects)].reverse());
  const peak = $derived(Math.max(1, ...spread.map((b) => b.count)));
  const monthName = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  };
</script>

<h2>{tr("Peringkat mata pelajaran", "Subject ranking")} <small>{tr("rata-rata berbobot, tertinggi ke terendah", "weighted average, high to low")}</small></h2>
<ul class="card bars">
  {#each order as s (s.subject)}
    <li><a class="name" href="/nilai/mapel/{encodeURIComponent(s.subject)}">{s.subject}</a><span class="track"><i class={tone(s.weighted, school.calc)} style:width="{s.weighted ?? 0}%"></i></span><b>{s.weighted}</b><small class="muted">{s.graded}</small></li>
  {:else}
    <li class="muted">{tr("Belum ada nilai.", "No scores yet.")}</li>
  {/each}
</ul>

{#if trend.length > 1}
  <h2>{tr("Perkembangan per bulan", "Month by month")} <small>{tr("rata-rata nilai menurut bulan tenggat", "average score by due month")}</small></h2>
  <ul class="card cols" aria-label={tr("Rata-rata nilai per bulan", "Average score per month")}>
    {#each trend as b (b.label)}
      <li><span class="v">{b.average}</span><span class="col"><i class={tone(b.average, school.calc)} style:height="{b.average ?? 0}%"></i></span><span class="l">{monthName(b.label)}</span></li>
    {/each}
  </ul>
{/if}

<h2>{tr("Sebaran nilai", "Score distribution")} <small>{tr("berapa penilaian di tiap rentang", "assessments per range")}</small></h2>
<ul class="card bars">
  {#each spread as b, i (b.label)}
    <li><span class="name">{b.label}</span><span class="track"><i class={i === 0 ? "low" : i === spread.length - 1 ? "good" : "mid"} style:width="{(b.count / peak) * 100}%"></i></span><b>{b.count}</b><small class="muted"></small></li>
  {/each}
</ul>

{#if kinds.length}
  <h2>{tr("Menurut jenis penilaian", "By assessment type")}</h2>
  <ul class="card bars">
    {#each kinds as k (k.label)}
      <li><span class="name">{k.label}</span><span class="track"><i class={tone(k.average, school.calc)} style:width="{k.average ?? 0}%"></i></span><b>{k.average}</b><small class="muted">{k.count}×</small></li>
    {/each}
  </ul>
{/if}

{#if periods.length > 1}
  <h2>{tr("Bandingkan semester", "Compare terms")} <small>{tr("semua data, tidak mengikuti filter", "all data, ignores the filter")}</small></h2>
  <ul class="card bars">
    {#each periods as p (p.label)}
      <li><span class="name">{p.label}</span><span class="track"><i class={tone(p.average, school.calc)} style:width="{p.average ?? 0}%"></i></span><b>{p.average}</b><small class="muted">{p.count}×</small></li>
    {/each}
  </ul>
{/if}

<style>
  .bars a.name { color: var(--link); text-decoration: none; }
  .bars a.name:hover { text-decoration: underline; }
</style>
