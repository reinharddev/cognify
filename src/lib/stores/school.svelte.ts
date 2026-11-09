// Tugas, ujian, dan nilai dari portal sekolah. Datanya dikirim ekstensi browser dari halaman yang sudah dibuka
// pengguna (lihat bridge.rs `/bridge/table`); Cognify tidak pernah masuk ke portal dan tidak menyimpan kata sandi.
// Disimpan di database lokal (kunci "school.items"), tanpa permintaan jaringan.

import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { workspace } from "$lib/workspace/api";
import { mergeItems, parseTables, type RawTable, type SchoolItem } from "$lib/school/parse";
import { currentPeriod, mergeLessons, parseSchedule, type Lesson } from "$lib/school/schedule";
import { mergeAttendance, parseAttendance, semesterOf, type AttendanceDay } from "$lib/school/attendance";
import { detectMajor } from "$lib/school/majors";
import { DEFAULT_CALC, applyFilter, levelOf, overview, subjectStats, terms, years, type CalcSettings } from "$lib/school/stats";
import { notifications } from "$lib/stores/notifications.svelte";
import { tr } from "$lib/i18n.svelte";

const ITEMS_KEY = "school.items";
const INBOX_KEY = "school.inbox";
const CALC_KEY = "school.calc";
const SCHEDULE_KEY = "school.schedule";
const ATTENDANCE_KEY = "school.attendance";
const LASTPOST_KEY = "school.lastpost";
const REPORT_KEY = "school.report";
/** Pengingat tugas sekolah: sehari sebelum tenggat. */
export const SCHOOL_REMIND_MIN = 1440;

class SchoolStore {
  items = $state<SchoolItem[]>([]);
  loaded = $state(false);
  /** Catatan kiriman terakhir dari ekstensi (dibuat jembatan saat kiriman diterima), untuk memastikan kiriman sampai. */
  lastPost = $state<{ at: number; kind: string; period: string; rows: number } | null>(null);
  /** Laporan pengiriman terakhir dari ekstensi: apa yang berhasil dan apa yang gagal beserta alasannya. */
  report = $state<{ at: number; lines: string[] } | null>(null);
  /** Kehadiran harian semua tanggal yang pernah dikirim. */
  attendance = $state<AttendanceDay[]>([]);
  /** Kehadiran sesuai filter tahun ajaran dan semester di atas halaman Nilai. */
  readonly shownAttendance = $derived(
    this.attendance.filter((d) => {
      const sem = semesterOf(d.date);
      return (!this.year || sem.year === this.year) && (!this.term || sem.term === this.term);
    }),
  );
  /** Jadwal pelajaran semua periode yang pernah dikirim. */
  lessons = $state<Lesson[]>([]);
  /** Periode jadwal yang berlaku sekarang (tahun ajaran terbaru, semester terbaru). */
  readonly schedulePeriod = $derived(currentPeriod(this.lessons));
  /** Hasil impor terakhir untuk ditampilkan di halaman Nilai. */
  last = $state<{ at: number; added: number; updated: number } | null>(null);
  /** Pengaturan hitungan (KKM, target, bobot). */
  calc = $state<CalcSettings>({ ...DEFAULT_CALC, weights: { ...DEFAULT_CALC.weights }, major: { ...DEFAULT_CALC.major, subjects: [] } });
  /** Filter bersama semua halaman Nilai. Tahun null berarti tahun ajaran terbaru; "" berarti semua. */
  yearPick = $state<string | null>(null);
  term = $state("");
  /** Tampilan mapel: semua, hanya peminatan jurusan, atau hanya umum. */
  group = $state<"all" | "major" | "general">("all");

