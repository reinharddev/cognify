// Self Development Challenge (SDC) dari portal sekolah: tiap murid memilih beberapa tantangan dengan target menit per minggu
// dan mengisi progres mingguannya di portal. Cognify hanya membaca tabel progres (lewat ekstensi) dan mengingatkan; yang mengisi
// tetap murid, di portal.

import type { RawTable } from "./parse";

export interface SdcChallenge {
  /** Mis. "PoCC Informatika". */
  name: string;
  /** Cara mengerjakan yang ditulis murid. */
  how: string;
  /** Target menit per minggu. */
  weeklyMin: number;
  /** Menit yang tercatat tiap minggu; null bila belum diisi. */
  weeks: (number | null)[];
  /** Target seluruh term (target mingguan kali jumlah minggu). */
  totalMin: number;
  /** Jumlah menit yang sudah tercatat. */
  doneMin: number;
  /** Persen dari target term, 0 sampai 100. */
  percent: number;
  /** Minggu terakhir yang ada isinya (1 dan seterusnya); 0 bila belum ada. */
  lastWeek: number;
}

export interface Sdc {
  /** Mis. "12.2 / First / 2026-2027". */
  period: string;
  challenges: SdcChallenge[];
  /**
   * Kapan tiap minggu ditutup di portal (ms; null bila tidak diketahui). Minggu CIS berjalan Senin sampai Senin: kotak minggu N
   * ditutup Senin 13:09 sesudah minggunya berakhir, jadi Sabtu dan Minggu ikut dihitung.
   */
  closes: (number | null)[];
  /** Waktu terakhir dibaca (ms). */
  at: number;
}

/** "3 jam 30 menit" atau "1 hours 10 minutes" → menit; null bila tidak ada angka. */
export function parseMinutes(text: string): number | null {
  const h = /(\d+)\s*(?:jam|hours?|hrs?|h)\b/i.exec(text);
  const m = /(\d+)\s*(?:menit|minutes?|mins?|m)\b/i.exec(text);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** "PoCC Informatika (3 jam 30 menit per minggu)" → nama dan target mingguan. */
export function parseChallengeTitle(text: string): { name: string; weeklyMin: number } | null {
  const m = /^(.*?)\s*\(([^()]*?)\s*(?:per\s+minggu|per\s+week|a\s+week|\/\s*week)\)\s*$/i.exec(text.trim());
  if (!m) return null;
  const weeklyMin = parseMinutes(m[2]);
  return weeklyMin && m[1] ? { name: m[1].trim(), weeklyMin } : null;
}

/**
 * Tabel progres dari ekstensi: tiap baris [judul dengan target mingguan, cara, menit minggu 1, minggu 2, ...].
 * Baris yang judulnya tidak berbentuk "Nama (X jam Y menit per minggu)" dilewati.
 */
export function parseSdc(tables: RawTable[], period = "", now = Date.now()): Sdc | null {
  const challenges: SdcChallenge[] = [];
  let closes: (number | null)[] = [];
  for (const t of tables) {
    for (const row of t.rows) {
      if (row[0] === "@closes") {
        closes = row.slice(2).map((v) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(v.trim());
          return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : null;
        });
        continue;
      }
      const head = parseChallengeTitle(row[0] ?? "");
      if (!head) continue;
      const weeks = row.slice(2).map((v) => {
        const n = Number.parseFloat(String(v).replace(",", "."));
        return Number.isFinite(n) && String(v).trim() !== "" ? n : null;
      });
      const doneMin = Math.round(weeks.reduce<number>((s, v) => s + (v ?? 0), 0));
      const totalMin = head.weeklyMin * Math.max(weeks.length, 1);
      const lastWeek = weeks.reduce<number>((last, v, i) => (v !== null && v > 0 ? i + 1 : last), 0);
      challenges.push({
        name: head.name,
        how: (row[1] ?? "").trim(),
        weeklyMin: head.weeklyMin,
        weeks,
        totalMin,
        doneMin,
        percent: Math.min(100, Math.round((doneMin / totalMin) * 100)),
        lastWeek,
      });
    }
  }
  return challenges.length ? { period: period.replace(/\s+/g, " ").trim(), challenges, closes, at: now } : null;
}

/** Menit per hari yang disarankan: target mingguan dibagi jumlah hari kerja (bawaan tujuh), dibulatkan ke 5 menit terdekat (paling sedikit 5). */
export function dailyMinutes(weeklyMin: number, days = 7): number {
  return Math.max(5, Math.round(weeklyMin / Math.max(1, days) / 5) * 5);
}

