process.env.TZ = "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import { currentPeriod, lessonsOn, lessonTimes, mergeLessons, parseSchedule } from "./schedule";

const HEAD = ["Day", "Begin", "End", "Room", "Subject", "Teacher(s)"];
// Baris dalam bentuk yang dikirim ekstensi (hari sudah diratakan, nama mapel dua bahasa dipisah " | "), dari jadwal 12.2 yang asli.
const ROWS = [
  ["Monday", "07:50:00", "09:50:00", "Grade 12.1 Classroom (B305)", "PoCC Informatika | PoCC Informatics", "Vinsensius Eric Adrian"],
  ["Monday", "10:10:00", "11:30:00", "Grade 12.1 Classroom (B305)", "Biologi | Biology", "Jhon Edward"],
  ["Monday", "13:50:00", "15:10:00", "Grade 12.1 Classroom (B305)", "Pendidikan Pancasila | Civic Education", "Ni Made Lia Astuti,Rachmawathy"],
  ["Wednesday", "11:30:00", "14:50:00", "Grade 12.1 Classroom (B305)", "Matematika Tingkat Lanjut | Advanced Mathematics", "Margareta Elvina Yulianingrum"],
  ["Saturday", "No schedule on Saturday", "No schedule on Saturday", "No schedule on Saturday", "No schedule on Saturday", "No schedule on Saturday"],
  ["Sunday", "No schedule on Sunday", "No schedule on Sunday", "No schedule on Sunday", "No schedule on Sunday", "No schedule on Sunday"],
];
const PERIOD = "12.2 / First / 2026-2027";

describe("parseSchedule", () => {
  const lessons = parseSchedule([{ headers: HEAD, rows: ROWS }], PERIOD);

  it("reads lessons and skips the weekend placeholders", () => {
    expect(lessons).toHaveLength(4);
    expect(lessons.every((l) => l.day !== 0 && l.day !== 6)).toBe(true);
  });

  it("uses the English subject name (the same as the grade tables) and keeps the local one", () => {
    const bio = lessons.find((l) => l.subject === "Biology")!;
    expect(bio).toMatchObject({ subjectLocal: "Biologi", day: 1, begin: "10:10", end: "11:30", room: "Grade 12.1 Classroom (B305)" });
    expect(lessons.find((l) => l.subject === "Advanced Mathematics")?.subjectLocal).toBe("Matematika Tingkat Lanjut");
  });

  it("splits several teachers and tags the period", () => {
    const civic = lessons.find((l) => l.subject === "Civic Education")!;
    expect(civic.teachers).toEqual(["Ni Made Lia Astuti", "Rachmawathy"]);
    expect(civic).toMatchObject({ period: PERIOD, grade: "12.2", term: "First", year: "2026-2027" });
  });

  it("ignores tables that are not schedules", () => {
    expect(parseSchedule([{ headers: ["Type", "Subject", "Due Time"], rows: [["Assignment", "Art", "2026-01-01 08:00:00"]] }], PERIOD)).toEqual([]);
  });

  it("copes with a subject that has one name only", () => {
    const one = parseSchedule([{ headers: HEAD, rows: [["Friday", "07:10", "08:30", "", "Art", ""]] }], PERIOD);
    expect(one[0]).toMatchObject({ subject: "Art", subjectLocal: "Art", day: 5, begin: "07:10" });
  });
});

describe("periods and days", () => {
  const mk = (period: string) => parseSchedule([{ headers: HEAD, rows: [ROWS[1]] }], period);
  it("a re-send replaces its own period and keeps the others", () => {
    const merged = mergeLessons([...mk("11.2 / First / 2025-2026"), ...mk(PERIOD)], parseSchedule([{ headers: HEAD, rows: [ROWS[3]] }], PERIOD));
    expect(merged.map((l) => `${l.period}:${l.subject}`).sort()).toEqual([`${PERIOD}:Advanced Mathematics`, "11.2 / First / 2025-2026:Biology"].sort());
  });
  it("picks the newest school year and later term as the current period", () => {
    expect(currentPeriod([...mk("11.2 / First / 2025-2026"), ...mk("11.2 / Second / 2025-2026"), ...mk(PERIOD)])).toBe(PERIOD);
    expect(currentPeriod([...mk("11.2 / First / 2025-2026"), ...mk("11.2 / Second / 2025-2026")])).toBe("11.2 / Second / 2025-2026");
    expect(currentPeriod([])).toBeNull();
  });
  it("lists a day's lessons in time order and computes real times", () => {
    const lessons = parseSchedule([{ headers: HEAD, rows: ROWS }], PERIOD);
    const monday = new Date(2026, 10, 9); // Senin 9 November 2026
    const day = lessonsOn(lessons, PERIOD, monday);
    expect(day.map((l) => l.subject)).toEqual(["PoCC Informatics", "Biology", "Civic Education"]);
    expect(lessonTimes(day[1], monday).start).toBe(new Date(2026, 10, 9, 10, 10).getTime());
    expect(lessonsOn(lessons, PERIOD, new Date(2026, 10, 14))).toEqual([]); // Sabtu
  });
});