  readonly years = $derived(years(this.items));
  readonly year = $derived(this.yearPick ?? this.years[0] ?? "");
  readonly terms = $derived(terms(this.items, this.year));
  /** Item sesuai filter tahun dan semester. */
  readonly shown = $derived(applyFilter(this.items, { year: this.year, term: this.term }));
  /** Hasil deteksi mapel peminatan dari seluruh data (bukan hanya yang terfilter), supaya tidak berubah saat filter diganti. */
  readonly detection = $derived(detectMajor(this.items, this.calc.major.fromLevel));
  /** Pengaturan yang dipakai menghitung: bila otomatis, mapel peminatan mengikuti deteksi. */
  readonly effective = $derived<CalcSettings>(
    this.calc.major.enabled && this.calc.major.auto ? { ...this.calc, major: { ...this.calc.major, subjects: this.detection.major } } : this.calc,
  );
  readonly overview = $derived(overview(this.shown, this.effective));
  readonly subjects = $derived(subjectStats(this.shown, this.effective));
  /** Ada mapel peminatan pada data yang tampil (jurusan sudah dipilih dan kelasnya berjurusan). */
  readonly hasMajor = $derived(this.subjects.some((x) => x.major));
  /** Mapel sesuai pilihan kelompok. */
  readonly visibleSubjects = $derived(this.group === "all" || !this.hasMajor ? this.subjects : this.subjects.filter((x) => (this.group === "major") === x.major));
  /** Kelas pada data yang tampil, mis. [12] atau [11, 12] bila semua tahun dipilih. */
  readonly levels = $derived([...new Set(this.shown.map((i) => levelOf(i.grade)).filter((n): n is number => n !== null))].sort((a, b) => a - b));
  /** Semua nama mapel di data (untuk memilih mapel peminatan). */
  readonly allSubjects = $derived([...new Set(this.items.map((i) => i.subject))].sort((a, b) => a.localeCompare(b)));

  setYear(y: string) {
    this.yearPick = y;
    if (this.term && !terms(this.items, y).includes(this.term)) this.term = "";
  }

  async setCalc(patch: Partial<CalcSettings>) {
    const clamp = (n: number, d: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d);
    const m = { ...this.calc.major, ...patch.major };
    this.calc = {
      passMark: clamp(patch.passMark ?? this.calc.passMark, this.calc.passMark),
      target: clamp(patch.target ?? this.calc.target, this.calc.target),
      weights: { ...(patch.weights ?? this.calc.weights) },
      minAttendance: clamp(patch.minAttendance ?? this.calc.minAttendance, this.calc.minAttendance),
      major: {
        enabled: m.enabled === true,
        name: String(m.name ?? "").trim().slice(0, 40),
        auto: m.auto !== false,
        fromLevel: Math.min(13, Math.max(1, Math.round(Number(m.fromLevel)) || 11)),
        subjects: [...new Set((m.subjects ?? []).map((x) => String(x)))].slice(0, 60),
        boost: Number.isFinite(Number(m.boost)) ? Math.min(3, Math.max(1, Number(m.boost))) : 1.5,
      },
    };
    try {
      await workspace.settings.set(CALC_KEY, JSON.stringify(this.calc));
    } catch {
      /* tampilan tetap berubah */
    }
  }

  async refreshLastPost() {
    try {
      const raw = await workspace.settings.get(LASTPOST_KEY);
      this.lastPost = raw ? JSON.parse(raw) : null;
      const rep = await workspace.settings.get(REPORT_KEY);
      this.report = rep ? JSON.parse(rep) : null;
    } catch {
      /* tanpa catatan */
    }
  }

