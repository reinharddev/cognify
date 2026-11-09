<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { CalendarCheck } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { summarizeAttendance, type AttendanceDay } from "$lib/school/attendance";
  import { longDate, parseDayKey } from "$lib/calendar/dates";

  const min = $derived(school.calc.minAttendance);
  const days = $derived(school.shownAttendance);
  const s = $derived(summarizeAttendance(days, min));
  const ok = $derived(s.pct !== null && s.pct >= min);
  // Hari yang tidak hadir penuh, terbaru dulu.
  const away = $derived(days.filter((d) => d.kind !== "present" && d.kind !== "late").slice().reverse());
  const kindLabel = (d: AttendanceDay) =>
    ({ present: tr("Hadir", "Present"), late: tr("Terlambat", "Late"), permit: tr("Izin", "Permitted"), sick: tr("Sakit", "Sick"), absent: tr("Alpa", "Absent"), other: d.status })[d.kind];
  const when = (date: string) => {
    const ms = parseDayKey(date);
    return ms === null ? date : longDate(ms);
  };
</script>

{#if school.attendance.length === 0}
  <section class="card empty">
    <span class="bubble"><CalendarCheck size={22} /></span>
    <h2>{tr("Belum ada data kehadiran", "No attendance data yet")}</h2>
    <p class="muted">{tr("Klik ikon ekstensi di portal sekolah lalu \"Kirim nilai sekolah ke Cognify\". Kehadiran ikut terkirim bersama nilai dan jadwal.", "Click the extension icon on the school portal, then \"Send school grades to Cognify\". Attendance is sent along with grades and the timetable.")}</p>
  </section>
{:else if days.length === 0}
  <p class="muted">{tr("Tidak ada data kehadiran di periode yang dipilih. Ganti tahun ajaran atau semester di atas.", "No attendance in the selected period. Change the school year or term above.")}</p>
{:else}
  <section class="stats">
    <div class="card stat">
      <small class="muted">{tr("Kehadiran", "Attendance")}</small>
      <b class="big {ok ? 'good' : 'low'}">{s.pct}%</b>
      <small class="muted">{tr(`batas ${min}%`, `limit ${min}%`)}</small>
    </div>
    <div class="card stat">
      <small class="muted">{tr("Hadir", "Present")}</small>
      <b class="big">{s.present + s.late}</b>
      <small class="muted">{tr(`dari ${s.recorded} hari tercatat`, `of ${s.recorded} recorded days`)}</small>
    </div>
    <div class="card stat">
      <small class="muted">{ok ? tr("Masih boleh tidak hadir", "Days you can still miss") : tr("Perlu hadir berturut-turut", "Present days in a row needed")}</small>
      <b class="big {ok ? '' : 'low'}">{ok ? s.canMiss : s.needPresent}</b>
      <small class="muted">{ok ? tr("hari, tanpa turun di bawah batas", "days, without going under the limit") : tr("hari, untuk kembali ke batas", "days, to get back to the limit")}</small>
    </div>
    <div class="card stat">
      <small class="muted">{tr("Rata-rata jam masuk", "Average arrival")}</small>
      <b class="big">{s.avgCheckIn ?? "-"}</b>
    </div>
  </section>

  <p class="muted note">
    {tr(
      "Dihitung dari hari yang tercatat di portal sejauh ini, bukan seluruh hari sekolah satu semester, jadi anggap sisa jatah sebagai perkiraan. Izin dan sakit tidak dihitung hadir.",
      "Based on the days the portal has recorded so far, not every school day of the term, so treat the allowance as an estimate. Permitted and sick days do not count as present.",
    )}
  </p>

  <h2>{tr("Rincian", "Breakdown")}</h2>
  <ul class="card bars">
    {#each [[tr("Hadir", "Present"), s.present, "good"], [tr("Terlambat", "Late"), s.late, "mid"], [tr("Izin", "Permitted"), s.permit, "mid"], [tr("Sakit", "Sick"), s.sick, "mid"], [tr("Alpa", "Absent"), s.absent, "low"], [tr("Lainnya", "Other"), s.other, ""]] as [label, n, cls] (label)}
      {#if n}
        <li><span class="name">{label}</span><span class="track"><i class={String(cls)} style:width="{(Number(n) / s.recorded) * 100}%"></i></span><b>{n}</b><small class="muted">{Math.round((Number(n) / s.recorded) * 100)}%</small></li>
      {/if}
    {/each}
  </ul>

  <h2>{tr("Hari tidak hadir penuh", "Days not fully present")} <small>({away.length})</small></h2>
  {#if away.length}
    <ul class="list">
      {#each away as d (d.date)}
        <li class="card row"><span class="txt"><b>{when(d.date)}</b></span><span class="chip {d.kind === 'absent' ? 'low' : 'mid'}">{kindLabel(d)}</span></li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{tr("Tidak ada. Semua hari tercatat hadir.", "None. Every recorded day is present.")}</p>
  {/if}
{/if}

<style>
  .empty { display: grid; justify-items: start; gap: var(--space-2); padding: var(--space-5); }
  .empty h2, .empty p { margin: 0; }
  .bubble { display: grid; place-items: center; width: 3.2em; height: 3.2em; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--link); }
</style>
