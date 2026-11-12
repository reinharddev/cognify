import { describe, expect, it } from "vitest";
import { currentWeek, dailyMinutes, dueSdcReminders, formatMinutes, parseChallengeTitle, parseMinutes, parseSdc, planFor, SDC_URL, type Sdc } from "./sdc";

// Bentuk tabel dari ekstensi (halaman Progress SDC asli): [judul dengan target mingguan, cara, menit tiap minggu...].
const weeks = (vals: (number | "")[]) => vals.map(String);
const TABLE = {
  headers: ["Challenge", ...Array.from({ length: 15 }, (_, i) => `Week - ${i + 1} ( in minutes )`)],
  rows: [
    ["PoCC Informatika (3 jam 30 menit per minggu)", "membuat website utility SaaS(Software as a Service) yang tujuannya membantu orang lain", ...weeks([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]).map((v, i) => (i < 4 ? "225" : i < 5 ? "0" : ""))],
    ["Lainnya (2 jam 20 menit per minggu)", "meningkatkan skill motion graphic", ...weeks(Array(15).fill("")).map((_, i) => (i < 3 ? "140" : ""))],
    ["Belajar Kode Komputer (1 jam 10 menit per minggu)", "belajar Swift", ...Array(15).fill("")],
    ["Perseverance (1 jam 10 menit per minggu)", "selalu mengingat tujuan awal", ...Array(15).fill("")],
    ["Baris lain tanpa target", "diabaikan", ...Array(15).fill("")],
  ],
};

describe("SDC dari portal", () => {
  it("membaca menit dari teks Indonesia dan Inggris", () => {
    expect(parseMinutes("3 jam 30 menit")).toBe(210);
    expect(parseMinutes("2 jam")).toBe(120);
    expect(parseMinutes("45 menit")).toBe(45);
    expect(parseMinutes("1 hour 10 minutes")).toBe(70);
    expect(parseMinutes("tidak ada")).toBeNull();
  });

  it("memisahkan nama dan target mingguan dari judul", () => {
    expect(parseChallengeTitle("PoCC Informatika (3 jam 30 menit per minggu)")).toEqual({ name: "PoCC Informatika", weeklyMin: 210 });
    expect(parseChallengeTitle("Lainnya (2 jam 20 menit per minggu)")).toEqual({ name: "Lainnya", weeklyMin: 140 });
    expect(parseChallengeTitle("Reading (1 hour per week)")).toEqual({ name: "Reading", weeklyMin: 60 });
    expect(parseChallengeTitle("Tanpa target")).toBeNull();
  });

  const sdc = parseSdc([TABLE], "12.2 / First / 2026-2027", 1)!;
  it("menghitung target term, menit tercatat, persen, dan minggu terakhir", () => {
    expect(sdc.period).toBe("12.2 / First / 2026-2027");
    expect(sdc.challenges.map((c) => c.name)).toEqual(["PoCC Informatika", "Lainnya", "Belajar Kode Komputer", "Perseverance"]);
    const poc = sdc.challenges[0];
    expect(poc.totalMin).toBe(210 * 15); // 52 jam 30 menit, sama dengan di portal
    expect(poc.doneMin).toBe(900); // 15 jam, sama dengan di portal
    expect(poc.percent).toBe(29);
    expect(poc.lastWeek).toBe(4); // minggu ke-5 berisi 0
    expect(sdc.challenges[1].doneMin).toBe(420);
    expect(sdc.challenges[2]).toMatchObject({ doneMin: 0, percent: 0, lastWeek: 0 });
  });

  it("tabel tanpa tantangan menghasilkan null", () => {
    expect(parseSdc([{ headers: [], rows: [["x", "y"]] }])).toBeNull();
  });

  it("menit per hari: target mingguan dibagi tujuh, dibulatkan 5 menit", () => {
    expect([210, 140, 70].map((w) => dailyMinutes(w))).toEqual([30, 20, 10]);
    expect(dailyMinutes(210, 5)).toBe(40);
    expect(dailyMinutes(140, 2)).toBe(70);
    expect(dailyMinutes(10, 7)).toBe(5);
    expect(dailyMinutes(20)).toBe(5);
    expect(formatMinutes(210)).toBe("3 jam 30 menit");
    expect(formatMinutes(45)).toBe("45 menit");
    expect(formatMinutes(120)).toBe("2 jam");
  });
});