  async init() {
    void this.refreshLastPost();
    try {
      const raw = await workspace.settings.get(ITEMS_KEY);
      if (raw) {
        this.items = (JSON.parse(raw) as SchoolItem[])
          // Baris judul yang terkirim oleh versi lama dibuang.
          .filter((i) => i && typeof i.key === "string" && i.subject?.toLowerCase() !== "subject")
          .map((i) => ({ ...i, period: i.period ?? "", grade: i.grade ?? "", term: i.term ?? "", year: i.year ?? "", adjusted: i.adjusted ?? false }));
      }
    } catch {
      /* mulai kosong */
    }
    try {
      const raw = await workspace.settings.get(ATTENDANCE_KEY);
      if (raw) this.attendance = (JSON.parse(raw) as AttendanceDay[]).filter((d) => d && typeof d.date === "string");
    } catch {
      /* mulai kosong */
    }
    try {
      const raw = await workspace.settings.get(SCHEDULE_KEY);
      if (raw) this.lessons = (JSON.parse(raw) as Lesson[]).filter((l) => l && typeof l.key === "string");
    } catch {
      /* mulai kosong */
    }
    try {
      const raw = await workspace.settings.get(CALC_KEY);
      if (raw) {
        const c = JSON.parse(raw) as Partial<CalcSettings>;
        this.calc = {
          passMark: typeof c.passMark === "number" ? c.passMark : DEFAULT_CALC.passMark,
          target: typeof c.target === "number" ? c.target : DEFAULT_CALC.target,
          weights: c.weights && typeof c.weights === "object" ? { ...c.weights } : { ...DEFAULT_CALC.weights },
          minAttendance: typeof c.minAttendance === "number" ? c.minAttendance : DEFAULT_CALC.minAttendance,
          // Simpanan lama tanpa "enabled": berjurusan bila namanya terisi, dan daftar mapelnya dipertahankan (tidak otomatis).
          major: {
            ...DEFAULT_CALC.major,
            ...(c.major ?? {}),
            enabled: typeof c.major?.enabled === "boolean" ? c.major.enabled : !!c.major?.name,
            auto: typeof c.major?.auto === "boolean" ? c.major.auto : false,
            subjects: Array.isArray(c.major?.subjects) ? c.major.subjects : [],
          },
        };
      }
    } catch {
      /* pakai bawaan */
    }
    this.loaded = true;
    await this.importInbox(); // kiriman yang masuk saat app belum memuat halaman ini
    if (isTauri()) void listen("school-imported", () => void this.importInbox());
  }

  #importing = false;
  #importAgain = false;