/** Hari kerja tiap tantangan menurut Date.getDay() (0 Minggu). Yang belum diatur: semua hari, karena minggu CIS mencakup Sabtu dan Minggu. */
export type SdcDays = Record<string, number[]>;
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
export const daysOf = (map: SdcDays | undefined, name: string): number[] => {
  const d = map?.[name];
  return Array.isArray(d) && d.length ? d : ALL_DAYS;
};

export interface SdcWeek {
  /** Nomor minggu (1 dan seterusnya) yang kotaknya sedang bisa diisi. */
  index: number;
  /** Kapan kotak minggu ini ditutup (ms), bila diketahui. */
  closesAt: number | null;
  /** Semua tantangan sudah punya isian (berapa pun menitnya) untuk minggu ini. */
  filled: boolean;
}

/**
 * Minggu yang sedang berjalan menurut portal: yang pertama belum ditutup. Senin sebelum jam tutup, minggu yang baru berakhir
 * masih dihitung karena kotaknya masih bisa diisi. Null bila portal tidak memberi jam tutup.
 */
export function currentWeek(sdc: Sdc, now: number): SdcWeek | null {
  const i = sdc.closes.findIndex((c) => c !== null && c > now);
  if (i < 0) return null;
  return { index: i + 1, closesAt: sdc.closes[i], filled: sdc.challenges.every((c) => c.weeks[i] !== null && c.weeks[i] !== undefined) };
}

/** 90 → "1 jam 30 menit", 30 → "30 menit", 120 → "2 jam". */
export function formatMinutes(min: number, lang: "id" | "en" = "id"): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const [hw, mw] = lang === "id" ? ["jam", "menit"] : ["h", "min"];
  return [h ? `${h} ${hw}` : "", m || !h ? `${m} ${mw}` : ""].filter(Boolean).join(" ");
}

/** Halaman awal SDC di portal. Dari sana murid sendiri membuka Progress dan mengisinya. */
export const SDC_URL = "https://student.citrakasih.sch.id/index.php/school_self_development/my_commitment";

export interface SdcRemindPrefs {
  sdcDaily: boolean;
  /** "HH:MM". */
  sdcDailyTime: string;
  sdcProgress: "off" | "weekly" | "daily";
  sdcProgressTime: string;
  /** Hari kerja tiap tantangan; yang belum diatur berarti semua hari. */
  sdcDays: SdcDays;
}

export interface SdcReminder {
  /** Unik per hari dan jenis, supaya tiap pengingat berbunyi sekali. */
  key: string;
  title: string;
  body: string;
  /** Alamat di luar app (portal) untuk pengingat isi progres; null untuk pengingat harian. */
  href: string | null;
}

/** Pengingat yang terlambat (app baru dibuka) tetap berbunyi sampai selama ini sesudah waktunya. */
const WINDOW_MS = 4 * 3_600_000;

const timeToday = (now: Date, hhmm: string): number | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2])).getTime() : null;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Pengingat SDC yang sedang jatuh tempo.
 * - Kerjakan SDC hari ini: tantangan yang hari kerjanya mencakup hari ini, dengan target harian (target mingguan dibagi jumlah hari kerja).
 * - Isi progres di portal: hanya bila minggu yang sedang bisa diisi belum terisi untuk semua tantangan. Mingguan: sehari sebelum
 *   kotak minggu itu ditutup (Minggu, karena CIS menutup Senin 13:09); tiap hari: setiap hari selama belum terisi.
 * `labels` memberi teks yang sudah diterjemahkan, supaya fungsi ini tetap murni dan mudah diuji.
 */
