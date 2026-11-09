<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { Trash2 } from "@lucide/svelte";
  import { school } from "$lib/stores/school.svelte";
  import { dialog } from "$lib/stores/dialog.svelte";
  import Select from "$lib/ui/Select.svelte";
  import { DEFAULT_CALC, weightOf } from "$lib/school/stats";

  // Jenis yang muncul di data, ditambah yang sudah punya bobot.
  const kinds = $derived([...new Set([...school.items.map((i) => i.kind), ...Object.keys(school.calc.weights)])].sort());

  const m = $derived(school.calc.major);
  const d = $derived(school.detection);
  const shown = $derived(school.effective.major.subjects);
  const has = (subject: string) => shown.some((x) => x.toLowerCase() === subject.toLowerCase());
  const reason = (r: "marker" | "elective" | "new") =>
    r === "marker" ? tr("namanya memuat penanda peminatan", "name has a major marker") : r === "elective" ? tr("bukan mapel wajib", "not a compulsory subject") : tr("baru muncul sejak kelas berjurusan", "new since the major classes");

  /** Menyalakan penjurusan memakai deteksi otomatis dari struktur mapel kelas. */
  function toggleMajor(on: boolean) {
    void school.setCalc({ major: { ...m, enabled: on, auto: true } });
  }
  /** Mengubah satu mapel secara manual mematikan mode otomatis dan mulai dari daftar yang sedang tampil. */
  function toggle(subject: string, on: boolean) {
    const base = shown.filter((x) => x.toLowerCase() !== subject.toLowerCase());
    void school.setCalc({ major: { ...m, auto: false, subjects: on ? [...base, subject] : base } });
  }

  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const setWeight = (kind: string, v: number) => void school.setCalc({ weights: { ...school.calc.weights, [kind]: Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 1 } });

  async function wipe() {
    if (await dialog.confirm(tr("Hapus data sekolah?", "Delete school data?"), {
      detail: tr("Tugas dan nilai yang tersimpan di Cognify dihapus. Data di portal sekolah tidak berubah.", "Assignments and scores saved in Cognify are deleted. Nothing changes on the school portal."),
      okLabel: tr("Hapus", "Delete"),
      danger: true,
    })) {
      await school.clear();
    }
  }
</script>

