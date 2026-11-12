<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { ExternalLink, Target } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { openHref } from "$lib/openHref";
  import { ALL_DAYS, currentWeek, daysOf, formatMinutes, planFor, SDC_URL } from "$lib/school/sdc";
  import Select from "$lib/ui/Select.svelte";

  const sdc = $derived(school.sdc);
  const p = $derived(prefs.value);
  const lang = $derived(tr("id", "en") === "id" ? "id" : "en");
  const fmt = (min: number) => formatMinutes(min, lang);
  const week = $derived(sdc ? currentWeek(sdc, Date.now()) : null);
  const closing = $derived(week?.closesAt ? new Date(week.closesAt).toLocaleString([], { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const dayNames = $derived([tr("Sen", "Mon"), tr("Sel", "Tue"), tr("Rab", "Wed"), tr("Kam", "Thu"), tr("Jum", "Fri"), tr("Sab", "Sat"), tr("Min", "Sun")]);
  /** Tombol hari dari Senin sampai Minggu (nilai Date.getDay(): 1..6 lalu 0). */
  const DAY_ORDER = ALL_DAYS;
  function toggleDay(name: string, day: number) {
    const now = daysOf(p.sdcDays, name);
    const next = now.includes(day) ? now.filter((d) => d !== day) : [...now, day];
    if (!next.length) return; // minimal satu hari
    prefs.set({ sdcDays: { ...p.sdcDays, [name]: next } });
  }
  const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const updated = $derived(sdc ? new Date(sdc.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
</script>

{#if !sdc}
  <section class="card empty">
    <span class="bubble"><Target size={22} /></span>
    <h2>{tr("Belum ada data SDC", "No SDC data yet")}</h2>
    <p class="muted">{tr("Buka portal CIS, klik ikon ekstensi Cognify, lalu \"Kirim nilai sekolah ke Cognify\". Ekstensi pindah sendiri ke halaman Academic, lalu ke Self Development Challenge, dan membaca progres mingguanmu.", "Open the CIS portal, click the Cognify extension icon, then \"Send school grades to Cognify\". The extension moves to the Academic page by itself, then to Self Development Challenge, and reads your weekly progress.")}</p>
    <button class="btn" onclick={() => openHref(SDC_URL)}><ExternalLink size={14} /> {tr("Buka SDC di CIS", "Open SDC on CIS")}</button>
  </section>
{:else}
  <header class="head">
    <p class="muted">{sdc.period ? `${sdc.period} · ` : ""}{tr(`dibaca ${updated}`, `read ${updated}`)}</p>
    <button class="btn" onclick={() => openHref(SDC_URL)}><ExternalLink size={14} /> {tr("Buka SDC di CIS", "Open SDC on CIS")}</button>
  </header>

  {#if week}
    <p class="week" role="status">
      <b>{tr(`Minggu ${week.index}`, `Week ${week.index}`)}</b>
      {tr(`ditutup ${closing}`, `closes ${closing}`)} ·
      {week.filled ? tr("sudah terisi di CIS", "already filled in on CIS") : tr("belum terisi di CIS", "not filled in on CIS yet")}
    </p>
  {/if}
  <p class="muted note">{tr("Satu minggu di CIS berjalan Senin sampai Senin, jadi Sabtu dan Minggu ikut dihitung.", "A CIS week runs Monday to Monday, so Saturday and Sunday count too.")}</p>

  <ul class="list">
    {#each sdc.challenges as c (c.name)}
      <li class="card ch">
        <div class="top">
          <b>{c.name}</b>
          <span class="pct">{c.percent}%</span>
        </div>
        {#if c.how}<p class="how muted">{c.how}</p>{/if}
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={c.percent} aria-label={c.name}><i style:width="{c.percent}%"></i></div>
        <p class="meta muted">
          {fmt(c.doneMin)} {tr("dari", "of")} {fmt(c.totalMin)} · {tr(`target ${fmt(c.weeklyMin)} per minggu (maksimal di CIS)`, `goal ${fmt(c.weeklyMin)} a week (the maximum on CIS)`)}
        </p>
        {#if sdc}
          {@const plan = planFor(sdc, c, Date.now(), daysOf(p.sdcDays, c.name))}
          {#if plan}
            <div class="plan">
              {#each plan.weeks.slice(0, 2) as w, i (w.index)}
                <p>
                  <b>{i === 0 ? tr("Minggu ini", "This week") : tr("Minggu depan", "Next week")} ({tr(`minggu ${w.index}`, `week ${w.index}`)})</b>:
                  {#if w.room === 0}
                    {tr("sudah penuh ✓", "already full ✓")}
                  {:else if w.perDay !== null}
                    {tr(`kurang ${fmt(w.room)} →`, `${fmt(w.room)} to go →`)} <b class="need">{tr(`${w.perDay} menit per hari`, `${w.perDay} min per day`)}</b>
                    <span class="muted">({tr(`${w.daysLeft} hari kerja lagi`, `${w.daysLeft} working days left`)})</span>
                  {:else}
                    {tr(`kurang ${fmt(w.room)}; tinggal diisi di CIS sebelum ${when(w.closesAt)}`, `${fmt(w.room)} to go; just fill it in on CIS before ${when(w.closesAt)}`)}
                  {/if}
                </p>
              {/each}
              <p class="max" class:ok={plan.reachable}>
                {#if plan.reachable}
                  {tr("100% masih bisa dicapai kalau semua minggu yang tersisa diisi penuh.", "100% is still within reach if every remaining week is filled in full.")}
                {:else}
                  {tr(`100% sudah tidak bisa dicapai: minggu yang sudah ditutup di CIS tidak bisa diisi lagi, dan tiap minggu maksimal ${fmt(c.weeklyMin)}. Yang masih mungkin: `, `100% is out of reach: weeks already closed on CIS cannot be filled in again, and each week is capped at ${fmt(c.weeklyMin)}. Still possible: `)}<b>{plan.maxPercent}%</b>.
                {/if}
              </p>
            </div>
          {/if}
        {/if}
        <div class="days" role="group" aria-label={tr(`Hari kerja ${c.name}`, `Working days for ${c.name}`)}>
          <span class="muted">{tr("Hari kerja", "Working days")}</span>
          {#each DAY_ORDER as d, i}
            <button type="button" class="day" class:on={daysOf(p.sdcDays, c.name).includes(d)} aria-pressed={daysOf(p.sdcDays, c.name).includes(d)} onclick={() => toggleDay(c.name, d)}>{dayNames[i]}</button>
          {/each}
        </div>
        <ol class="weeks" aria-label={tr("Menit tiap minggu", "Minutes each week")}>
          {#each c.weeks as w, i}
            <li class:filled={w !== null && w > 0} class:met={w !== null && w >= c.weeklyMin} title={tr(`Minggu ${i + 1}: ${w ?? 0} menit`, `Week ${i + 1}: ${w ?? 0} min`)}>
              <span>{i + 1}</span>
            </li>
          {/each}
        </ol>
      </li>
    {/each}
  </ul>
{/if}

<section class="card set">
  <h2>{tr("Pengingat", "Reminders")}</h2>
  <label class="row">
    <div><b>{tr("Kerjakan SDC hari ini", "Work on SDC today")}</b><small class="muted">{tr("Menyebut target harian tiap tantangan.", "Lists the daily goal of each challenge.")}</small></div>
    <span class="ctl">
      <input type="time" value={p.sdcDailyTime} disabled={!p.sdcDaily} aria-label={tr("Jam pengingat harian", "Daily reminder time")} onchange={(e) => e.currentTarget.value && prefs.set({ sdcDailyTime: e.currentTarget.value })} />
      <input type="checkbox" role="switch" checked={p.sdcDaily} aria-label={tr("Pengingat kerjakan SDC", "Work-on-SDC reminder")} onchange={(e) => prefs.set({ sdcDaily: e.currentTarget.checked })} />
    </span>
  </label>
  <div class="row">
    <div><b>{tr("Isi progres di CIS", "Fill in progress on CIS")}</b><small class="muted">{tr("Mengetuk pengingatnya membuka halaman awal SDC di CIS; progresnya kamu isi sendiri lewat tombol Progress.", "Tapping the reminder opens the SDC start page on CIS; you fill in progress yourself with the Progress button.")}</small></div>
    <span class="ctl">
      <input type="time" value={p.sdcProgressTime} disabled={p.sdcProgress === "off"} aria-label={tr("Jam pengingat progres", "Progress reminder time")} onchange={(e) => e.currentTarget.value && prefs.set({ sdcProgressTime: e.currentTarget.value })} />
      <Select value={p.sdcProgress} label={tr("Seberapa sering", "How often")} options={[{ value: "off", label: tr("Mati", "Off") }, { value: "weekly", label: tr("Tiap Minggu", "Every Sunday") }, { value: "daily", label: tr("Tiap hari", "Every day") }]} onchange={(v: "off" | "weekly" | "daily") => prefs.set({ sdcProgress: v })} />
    </span>
  </div>
  {#if !p.reminders}<p class="muted warn">{tr("Pengingat acara dimatikan di Pengaturan, jadi pengingat SDC juga tidak berbunyi.", "Event reminders are off in Settings, so SDC reminders do not ring either.")}</p>{/if}
</section>

<style>
  .empty { display: grid; justify-items: start; gap: var(--space-2); padding: var(--space-5); }
  .empty h2, .empty p { margin: 0; }
  .bubble { display: grid; place-items: center; width: 3.2em; height: 3.2em; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--link); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
  .head p { margin: 0; }
  .btn { display: inline-flex; align-items: center; gap: var(--space-2); }
  .list { list-style: none; margin: 0 0 var(--space-4); padding: 0; display: grid; gap: var(--space-3); }
  .ch { display: grid; gap: var(--space-2); padding: var(--space-4); }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
  .pct { font-variant-numeric: tabular-nums; font-weight: 700; }
  .how, .meta { margin: 0; }
  .week { margin: 0 0 var(--space-1); }
  .plan { display: grid; gap: var(--space-1); padding: var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); }
  .plan p { margin: 0; }
  .need { color: var(--link); }
  .max { color: var(--text-muted); font-size: 0.9em; }
  .max.ok { color: var(--link); }
  .note { margin: 0 0 var(--space-3); }
  .days { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .days > span { margin-right: var(--space-1); }
  .day { min-width: var(--space-5); padding: var(--space-1) var(--space-2); border: var(--edge-w) solid var(--border); border-radius: var(--radius-2); background: transparent; color: var(--text-muted); font: inherit; font-size: 0.82em; cursor: pointer; }
  .day.on { background: var(--accent-soft); color: var(--link); border-color: var(--link); }
  .bar { height: var(--space-2); border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); }
  .weeks { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .weeks li { display: grid; place-items: center; width: var(--space-5); height: var(--space-5); border-radius: var(--radius-2); background: var(--surface-2); color: var(--text-muted); font-size: 0.78em; font-variant-numeric: tabular-nums; }
  .weeks li.filled { background: var(--accent-soft); color: var(--link); }
  .weeks li.met { background: var(--accent); color: var(--accent-contrast); }
  .set { display: grid; gap: var(--space-3); padding: var(--space-4); }
  .set h2 { margin: 0; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .row small { display: block; }
  .ctl { display: inline-flex; align-items: center; gap: var(--space-2); }
  /* Lebar tetap supaya jamnya tidak terpotong saat berdampingan dengan dropdown. */
  .ctl input[type="time"] { flex: none; width: 8.5em; }
  .warn { margin: 0; }
</style>