describe("SDC: data asli dari halaman Progress", () => {
  const w = (v: string) => v.split(",");
  const REAL = {
    headers: [],
    rows: [
      ["PoCC Informatika (3 jam 30 menit per minggu)", "membuat website", ...w("30,30,30,120,120,120,120,,,,,120,,210,")],
      ["Lainnya (2 jam 20 menit per minggu)", "motion graphic", ...w("30,30,30,125,105,140,140,,,,,140,,140,")],
      ["Belajar Kode Komputer (1 jam 10 menit per minggu)", "Swift", ...w("15,15,25,70,70,70,70,,,,,70,,70,")],
      ["Perseverance (1 jam 10 menit per minggu)", "tujuan awal", ...w("10,10,10,15,15,70,70,,,,,70,,70,")],
      ["@closes", "", ..."2026-08-17,2026-08-24,2026-08-31,2026-09-07,2026-09-14,2026-09-21,2026-09-28,2026-10-05,2026-10-12,2026-10-19,2026-10-26,2026-11-02,2026-11-09,2026-11-16,2026-11-23".split(",").map((d) => `${d} 13:09:00`)],
    ],
  };
  it("persen dan jam sama dengan yang ditampilkan portal (29%, 42%, 45%, 32%)", () => {
    const sdc = parseSdc([REAL], "12.2 / First / 2026-2027")!;
    expect(sdc.challenges.map((c) => c.percent)).toEqual([29, 42, 45, 32]);
    expect(sdc.challenges.map((c) => formatMinutes(c.doneMin))).toEqual(["15 jam", "14 jam 40 menit", "7 jam 55 menit", "5 jam 40 menit"]);
    expect(sdc.challenges.map((c) => formatMinutes(c.totalMin))).toEqual(["52 jam 30 menit", "35 jam", "17 jam 30 menit", "17 jam 30 menit"]);
    expect(sdc.challenges[0].weeks).toHaveLength(15);
    expect(sdc.challenges[0].lastWeek).toBe(14);
    expect(sdc.challenges).toHaveLength(4); // baris @closes bukan tantangan
    expect(sdc.closes).toHaveLength(15);
  });

  it("minggu berjalan menurut jam tutup portal: Senin ke Senin, akhir pekan ikut", () => {
    const sdc = parseSdc([REAL])!;
    const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
    const wk = (t: number) => currentWeek(sdc, t);
    expect(wk(at(2026, 11, 12))).toMatchObject({ index: 14, filled: true }); // Kamis 12 Nov: minggu 14, sudah terisi semua
    expect(wk(at(2026, 11, 14))?.index).toBe(14); // Sabtu masih minggu 14
    expect(wk(at(2026, 11, 15))?.index).toBe(14); // Minggu juga
    expect(wk(at(2026, 11, 16, 13, 0))?.index).toBe(14); // Senin sebelum 13:09: kotak minggu 14 masih terbuka
    expect(wk(at(2026, 11, 16, 13, 10))).toMatchObject({ index: 15, filled: false }); // sesudah itu minggu 15, belum terisi
    expect(wk(at(2026, 11, 24))).toBeNull(); // term selesai
    expect(new Date(wk(at(2026, 11, 12))!.closesAt!).getDay()).toBe(1); // ditutup hari Senin
  });
});