  /** Baca kiriman dari ekstensi (nilai dan jadwal), gabungkan, simpan. Panggilan yang bersamaan diantrekan, tidak diabaikan. */
  async importInbox() {
    if (this.#importing) {
      this.#importAgain = true;
      return;
    }
    this.#importing = true;
    try {
      do {
        this.#importAgain = false;
        await this.#importOnce();
      } while (this.#importAgain);
    } finally {
      this.#importing = false;
    }
  }

  async #importOnce() {
    void this.refreshLastPost();
    type Batch = { tables?: RawTable[]; period?: string; kind?: string };
    let raw: string | null = null;
    try {
      raw = await workspace.settings.get(INBOX_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let batches: Batch[] = [];
    try {
      const parsed = JSON.parse(raw) as Batch | Batch[];
      batches = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      /* kiriman rusak: dibuang di bawah */
    }
    try {
      const exam = batches.filter((b) => b.kind !== "schedule" && b.kind !== "attendance");
      const sched = batches.filter((b) => b.kind === "schedule");
      const att = batches.filter((b) => b.kind === "attendance");
      const fresh = exam.flatMap((b) => parseTables(b.tables ?? [], b.period ?? ""));
      const freshLessons = sched.flatMap((b) => parseSchedule(b.tables ?? [], b.period ?? ""));
      let body = "";
      if (fresh.length) {
        const known = new Map(this.items.map((i) => [i.key, i]));
        const added = fresh.filter((i) => !known.has(i.key)).length;
        const updated = fresh.filter((i) => known.has(i.key) && JSON.stringify(known.get(i.key)) !== JSON.stringify(i)).length;
        this.items = mergeItems(this.items, fresh);
        await workspace.settings.set(ITEMS_KEY, JSON.stringify(this.items));
        this.last = { at: Date.now(), added, updated };
        body = tr(`${added} penilaian baru, ${updated} berubah.`, `${added} new assessments, ${updated} changed.`);
      }
      if (freshLessons.length) {
        this.lessons = mergeLessons(this.lessons, freshLessons);
        await workspace.settings.set(SCHEDULE_KEY, JSON.stringify(this.lessons));
        const periods = new Set(freshLessons.map((l) => l.period)).size;
        body = [body, tr(`Jadwal ${periods} periode.`, `Timetable for ${periods} period(s).`)].filter(Boolean).join(" ");
      }
      const freshDays = att.flatMap((b) => parseAttendance(b.tables ?? []));
      if (freshDays.length) {
        this.attendance = mergeAttendance(this.attendance, freshDays);
        await workspace.settings.set(ATTENDANCE_KEY, JSON.stringify(this.attendance));
        body = [body, tr(`Kehadiran ${freshDays.length} hari.`, `Attendance for ${freshDays.length} days.`)].filter(Boolean).join(" ");
      }
      if (body) {
        notifications.push(
          { kind: "info", title: tr("Data sekolah diperbarui", "School data updated"), body, href: fresh.length ? "/nilai" : "/calendar" },
          { toast: true },
        );
      }
    } catch {
      /* kiriman rusak: diabaikan */
    }
    try {
      // Hanya yang sudah dibaca yang dibuang; kiriman yang masuk selama pemrosesan tetap menunggu giliran.
      const now = await workspace.settings.get(INBOX_KEY);
      const rest = (() => {
        try {
          const l = JSON.parse(now ?? "[]");
          return Array.isArray(l) ? l.slice(batches.length) : [];
        } catch {
          return [];
        }
      })();
      await workspace.settings.set(INBOX_KEY, rest.length ? JSON.stringify(rest) : "");
      if (rest.length) this.#importAgain = true;
    } catch {
      /* terbaca ulang tidak merusak: gabungannya sama */
    }
  }

  /** Periode yang tersimpan beserta jumlah penilaian dan mapelnya, supaya pengguna bisa melihat apa yang dipegang Cognify. */
  readonly stored = $derived.by(() => {
    const by = new Map<string, { label: string; count: number; subjects: Set<string> }>();
    for (const i of this.items) {
      const key = i.period || "?";
      const cur = by.get(key) ?? { label: i.period || "Tanpa periode", count: 0, subjects: new Set<string>() };
      cur.count++;
      cur.subjects.add(i.subject);
      by.set(key, cur);
    }
    // Periode yang hanya punya jadwal (belum ada nilai) tetap terdaftar supaya bisa dihapus.
    for (const l of this.lessons) {
      const key = l.period || "?";
      if (!by.has(key)) by.set(key, { label: l.period || "Tanpa periode", count: 0, subjects: new Set<string>() });
    }
    return [...by.entries()].map(([key, v]) => ({ key, label: v.label, count: v.count, subjects: [...v.subjects].sort((a, b) => a.localeCompare(b)) })).sort((a, b) => a.label.localeCompare(b.label));
  });

  /** Hapus satu periode (mis. kiriman dari halaman yang salah). */
  async removePeriod(key: string) {
    this.items = this.items.filter((i) => (i.period || "?") !== key);
    await workspace.settings.set(ITEMS_KEY, JSON.stringify(this.items));
    if (this.lessons.some((l) => (l.period || "?") === key)) {
      this.lessons = this.lessons.filter((l) => (l.period || "?") !== key);
      await workspace.settings.set(SCHEDULE_KEY, JSON.stringify(this.lessons));
    }
  }

  async clear() {
    this.items = [];
    this.last = null;
    await workspace.settings.set(ITEMS_KEY, "[]");
    this.lessons = [];
    await workspace.settings.set(SCHEDULE_KEY, "[]");
    this.attendance = [];
    await workspace.settings.set(ATTENDANCE_KEY, "[]");
    // Daftar jurusan ikut dikosongkan dan kembali otomatis, supaya tidak tersisa dari data yang sudah dibuang.
    await this.setCalc({ major: { ...this.calc.major, auto: true, subjects: [] } });
  }
}

export const school = new SchoolStore();