<h2>{tr("Penjurusan", "Major")} <small>{tr("dikenali dari mapel kelas 11 dan 12", "worked out from class 11 and 12 subjects")}</small></h2>
<section class="card set">
  <p class="muted note">{tr("Kelas 10 biasanya masih umum. Mulai kelas penjurusan, Cognify mengenali mapel peminatan dari struktur mapelmu: nama yang memuat penanda seperti \"Advanced\", mapel yang bukan kelompok wajib (agama, PPKn, bahasa, matematika umum, olahraga, seni, muatan lokal, informatika, kewirausahaan, sejarah), atau mapel yang baru muncul sejak kelas berjurusan. Yang terdeteksi tercentang otomatis, kamu tinggal mengganti yang keliru.", "Class 10 is usually general. From the class where majors start, Cognify recognises major subjects from your subject structure: names with a marker such as \"Advanced\", subjects outside the compulsory group (religion, civics, languages, general maths, sport, art, local content, informatics, entrepreneurship, history), or subjects that are new in the major classes. What it finds is ticked for you; just change what is wrong.")}</p>
  <label class="field"><span><b>{tr("Sudah berjurusan", "Has a major")}</b><small class="muted">{tr("Matikan untuk kelas 10 atau sekolah tanpa jurusan.", "Turn off for class 10 or schools without majors.")}</small></span>
    <input type="checkbox" role="switch" checked={m.enabled} onchange={(e) => toggleMajor(e.currentTarget.checked)} /></label>
  {#if m.enabled}
    <label class="field"><span><b>{tr("Nama jurusan", "Major name")}</b><small class="muted">{tr("Hanya label, boleh kosong (mis. IPA).", "Just a label, may be empty (e.g. Science).")}</small></span>
      <input type="text" value={m.name} maxlength="40" onchange={(e) => school.setCalc({ major: { ...m, name: e.currentTarget.value } })} /></label>
    <div class="field"><span><b>{tr("Mulai kelas", "Starts in class")}</b><small class="muted">{tr("Kelas di bawahnya dianggap umum dan menjadi pembanding.", "Classes below it count as general and are the comparison.")}</small></span>
      <Select value={String(m.fromLevel)} options={[10, 11, 12].map((n) => ({ value: String(n), label: tr(`Kelas ${n}`, `Class ${n}`) }))} onchange={(v: string) => school.setCalc({ major: { ...m, fromLevel: Number(v) } })} label={tr("Mulai kelas", "Starts in class")} /></div>
    <label class="field"><span><b>{tr("Pengali mapel peminatan", "Major subject multiplier")}</b><small class="muted">{tr("1 = sama dengan mapel umum. 1,5 = dihitung satu setengah kali di rata-rata keseluruhan.", "1 = same as general subjects. 1.5 = counts one and a half times in the overall average.")}</small></span>
      <input type="number" min="1" max="3" step="0.5" value={m.boost} onchange={(e) => school.setCalc({ major: { ...m, boost: num(e) } })} /></label>

    <div class="subjects">
      <div class="head">
        <b>{tr("Mapel peminatan", "Major subjects")} <span class="chip {m.auto ? 'mid' : ''}">{m.auto ? tr("otomatis", "automatic") : tr("diatur manual", "set by hand")}</span></b>
        {#if !m.auto}<button class="btn" onclick={() => school.setCalc({ major: { ...m, auto: true } })}>{tr("Kembali ke otomatis", "Back to automatic")}</button>{/if}
      </div>
      {#if !d.hasMajorData}
        <p class="warn">{tr(`Belum ada data kelas ${m.fromLevel} ke atas, jadi belum ada yang bisa dikenali. Kirim tabel dari portal untuk kelas itu.`, `No data for class ${m.fromLevel} or higher yet, so nothing can be recognised. Send the portal tables for those classes.`)}</p>
      {:else if m.auto && d.major.length === 0}
        <p class="warn">{tr("Tidak ada mapel yang terdeteksi sebagai peminatan. Centang sendiri di bawah bila ada.", "No subject was recognised as a major subject. Tick them yourself below if there are any.")}</p>
      {/if}
      {#if school.allSubjects.length}
        <div class="checks">
          {#each school.allSubjects as subject (subject)}
            <label class="check"><input type="checkbox" checked={has(subject)} onchange={(e) => toggle(subject, e.currentTarget.checked)} /><span>{subject}{#if m.auto && d.reasons[subject]}<small class="muted why">{reason(d.reasons[subject])}</small>{/if}</span></label>
          {/each}
        </div>
        {#if d.general.length}<small class="muted">{tr("Dianggap umum", "Counted as general")}: {d.general.join(", ")}</small>{/if}
      {/if}
    </div>
  {/if}
</section>

<h2>{tr("Pengaturan hitungan", "Calculation settings")}</h2>
<section class="card set">
  <label class="field"><span><b>{tr("Batas lulus (KKM)", "Pass mark")}</b><small class="muted">{tr("Nilai di bawah ini dihitung kurang dan ditandai merah.", "Scores below this count as failing and show in red.")}</small></span>
    <input type="number" min="0" max="100" value={school.calc.passMark} onchange={(e) => school.setCalc({ passMark: num(e) })} /></label>
  <label class="field"><span><b>{tr("Target rata-rata", "Target average")}</b><small class="muted">{tr("Mapel di atas target dan tidak sedang turun dianggap kuat.", "Subjects above the target and not falling count as strong.")}</small></span>
    <input type="number" min="0" max="100" value={school.calc.target} onchange={(e) => school.setCalc({ target: num(e) })} /></label>
  <label class="field"><span><b>{tr("Batas kehadiran minimum (%)", "Minimum attendance (%)")}</b><small class="muted">{tr("Dipakai di halaman Kehadiran untuk menghitung sisa jatah absen.", "Used on the Attendance page to work out how many days you can still miss.")}</small></span>
    <input type="number" min="1" max="99" value={school.calc.minAttendance} onchange={(e) => school.setCalc({ minAttendance: num(e) })} /></label>
</section>

<h2>{tr("Bobot jenis penilaian", "Assessment weights")} <small>{tr("dipakai untuk rata-rata berbobot", "used for the weighted average")}</small></h2>
<section class="card set">
  {#each kinds as k (k)}
    <label class="field"><span><b>{k}</b></span>
      <input type="number" min="0" max="10" step="0.5" value={weightOf(school.calc, k)} onchange={(e) => setWeight(k, num(e))} /></label>
  {/each}
  <button class="btn reset" onclick={() => school.setCalc({ passMark: DEFAULT_CALC.passMark, target: DEFAULT_CALC.target, weights: { ...DEFAULT_CALC.weights } })}>{tr("Kembalikan bawaan", "Restore defaults")}</button>
</section>

<h2>{tr("Cara menghitung", "How it is calculated")}</h2>
<dl class="card how">
  <dt>{tr("Rata-rata berbobot", "Weighted average")}</dt>
  <dd>{tr("Tiap nilai dikali bobot jenisnya (ujian harian lebih berat dari tugas), dijumlah, lalu dibagi jumlah bobot. Dipakai untuk peringkat dan status mapel.", "Each score is multiplied by its type's weight (a daily exam counts more than an assignment), summed, then divided by the total weight. Used for ranking and subject status.")}</dd>
  <dt>{tr("Rata-rata sederhana", "Plain average")}</dt>
  <dd>{tr("Semua nilai dijumlah lalu dibagi banyaknya, tanpa bobot. Dipakai di kalkulator \"berapa yang dibutuhkan\".", "All scores summed and divided by their count, with no weights. Used by the \"what do you need\" calculator.")}</dd>
  <dt>{tr("Median", "Median")}</dt>
  <dd>{tr("Nilai tengah setelah diurutkan. Tidak terpengaruh satu nilai yang sangat tinggi atau rendah.", "The middle score once sorted. Not thrown off by one very high or very low score.")}</dd>
  <dt>{tr("Kestabilan (±)", "Spread (±)")}</dt>
  <dd>{tr("Simpangan baku: seberapa jauh nilai biasanya dari rata-ratanya. Sampai 5 stabil, sampai 10 cukup naik turun, di atas itu sangat naik turun.", "Standard deviation: how far scores typically sit from the average. Up to 5 is steady, up to 10 has some swings, above that is very uneven.")}</dd>
  <dt>{tr("Tren", "Trend")}</dt>
  <dd>{tr("Rata-rata nilai terbaru (sampai 3) dikurangi rata-rata nilai sebelumnya, diurutkan menurut tenggat. Positif berarti naik. Butuh minimal 3 nilai.", "Average of the latest scores (up to 3) minus the average of earlier ones, ordered by due date. Positive means rising. Needs at least 3 scores.")}</dd>
  <dt>{tr("Mapel peminatan", "Major subjects")}</dt>
  <dd>{tr("Mapel yang baru muncul sejak kelas penjurusan dan tidak ada di kelas 10 (dikenali otomatis, atau kamu tandai sendiri). Di rata-rata keseluruhan nilainya dikali pengali; rata-rata satu mapel sendiri tidak berubah. Ringkasan juga memisahkan rata-rata mapel peminatan dan mapel umum.", "Subjects that first appear in the major classes and are absent from class 10 (recognised automatically, or ticked by you). In the overall average their weight is multiplied; a single subject's own average does not change. The overview also separates major and general averages.")}</dd>
  <dt>{tr("Selisih (gap)", "Gap")}</dt>
  <dd>{tr("Rata-rata berbobot sebuah mapel dikurangi rata-rata berbobot semua mapel. Menunjukkan mapel mana yang kamu condong kuat atau lemah.", "A subject's weighted average minus the weighted average of all subjects. Shows which subjects you lean strong or weak in.")}</dd>
  <dt>{tr("Status mapel", "Subject status")}</dt>
  <dd>
    <ul>
      <li><b>{tr("Di bawah batas", "Below the mark")}</b>: {tr("berbobot di bawah KKM.", "weighted below the pass mark.")}</li>
      <li><b>{tr("Perlu ditingkatkan", "Needs work")}</b>: {tr("kurang dari KKM + 7, atau tren turun 5 poin atau lebih.", "under pass mark + 7, or a trend of -5 or worse.")}</li>
      <li><b>{tr("Kuat", "Strong")}</b>: {tr("berbobot sama dengan atau di atas target dan tren tidak turun 5 poin atau lebih.", "weighted at or above the target and not falling by 5 or more.")}</li>
      <li><b>{tr("Aman", "Steady")}</b>: {tr("selain itu.", "everything else.")}</li>
    </ul>
  </dd>
  <dt>{tr("Berapa yang dibutuhkan", "What you need")}</dt>
  <dd>{tr("(target × (jumlah nilai + n) − jumlah nilai sekarang) ÷ n, untuk n penilaian berikutnya. Di atas 100 berarti tidak tercapai.", "(target × (scores + n) − current total) ÷ n, for the next n assessments. Above 100 means it cannot be reached.")}</dd>
  <dt>{tr("Nilai bertanda *", "Scores marked *")}</dt>
  <dd>{tr("Dihitung sebagai angkanya, tetapi ditandai karena disesuaikan oleh sekolah.", "Counted as the number shown, but flagged because the school adjusted it.")}</dd>
</dl>

<h2>{tr("Data", "Data")}</h2>
<section class="card set">
  <p class="muted note">{tr(`${school.items.length} penilaian tersimpan di Cognify (di komputer ini saja).`, `${school.items.length} assessments stored in Cognify (on this computer only).`)}</p>
  {#if school.stored.length}
    <p class="muted note">{tr("Periode yang tersimpan. Kalau ada yang bukan dari akunmu atau mapelnya tidak cocok, hapus periode itu lalu kirim ulang dari portal.", "Stored periods. If one is not from your account or its subjects do not match, delete it and send again from the portal.")}</p>
    <ul class="stored">
      {#each school.stored as p (p.key)}
        <li>
          <div><b>{p.label}</b> <small class="muted">{tr(`${p.count} penilaian, ${p.subjects.length} mapel`, `${p.count} assessments, ${p.subjects.length} subjects`)}</small><small class="muted subj">{p.subjects.join(", ")}</small></div>
          <button class="btn" onclick={() => school.removePeriod(p.key)} aria-label={tr(`Hapus ${p.label}`, `Delete ${p.label}`)}><Trash2 size={14} />{tr("Hapus", "Delete")}</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if school.items.length}<button class="btn" onclick={wipe}><Trash2 size={14} />{tr("Hapus semua data sekolah", "Delete all school data")}</button>{/if}
</section>

<style>
  .set { display: grid; gap: var(--space-3); }
  .field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .field span { display: grid; }
  .field input:not([type="checkbox"]) { width: 6em; }
  .reset { justify-self: start; }
  .subjects { display: grid; gap: var(--space-2); }
  .subjects .head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-1) var(--space-3); }
  .check { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; }
  .check span { display: grid; }
  .why { font-size: 0.8em; }
  .field input[type="text"] { width: 14em; }
  .warn { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); background: var(--warn-soft); color: var(--warn); }
  .stored { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .stored li { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border); }
  .stored li div { display: grid; min-width: 0; }
  .stored .subj { overflow-wrap: anywhere; }
  .how { margin: 0; display: grid; gap: var(--space-1); }
  .how dt { font-weight: 700; margin-top: var(--space-3); }
  .how dt:first-child { margin-top: 0; }
  .how dd { margin: 0; color: var(--text-muted); }
  .how ul { display: grid; gap: var(--space-1); margin-top: var(--space-1); }
  @media (max-width: 560px) { .field { flex-direction: column; align-items: stretch; } .field input:not([type="checkbox"]) { width: 100%; } }
</style>