describe("pengingat SDC", () => {
  const L = { dailyTitle: "SDC hari ini", progressTitle: "Isi progres SDC di CIS", progressBody: (w: { index: number }) => `minggu ${w.index}`, minutesShort: "mnt" };
  const P = { sdcDaily: true, sdcDailyTime: "16:00", sdcProgress: "weekly" as const, sdcProgressTime: "19:00", sdcDays: {} as Record<string, number[]> };
  const s: Sdc | null = parseSdc([TABLE], "12.2", 1);
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);

  it("harian: memuat target harian tiap tantangan, sekali per hari", () => {
    const due = dueSdcReminders(at(2026, 11, 12, 16, 5), s, P, new Set(), L);
    expect(due).toHaveLength(1);
    expect(due[0].title).toBe("SDC hari ini");
    expect(due[0].body).toBe("PoCC Informatika 30 mnt · Lainnya 20 mnt · Belajar Kode Komputer 10 mnt · Perseverance 10 mnt");
    expect(due[0].href).toBeNull();
    expect(dueSdcReminders(at(2026, 11, 12, 16, 5), s, P, new Set([due[0].key]), L)).toHaveLength(0);
  });

  it("hari kerja per tantangan: target harian naik bila harinya lebih sedikit, dan hari libur tidak diingatkan", () => {
    const days = { "PoCC Informatika": [1, 2, 3, 4, 5], Lainnya: [6, 0] };
    const thu = dueSdcReminders(at(2026, 11, 12, 16, 5), s, { ...P, sdcDays: days }, new Set(), L)[0]; // Kamis
    expect(thu.body).toBe("PoCC Informatika 40 mnt · Belajar Kode Komputer 10 mnt · Perseverance 10 mnt"); // 210 / 5 = 42, dibulatkan 40; Lainnya hanya akhir pekan
    const sat = dueSdcReminders(at(2026, 11, 14, 16, 5), s, { ...P, sdcDays: days }, new Set(), L)[0]; // Sabtu
    expect(sat.body).toBe("Lainnya 70 mnt · Belajar Kode Komputer 10 mnt · Perseverance 10 mnt"); // 140 / 2 = 70
    const none = { "PoCC Informatika": [1], Lainnya: [1], "Belajar Kode Komputer": [1], Perseverance: [1] };
    expect(dueSdcReminders(at(2026, 11, 12, 16, 5), s, { ...P, sdcDays: none }, new Set(), L)).toHaveLength(0); // tidak ada yang berlaku Kamis
  });

  it("belum waktunya, atau sudah lewat empat jam: tidak berbunyi", () => {
    expect(dueSdcReminders(at(2026, 11, 12, 15, 59), s, P, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 12, 20, 1), s, P, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 12, 19, 59), s, P, new Set(), L)).toHaveLength(1);
  });

  it("isi progres tanpa jam tutup dari portal: aturan lama, Minggu atau tiap hari", () => {
    const sunday = dueSdcReminders(at(2026, 11, 15, 19, 10), s, { ...P, sdcDaily: false }, new Set(), L);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].href).toBe(SDC_URL);
    expect(dueSdcReminders(at(2026, 11, 12, 19, 10), s, { ...P, sdcDaily: false }, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 12, 19, 10), s, { ...P, sdcDaily: false, sdcProgress: "daily" }, new Set(), L)).toHaveLength(1);
  });

  it("isi progres dengan jam tutup: sehari sebelum ditutup, dan dilewati bila minggu itu sudah terisi", () => {
    const closes = [new Date(2026, 10, 16, 13, 9), new Date(2026, 10, 23, 13, 9)];
    const filled = parseSdc([{ headers: [], rows: [["A (1 jam per minggu)", "x", "60", ""], ["@closes", "", ...closes.map((d) => `${d.getFullYear()}-11-${d.getDate()} 13:09:00`)]] }])!;
    const empty = parseSdc([{ headers: [], rows: [["A (1 jam per minggu)", "x", "", ""], ["@closes", "", ...closes.map((d) => `${d.getFullYear()}-11-${d.getDate()} 13:09:00`)]] }])!;
    const p = { ...P, sdcDaily: false };
    expect(dueSdcReminders(at(2026, 11, 15, 19, 10), empty, p, new Set(), L)).toHaveLength(1); // Minggu, minggu 1 belum terisi
    expect(dueSdcReminders(at(2026, 11, 15, 19, 10), empty, p, new Set(), L)[0].body).toBe("minggu 1");
    expect(dueSdcReminders(at(2026, 11, 15, 19, 10), filled, p, new Set(), L)).toHaveLength(0); // sudah terisi
    expect(dueSdcReminders(at(2026, 11, 12, 19, 10), empty, p, new Set(), L)).toHaveLength(0); // Kamis bukan sehari sebelum tutup
    expect(dueSdcReminders(at(2026, 11, 12, 19, 10), empty, { ...p, sdcProgress: "daily" }, new Set(), L)).toHaveLength(1);
    expect(dueSdcReminders(at(2026, 11, 12, 19, 10), filled, { ...p, sdcProgress: "daily" }, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 30, 19, 10), empty, { ...p, sdcProgress: "daily" }, new Set(), L)).toHaveLength(0); // term selesai
  });

  it("dimatikan, tanpa data SDC, atau jam salah: tidak berbunyi", () => {
    expect(dueSdcReminders(at(2026, 11, 12, 16, 5), s, { ...P, sdcDaily: false, sdcProgress: "off" }, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 12, 16, 5), null, P, new Set(), L)).toHaveLength(0);
    expect(dueSdcReminders(at(2026, 11, 12, 16, 5), s, { ...P, sdcDailyTime: "abc" }, new Set(), L)).toHaveLength(0);
  });
});

