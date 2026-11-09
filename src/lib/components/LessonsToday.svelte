<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { CalendarCheck, NotebookPen, NotebookText } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { lessonsOn, lessonTimes } from "$lib/school/schedule";
  import { planLessonNote, noteTitle } from "$lib/school/lessonNotes";
  import { openLessonNote } from "$lib/school/openNote";
  import { semesterOf, summarizeAttendance } from "$lib/school/attendance";
  import { clock } from "$lib/calendar/dates";

  // Jam berjalan supaya "sedang berlangsung" dan "berikutnya" ikut berubah tanpa memuat ulang.
  let now = $state(Date.now());
  $effect(() => {
    const tick = () => (now = Date.now());
    const t = setInterval(tick, 30_000);
    // Timer webview bisa tertunda saat jendela tersembunyi atau Mac tidur: segarkan segera saat kembali dilihat.
    const wake = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", tick);
    };
  });

  const period = $derived(school.schedulePeriod);
  const today = $derived(new Date(now));
  const lessons = $derived(prefs.value.showLessons ? lessonsOn(school.lessons, period, today) : []);
  const rows = $derived(
    lessons.map((l) => {
      const { start, end } = lessonTimes(l, today);
      const state: "done" | "now" | "next" | "later" = now >= end ? "done" : now >= start ? "now" : "later";
      const stat = school.subjects.find((s) => s.subject === l.subject);
      return { l, start, end, state, weak: stat?.status === "improve" || stat?.status === "risk", hasNote: !!planLessonNote(ws.nodes, l.subject, noteTitle(l.subject, today)).noteId };
    }),
  );
  // Pelajaran yang paling dekat belum selesai ditandai "berikutnya" bila belum ada yang berlangsung.
  const nextIdx = $derived(rows.some((r) => r.state === "now") ? -1 : rows.findIndex((r) => r.state === "later"));

  // Bila hari ini tidak ada pelajaran (akhir pekan atau libur), tunjukkan pelajaran pertama yang berikutnya.
  const upcoming = $derived.by(() => {
    if (!period || !prefs.value.showLessons || lessons.length) return null;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const first = lessonsOn(school.lessons, period, d)[0];
      if (first) return { first, date: d };
    }
    return null;
  });

  const att = $derived.by(() => {
    const sem = semesterOf(new Date(now).toISOString().slice(0, 10));
    return summarizeAttendance(school.attendance.filter((d) => {
      const s = semesterOf(d.date);
      return s.year === sem.year && s.term === sem.term;
    }), school.calc.minAttendance);
  });

  let busy = $state<string | null>(null);
  async function note(subject: string) {
    busy = subject;
    try {
      await openLessonNote(subject, today);
    } finally {
      busy = null;
    }
  }
  const label = { done: () => tr("Selesai", "Done"), now: () => tr("Sedang berlangsung", "In progress"), next: () => tr("Berikutnya", "Up next"), later: () => "" };
  const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long" });
</script>

{#if rows.length || upcoming || att.recorded}
  <section class="lessons">
    <h2>{tr("Pelajaran hari ini", "Today's lessons")}</h2>
    <div class="card box">
      {#if rows.length}
        <ul>
          {#each rows as r, i (r.l.key)}
            {@const next = i === nextIdx}
            <li class:done={r.state === "done"} class:now={r.state === "now"} class:next>
              <time>{clock(r.start)}<span class="to">{clock(r.end)}</span></time>
              <span class="txt">
                <b>{r.l.subject}</b>
                <small>{r.l.subjectLocal !== r.l.subject ? `${r.l.subjectLocal} · ` : ""}{r.l.room}</small>
              </span>
              <span class="tags">
                {#if r.weak}<span class="chip low" title={tr("Mapel ini sedang perlu ditingkatkan", "This subject needs work")}>{tr("Perlu ditingkatkan", "Needs work")}</span>{/if}
                {#if r.state !== "later" || next}<span class="chip {r.state === 'now' ? 'good' : 'mid'}">{r.state === "later" ? label.next() : label[r.state]()}</span>{/if}
              </span>
              <button class="btn" disabled={busy === r.l.subject} onclick={() => note(r.l.subject)} title={r.hasNote ? tr("Buka catatan pelajaran ini", "Open this lesson's note") : tr("Buat catatan Cornell untuk pelajaran ini", "Create a Cornell note for this lesson")}>
                {#if r.hasNote}<NotebookText size={14} />{tr("Buka catatan", "Open note")}{:else}<NotebookPen size={14} />{tr("Catatan", "Note")}{/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if upcoming}
        <p class="muted none">{tr("Tidak ada pelajaran hari ini.", "No lessons today.")} {tr(`Berikutnya ${dayName(upcoming.date)} ${upcoming.first.begin}: ${upcoming.first.subject}.`, `Next ${dayName(upcoming.date)} ${upcoming.first.begin}: ${upcoming.first.subject}.`)}</p>
      {/if}
      {#if att.recorded}
        <a class="att" href="/nilai/kehadiran">
          <CalendarCheck size={14} />
          {tr(`Kehadiran semester ini ${att.pct}%`, `Attendance this term ${att.pct}%`)}
          {#if att.pct !== null && att.pct >= school.calc.minAttendance}· {tr(`boleh absen ${att.canMiss} hari lagi`, `you can miss ${att.canMiss} more days`)}{:else}· {tr(`perlu hadir ${att.needPresent} hari berturut-turut`, `${att.needPresent} present days in a row needed`)}{/if}
        </a>
      {/if}
    </div>
  </section>
{/if}

<style>
  .lessons { margin-bottom: var(--space-4); }
  .box { display: grid; gap: var(--space-3); padding: var(--space-3); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  li { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-3); }
  li.now { background: var(--ok-soft); }
  li.next { background: var(--accent-soft); }
  li.done { opacity: 0.55; }
  time { display: grid; font-variant-numeric: tabular-nums; font-weight: 700; min-width: 3.4em; }
  .to { font-weight: 400; color: var(--text-muted); font-size: 0.85em; }
  .txt { display: grid; min-width: 0; }
  .txt small { color: var(--text-muted); overflow-wrap: anywhere; }
  .tags { display: flex; gap: var(--space-1); flex-wrap: wrap; justify-content: flex-end; }
  .chip { display: inline-block; padding: 0 var(--space-2); border-radius: var(--radius-pill); font-size: 0.8em; font-weight: 700; background: var(--surface-2); color: var(--text-muted); white-space: nowrap; }
  .chip.good { background: var(--ok); color: var(--surface); }
  .chip.mid { background: var(--info-soft); color: var(--info); }
  .chip.low { background: var(--danger-soft); color: var(--danger); }
  .btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); white-space: nowrap; }
  .none { margin: 0; }
  .att { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--link); text-decoration: none; justify-self: start; }
  @media (max-width: 560px) {
    li { grid-template-columns: auto 1fr; }
    .tags, .btn { grid-column: 2; justify-self: start; }
  }
</style>
