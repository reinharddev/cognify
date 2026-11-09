<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { Award, ClipboardList } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { clock, longDate } from "$lib/calendar/dates";
  import { moodle } from "$lib/stores/moodle.svelte";
  import { courseName } from "$lib/moodle/format";

  const now = $derived(Date.now());
  const pending = $derived(school.shown.filter((i) => i.score === null && i.due !== null).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)));
  const upcoming = $derived(pending.filter((i) => (i.due ?? 0) >= now));
  const waiting = $derived(pending.filter((i) => (i.due ?? 0) < now).reverse());
  // Tugas Moodle (bila Moodle tersambung): yang belum dikumpulkan, urut tenggat.
  const mdPending = $derived(moodle.active ? moodle.items.filter((i) => !i.submitted).sort((a, b) => a.due.localeCompare(b.due)) : []);
  const mdLate = $derived(mdPending.filter((i) => Date.parse(i.due) < now));
  const mdSoon = $derived(mdPending.filter((i) => Date.parse(i.due) >= now));
  const mdDone = $derived(moodle.active ? moodle.items.filter((i) => i.submitted).length : 0);
  const when = (t: number | null) => (t === null ? "" : `${clock(t)}, ${longDate(t)}`);
</script>

<p class="muted note">{tr("Tugas dan ujian yang belum ada nilainya. Yang tenggatnya belum lewat muncul di Kalender dan berbunyi sehari sebelumnya.", "Assignments and exams without a score yet. Those not yet due show in the Calendar and ring a day before.")}</p>

<h2>{tr("Tenggat mendatang", "Upcoming deadlines")} <small>({upcoming.length})</small></h2>
{#if upcoming.length}
  <ul class="list">
    {#each upcoming as i (i.key)}
      <li class="card row"><span class="tile"><Award size={16} /></span><span class="txt"><b>{i.subject}</b><small>{i.kind}{i.description ? `, ${i.description}` : ""}</small></span><time>{when(i.due)}</time></li>
    {/each}
  </ul>
{:else}
  <p class="muted">{tr("Tidak ada tenggat mendatang di periode ini.", "No upcoming deadlines in this period.")}</p>
{/if}

<h2>{tr("Menunggu nilai", "Waiting for a score")} <small>({waiting.length})</small></h2>
{#if waiting.length}
  <ul class="list">
    {#each waiting as i (i.key)}
      <li class="card row"><span class="tile"><ClipboardList size={16} /></span><span class="txt"><b>{i.subject}</b><small>{i.kind}{i.description ? `, ${i.description}` : ""}</small></span><time>{when(i.due)}</time></li>
    {/each}
  </ul>
{:else}
  <p class="muted">{tr("Semua yang lewat tenggat sudah dinilai.", "Everything past its deadline has been graded.")}</p>
{/if}

{#if moodle.active}
  <h2>{tr("Tugas Moodle", "Moodle tasks")} <small>({mdPending.length}{mdDone ? tr(`, ${mdDone} sudah dikumpulkan`, `, ${mdDone} submitted`) : ""})</small></h2>
  {#if mdPending.length}
    <ul class="list">
      {#each [...mdLate, ...mdSoon] as i (i.id)}
        <li class="card row">
          <span class="tile"><ClipboardList size={16} /></span>
          <span class="txt"><b>{i.title}</b><small>{courseName(i.course)}{i.state === "draft" ? ` · ${tr("konsep tersimpan", "draft saved")}` : ""}{Date.parse(i.due) < now ? ` · ${tr("terlambat", "overdue")}` : ""}</small></span>
          <time>{when(Date.parse(i.due))}</time>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{tr("Semua tugas Moodle sudah dikumpulkan.", "All Moodle tasks have been submitted.")}</p>
  {/if}
{/if}