describe("SDC: rencana menit per hari (data asli, Kamis 12 Nov 2026)", () => {
  const w = (v: string) => v.split(",");
  const REAL = {
    headers: [],
    rows: [
      ["PoCC Informatika (3 jam 30 menit per minggu)", "x", ...w("30,30,30,120,120,120,120,,,,,120,,210,")],
      ["Lainnya (2 jam 20 menit per minggu)", "x", ...w("30,30,30,125,105,140,140,,,,,140,,140,")],
      ["Belajar Kode Komputer (1 jam 10 menit per minggu)", "x", ...w("15,15,25,70,70,70,70,,,,,70,,70,")],
      ["Perseverance (1 jam 10 menit per minggu)", "x", ...w("10,10,10,15,15,70,70,,,,,70,,70,")],
      ["@closes", "", ..."2026-08-17,2026-08-24,2026-08-31,2026-09-07,2026-09-14,2026-09-21,2026-09-28,2026-10-05,2026-10-12,2026-10-19,2026-10-26,2026-11-02,2026-11-09,2026-11-16,2026-11-23".split(",").map((d) => `${d} 13:09:00`)],
    ],
  };
  const sdc = parseSdc([REAL])!;
  const thu = new Date(2026, 10, 12, 16, 0).getTime();

  it("minggu yang sudah ditutup tidak bisa dikejar: 100% sudah tidak mungkin, dan maksimalnya jelas", () => {
    const plans = sdc.challenges.map((c) => planFor(sdc, c, thu)!);
    expect(plans.map((p) => p.reachable)).toEqual([false, false, false, false]);
    expect(plans.map((p) => p.maxPercent)).toEqual([35, 49, 52, 39]); // 900+210 dari 3150, dst.
    expect(plans.map((p) => p.weeks.map((x) => x.index))).toEqual([[14, 15], [14, 15], [14, 15], [14, 15]]); // hanya minggu terbuka
  });

  it("per minggu terbuka: minggu 14 sudah penuh, minggu 15 butuh target mingguan dibagi tujuh hari", () => {
    const p = planFor(sdc, sdc.challenges[0], thu)!;
    expect(p.weeks[0]).toMatchObject({ index: 14, room: 0, perDay: 0 }); // 210 dari 210
    expect(p.weeks[1]).toMatchObject({ index: 15, room: 210, daysLeft: 7, perDay: 30 });
    expect(planFor(sdc, sdc.challenges[1], thu)!.weeks[1].perDay).toBe(20);
  });

  it("hari kerja terpilih dan sisa hari di minggu berjalan ikut dihitung", () => {
    // Minggu 14 yang kosong (ruang 210), Kamis 12: tersisa Kamis sampai Minggu = 4 hari -> 55 menit per hari; hanya Senin-Jumat = 2 hari -> 105.
    const empty = parseSdc([{ headers: [], rows: [["A (3 jam 30 menit per minggu)", "x", ...w(",,,,,,,,,,,,,,")], REAL.rows[4]] }])!;
    expect(planFor(empty, empty.challenges[0], thu)!.weeks[0]).toMatchObject({ index: 14, room: 210, daysLeft: 4, perDay: 55 });
    expect(planFor(empty, empty.challenges[0], thu, [1, 2, 3, 4, 5])!.weeks[0]).toMatchObject({ daysLeft: 2, perDay: 105 });
  });

  it("tanpa jam tutup dari portal: tidak ada rencana", () => {
    const none = parseSdc([{ headers: [], rows: [REAL.rows[0]] }])!;
    expect(planFor(none, none.challenges[0], thu)).toBeNull();
  });

  it("100% masih mungkin bila semua minggu sebelumnya penuh", () => {
    const closes = ["2026-11-16", "2026-11-23"].map((d) => `${d} 13:09:00`);
    const good = parseSdc([{ headers: [], rows: [["A (1 jam per minggu)", "x", "60", ""], ["@closes", "", ...closes]] }])!;
    const p = planFor(good, good.challenges[0], thu)!;
    expect(p.reachable).toBe(true);
    expect(p.maxPercent).toBe(100);
  });
});
