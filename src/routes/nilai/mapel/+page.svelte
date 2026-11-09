<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { ArrowDown, ArrowUp } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import type { SubjectStat } from "$lib/school/stats";
  import { signed, statusLabel, statusTone, tone } from "$lib/school/labels";

  type Key = "subject" | "weighted" | "average" | "median" | "stdev" | "trend" | "below" | "status";
  let key = $state<Key>("weighted");
  let desc = $state(false);
  const RANK = { risk: 0, improve: 1, ok: 2, strong: 3, nodata: 4 } as const;

  const val = (s: SubjectStat, k: Key): number | string =>
    k === "subject" ? s.subject : k === "status" ? RANK[s.status] : (s[k] ?? (desc ? -Infinity : Infinity));
  const rows = $derived(
    [...school.visibleSubjects].sort((a, b) => {
      const x = val(a, key);
      const y = val(b, key);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y);
      return desc ? -c : c;
    }),
  );
  function sort(k: Key) {
    if (key === k) desc = !desc;
    else {
      key = k;
      desc = false;
    }
  }
  const cols = $derived<[Key, string][]>([
    ["subject", tr("Mapel", "Subject")],
    ["weighted", tr("Berbobot", "Weighted")],
    ["average", tr("Sederhana", "Plain")],
    ["median", tr("Median", "Median")],
    ["stdev", tr("Stabil (±)", "Spread (±)")],
    ["trend", tr("Tren", "Trend")],
    ["below", tr(`< ${school.calc.passMark}`, `< ${school.calc.passMark}`)],
    ["status", tr("Status", "Status")],
  ]);
</script>

<p class="muted note">{tr("Klik judul kolom untuk mengurutkan. Klik nama mapel untuk melihat semua nilainya. Arti tiap kolom ada di bagian Hitungan.", "Click a heading to sort. Click a subject to see all its scores. What each column means is explained under Calculation.")}</p>

<div class="card wrap">
  <table>
    <thead>
      <tr>
        {#each cols as [k, label] (k)}
          <th class:num={k !== "subject" && k !== "status"} aria-sort={key === k ? (desc ? "descending" : "ascending") : "none"}>
            <button onclick={() => sort(k)}>{label}{#if key === k}{#if desc}<ArrowDown size={12} />{:else}<ArrowUp size={12} />{/if}{/if}</button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as s (s.subject)}
        <tr>
          <td><a href="/nilai/mapel/{encodeURIComponent(s.subject)}">{s.subject}</a>{#if s.major} <span class="chip mid">{tr("Peminatan", "Major")}</span>{/if}<small class="muted"> {s.graded}/{s.total}</small></td>
          <td class="num"><b class={tone(s.weighted, school.calc)}>{s.weighted ?? "-"}</b></td>
          <td class="num">{s.average ?? "-"}</td>
          <td class="num">{s.median ?? "-"}</td>
          <td class="num">{s.stdev ?? "-"}</td>
          <td class="num {s.trend === null ? '' : s.trend > 0 ? 'good' : s.trend < 0 ? 'low' : ''}">{signed(s.trend)}</td>
          <td class="num {s.below ? 'low' : ''}">{s.below}</td>
          <td><span class="chip {statusTone(s.status)}">{statusLabel(s.status)}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { padding: 0; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 640px; }
  th, td { padding: var(--space-3); text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  th button { display: inline-flex; align-items: center; gap: var(--space-1); background: none; border: 0; padding: 0; cursor: pointer; font: inherit; font-weight: 700; color: var(--text-muted); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td a { font-weight: 600; color: var(--link); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  td:first-child { white-space: normal; min-width: 160px; }
</style>
