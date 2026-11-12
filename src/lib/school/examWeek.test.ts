import { describe, expect, it } from "vitest";
import items from "./fixtures/exam-items.json";
import { examLessons, parseExamWeek, type ExamSchedule } from "./examWeek";
import type { PdfItem } from "./timetable";

// Teks dari PDF jadwal STS 1 asli (hasil pdf.js): lima hari, delapan kelas.
const parsed = parseExamWeek(items as PdfItem[]);
const exam: ExamSchedule = { ...parsed, name: "STS.pdf", at: 0 };
const on = (cls: string, iso: string) => (examLessons(exam, cls, new Date(`${iso}T00:00:00`)) ?? []).map((l) => `${l.begin}-${l.end} ${l.subject}`);

describe("jadwal pekan ujian dari PDF", () => {
  it("membaca label, tahun ajaran, kelas, dan tanggal", () => {
    expect(parsed.label).toBe("STS 1");
    expect(parsed.year).toBe("2026-2027");
    expect(parsed.classes).toEqual(["12.2", "12.1", "10.1", "10.2", "10.3", "11.1", "11.2", "11.3"]);
    expect(parsed.days.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("ujian lintas kelas, lalu pelajaran biasa sesudahnya (jam berurutan digabung)", () => {
    expect(on("12.2", "2026-09-21")).toEqual([
      "07:30-09:30 STS Bahasa Inggris",
      "10:00-11:30 STS Pendidikan Pancasila",
      "12:00-13:30 Bahasa Indonesia",
      "13:30-14:00 Kimia",
      "14:00-15:10 Fisika",
    ]);
  });

  it("sel ujian yang menyatu hanya berlaku untuk kelas yang tercakup", () => {
    // Selasa: 12.2 dan 12.1 punya ujian sendiri, 10.1-10.3 satu sel STS Fisika, 11.2 dan 11.3 satu sel.
    expect(on("12.2", "2026-09-22")[1]).toBe("09:30-11:30 STS Fisika");
    expect(on("10.1", "2026-09-22")[1]).toBe("09:30-11:30 STS Fisika");
    expect(on("10.3", "2026-09-22")[1]).toBe("09:30-11:30 STS Fisika");
    expect(on("12.1", "2026-09-22")[1]).toBe("09:30-11:00 STS Sosiologi");
    expect(on("11.1", "2026-09-22")[1]).toBe("09:30-11:00 STS Sosiologi");
    expect(on("11.3", "2026-09-22")[1]).toBe("09:30-11:30 STS Fisika");
  });

  it("jam ujian sendiri di dalam sel dipakai, dan jam istirahat tidak ikut", () => {
    expect(on("10.2", "2026-09-23")[1]).toBe("09:30-11:00 STS Ekonomi");
    expect(on("11.2", "2026-09-23")[1]).toBe("09:20-11:20 STS Matematika Lanjut");
    expect(on("11.2", "2026-09-23").join("|")).not.toMatch(/\(11\./);
  });

  it("sel menyatu vertikal (dua baris) menjadi satu blok", () => {
    expect(on("10.2", "2026-09-21")).toContain("12:00-13:30 STS Geografi");
  });

  it("kegiatan bersama (Interest, P.Pals, Bina Iman) ikut, istirahat dan doa pagi tidak", () => {
    expect(on("10.2", "2026-09-24").at(-1)).toBe("14:30-15:10 Interest");
    expect(on("12.2", "2026-09-23").at(-1)).toBe("14:00-15:10 P.Pals / I Lead");
    expect(on("11.2", "2026-09-25").at(-1)).toBe("11:30-12:30 Bina Iman");
    for (const cls of parsed.classes) for (const d of parsed.days) expect(on(cls, d.date).join("|")).not.toMatch(/break|doa pagi|persiapan/i);
  });

  it("tanggal di luar pekan ujian tidak diatur jadwal ini", () => {
    expect(examLessons(exam, "12.2", new Date("2026-09-28T00:00:00"))).toBeNull();
  });

  it("jadwal induk bukan jadwal ujian: ditolak dengan pesan yang jelas", async () => {
    const master = (await import("./fixtures/timetable-items.json")).default as PdfItem[];
    expect(() => parseExamWeek(master)).toThrow(/tanggal/i);
  });
});