export function dueSdcReminders(
  now: Date,
  sdc: Sdc | null,
  prefs: SdcRemindPrefs,
  already: ReadonlySet<string>,
  labels: { dailyTitle: string; progressTitle: string; progressBody: (week: SdcWeek) => string; minutesShort: string },
): SdcReminder[] {
  if (!sdc?.challenges.length) return [];
  const out: SdcReminder[] = [];
  const t = now.getTime();
  const day = dayKey(now);
  const inWindow = (at: number | null) => at !== null && t >= at && t < at + WINDOW_MS;

  const dailyKey = `sdc:daily:${day}`;
  if (prefs.sdcDaily && inWindow(timeToday(now, prefs.sdcDailyTime)) && !already.has(dailyKey)) {
    const today = sdc.challenges
      .map((c) => ({ c, days: daysOf(prefs.sdcDays, c.name) }))
      .filter((x) => x.days.includes(now.getDay()));
    if (today.length) {
      out.push({
        key: dailyKey,
        title: labels.dailyTitle,
        body: today.map((x) => `${x.c.name} ${dailyMinutes(x.c.weeklyMin, x.days.length)} ${labels.minutesShort}`).join(" · "),
        href: null,
      });
    }
  }

  const progressKey = `sdc:progress:${day}`;
  if (prefs.sdcProgress !== "off" && inWindow(timeToday(now, prefs.sdcProgressTime)) && !already.has(progressKey)) {
    const known = sdc.closes.some((c) => c !== null);
    const week = known ? currentWeek(sdc, t) : null;
    // Jam tutup diketahui: hanya selama ada minggu yang bisa diisi dan belum terisi. Tidak diketahui: aturan lama (Minggu atau tiap hari).
    const open = known ? week !== null && !week.filled : true;
    const dayBeforeClose = week?.closesAt ? dayKey(new Date(week.closesAt - 86_400_000)) === day : now.getDay() === 0;
    if (open && (prefs.sdcProgress === "daily" || dayBeforeClose)) {
      out.push({ key: progressKey, title: labels.progressTitle, body: labels.progressBody(week ?? { index: 0, closesAt: null, filled: false }), href: SDC_URL });
    }
  }
  return out;
}

// ---- Rencana: berapa menit per hari ----
// Aturan portal (checkValue di halaman Progress): tiap minggu paling banyak sebesar target mingguan, dan minggu yang sudah
// ditutup tidak bisa diisi lagi. Jadi 100% hanya mungkin bila semua minggu yang tersisa diisi penuh; minggu yang terlewat
// tidak bisa dikejar.

export interface SdcWeekPlan {
  index: number;
  closesAt: number;
  /** Menit yang masih bisa ditambah di minggu ini (target mingguan dikurangi yang sudah tercatat). */
  room: number;
  /** Hari kerja tersisa di minggu ini, mulai hari ini. */
  daysLeft: number;
  /** Menit per hari agar kotak minggu ini penuh; null bila tidak ada hari tersisa (tinggal diisi sebelum ditutup). */
  perDay: number | null;
}

export interface SdcPlan {
  /** Minggu yang masih terbuka, dari yang sekarang. */
  weeks: SdcWeekPlan[];
  /** Menit yang kurang dari target term. */
  remainingMin: number;
  /** Paling banyak menit yang masih bisa ditambah (jumlah ruang semua minggu terbuka). */
  capacityMin: number;
  /** Persen tertinggi yang masih bisa dicapai. */
  maxPercent: number;
  /** 100% masih bisa dicapai. */
  reachable: boolean;
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Rencana satu tantangan. Null bila portal tidak memberi jam tutup tiap minggu. */
export function planFor(sdc: Sdc, c: SdcChallenge, now: number, workDays: number[] = ALL_DAYS): SdcPlan | null {
  if (!sdc.closes.some((x) => x !== null)) return null;
  const today = startOfDay(now);
  const weeks: SdcWeekPlan[] = [];
  sdc.closes.forEach((closesAt, i) => {
    if (closesAt === null || closesAt <= now) return;
    // Minggu i berjalan dari Senin sesudah tutup minggu sebelumnya sampai Minggu sebelum tutupnya sendiri.
    const prev = i > 0 ? sdc.closes[i - 1] : null;
    const first = Math.max(today, startOfDay(prev ?? closesAt - 7 * 86_400_000));
    const last = startOfDay(closesAt - 86_400_000);
    let daysLeft = 0;
    for (let t = first; t <= last; t = startOfDay(t + 36 * 3_600_000)) if (workDays.includes(new Date(t).getDay())) daysLeft++;
    const room = Math.max(0, c.weeklyMin - (c.weeks[i] ?? 0));
    weeks.push({ index: i + 1, closesAt, room, daysLeft, perDay: room === 0 ? 0 : daysLeft ? Math.ceil(room / daysLeft / 5) * 5 : null });
  });
  const remainingMin = Math.max(0, c.totalMin - c.doneMin);
  const capacityMin = weeks.reduce((s, w) => s + w.room, 0);
  return {
    weeks,
    remainingMin,
    capacityMin,
    maxPercent: Math.min(100, Math.round(((c.doneMin + Math.min(capacityMin, remainingMin)) / c.totalMin) * 100)),
    reachable: capacityMin >= remainingMin,
  };
}
