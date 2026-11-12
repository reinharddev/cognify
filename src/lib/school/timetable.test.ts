import { describe, expect, it } from "vitest";
import items from "./fixtures/timetable-items.json";
import { lessonsFromTimetable, parseTimetable, subjectName, type PdfItem } from "./timetable";

// Potongan teks dari PDF jadwal induk sekolah asli (hasil pdf.js), semua kelas dan hari.
const tt = parseTimetable(items as PdfItem[]);
const on = (cls: string, day: number) => lessonsFromTimetable(tt, cls).filter((l) => l.day === day).map((l) => `${l.begin}-${l.end} ${l.subjectLocal}`);

describe("jadwal induk dari PDF", () => {
  it("membaca kelas dan tahun ajaran", () => {
    expect(tt.classes).toEqual(["10.1", "10.2", "10.3", "11.1", "11.2", "11.3", "12.1", "12.2"]);
    expect(tt.year).toBe("2026-2027");
  });

  it("Senin 12.2: jam yang berurutan dengan mapel sama digabung, tanpa kode guru, kegiatan bersama ikut", () => {
    const monday = on("12.2", 1);
    expect(monday[0]).toBe("07:10-07:50 Upacara / Talent Day / Literasi / Pendampingan Wali Kelas");
    expect(monday[1]).toBe("07:50-09:50 Biologi");
    expect(monday[2]).toBe("10:10-11:30 Kimia");
    // Istirahat dan persiapan tidak jadi pelajaran.
    expect(monday.some((m) => /istirahat|persiapan/i.test(m))).toBe(false);
  });

  it("Rabu: sel Agama yang menyatu terbaca tanpa guru, Maxwell berlaku untuk semua kelas", () => {
    const wed = on("10.1", 3);
    expect(wed.some((m) => m.includes("Agama"))).toBe(true);
    expect(wed.find((m) => m.includes("Agama"))).not.toMatch(/\(/);
    expect(on("12.2", 3).some((m) => m.startsWith("13:50-15:10") && /maxwell/i.test(m))).toBe(true);
  });

  it("Kamis 11: Interest Group untuk 10.1 sampai 11.3, tetapi 12.2 punya pelajaran sendiri", () => {
    const g = (c: string) => on(c, 4).find((m) => m.startsWith("14:30"));
    expect(g("10.1")).toMatch(/interest group/i);
    expect(g("11.3")).toMatch(/interest group/i);
    expect(g("12.2")).toBe("14:30-15:10 Bimbingan Konseling");
  });

  it("Jumat berakhir dengan Bina Iman untuk semua kelas", () => {
    expect(on("11.2", 5).at(-1)).toMatch(/^11:30-12:30 Bina Iman/);
  });

  it("tiap kelas punya jadwal pada lima hari, tanpa tumpang tindih", () => {
    for (const cls of tt.classes) {
      const ls = lessonsFromTimetable(tt, cls);
      expect(new Set(ls.map((l) => l.day))).toEqual(new Set([1, 2, 3, 4, 5]));
      for (let i = 1; i < ls.length; i++) if (ls[i].day === ls[i - 1].day) expect(ls[i].begin >= ls[i - 1].end).toBe(true);
    }
  });

  it("kode mapel yang pasti diperluas, yang belum diketahui dibiarkan", () => {
    expect(subjectName("MTK LNJT")).toEqual({ id: "Matematika Lanjut", en: "Advanced Mathematics" });
    expect(subjectName("POE").id).toBe("Program of Entrepreneurship");
    expect(subjectName("B.SUN").id).toBe("Bahasa Sunda");
    expect(subjectName("NUMERASI")).toEqual({ id: "NUMERASI", en: "NUMERASI" });
  });

  it("jadwal pekan ujian bukan jadwal induk: ditolak supaya pengurai ujian yang dipakai", async () => {
    const exam = (await import("./fixtures/exam-items.json")).default as PdfItem[];
    expect(() => parseTimetable(exam)).toThrow();
  });

  it("PDF yang bukan jadwal ditolak dengan pesan yang jelas", () => {
    expect(() => parseTimetable([{ s: "Halo dunia", x: 10, y: 10, w: 40 }])).toThrow(/kelas/i);
  });
});
