import { describe, expect, it } from "vitest";
import { eventsToRows, attendanceRanges } from "../../../extension/cognify.js";
import { classify, mergeAttendance, parseAttendance, semesterOf, summarizeAttendance } from "./attendance";

// Potongan respons asli load_my_attendance (acara status dan acara jam per hari).
const REAL = [
  { id: "a", title: "Present", start: "2026-09-29", end: "2026-09-29" },
  { id: "a_time", title: "07:03:23 - 15:14:07", start: "2026-09-29", allDay: true },
  { id: "b", title: "Present", start: "2026-10-20", end: "2026-10-20" },
  { id: "b_time", title: "06:56:38 - 16:04:51", start: "2026-10-20", allDay: true },
  { id: "c", title: "Present", start: "2026-09-28", end: "2026-09-28" },
  { id: "d", title: "Permitted", start: "2026-09-30", end: "2026-09-30" },
  { id: "e_time", title: "06:38:38 - 09:13:17", start: "2026-10-27", allDay: true },
  { id: "e", title: "Present", start: "2026-10-27", end: "2026-10-27" },
];

describe("eventsToRows (ekstensi)", () => {
  const rows = eventsToRows(REAL);
  it("makes one row per day, with the check-in and check-out times next to the status, in date order", () => {
    expect(rows).toEqual([
      ["2026-09-28", "Present", "", ""],
      ["2026-09-29", "Present", "07:03:23", "15:14:07"],
      ["2026-09-30", "Permitted", "", ""],
      ["2026-10-20", "Present", "06:56:38", "16:04:51"],
      ["2026-10-27", "Present", "06:38:38", "09:13:17"],
    ]);
  });
  it("ignores junk and empty input", () => {
    expect(eventsToRows(null)).toEqual([]);
    expect(eventsToRows([{ title: "Present", start: "bukan tanggal" }])).toEqual([]);
  });
});

describe("attendanceRanges (ekstensi)", () => {
  it("covers every school year in the dropdown up to next month, in half-year windows", () => {
    const r = attendanceRanges(["12.2 / First / 2026-2027", "Kelas 10.1 / First / 2024-2025"], new Date(2026, 10, 9));
    expect(r[0][0].startsWith("2024-07-01T00:00:00")).toBe(true);
    expect(r.at(-1)![1].startsWith("2026-12-09")).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBe(r[i - 1][1]); // tanpa celah
  });
});

describe("parseAttendance", () => {
  const days = parseAttendance([{ headers: ["Date", "Status", "Check in", "Check out"], rows: eventsToRows(REAL) }]);
  it("reads the days with their kind", () => {
    expect(days).toHaveLength(5);
    expect(days.find((d) => d.date === "2026-09-30")).toMatchObject({ status: "Permitted", kind: "permit" });
    expect(days.find((d) => d.date === "2026-09-29")).toMatchObject({ kind: "present", checkIn: "07:03:23" });
  });
  it("classifies English and Indonesian statuses, unknown ones stay visible", () => {
    expect(["Present", "Hadir", "Late", "Terlambat", "Permitted", "Izin", "Sick", "Sakit", "Absent", "Alpa", "Libur"].map(classify)).toEqual([
      "present", "present", "late", "late", "permit", "permit", "sick", "sick", "absent", "absent", "other",
    ]);
  });
  it("a re-send replaces a day and keeps the others", () => {
    const merged = mergeAttendance(days, [{ ...days[0], status: "Sick", kind: "sick" }]);
    expect(merged).toHaveLength(5);
    expect(merged[0].kind).toBe("sick");
  });
});

describe("semesterOf", () => {
  it("maps dates to the school year and term", () => {
    expect(semesterOf("2026-09-29")).toEqual({ year: "2026-2027", term: "First" });
    expect(semesterOf("2027-02-03")).toEqual({ year: "2026-2027", term: "Second" });
    expect(semesterOf("2026-07-01")).toEqual({ year: "2026-2027", term: "First" });
    expect(semesterOf("2026-06-30")).toEqual({ year: "2025-2026", term: "Second" });
  });
});

describe("summarizeAttendance", () => {
  const mk = (kind: string, n: number, ci = "") => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, status: kind, kind: classify(kind), checkIn: ci, checkOut: "" }));
  it("counts statuses and the attendance percentage", () => {
    const s = summarizeAttendance([...mk("Present", 8), ...mk("Permitted", 1), ...mk("Sick", 1)]);
    expect(s).toMatchObject({ recorded: 10, present: 8, permit: 1, sick: 1, pct: 80 });
  });
  it("works out how many days can still be missed at 75%", () => {
    // 18 hadir dari 20 tercatat: 18/(20+x) >= 0.75 → x <= 4
    expect(summarizeAttendance([...mk("Present", 18), ...mk("Absent", 2)]).canMiss).toBe(4);
    expect(summarizeAttendance([...mk("Present", 6), ...mk("Absent", 4)]).canMiss).toBe(0);
  });
  it("works out how many present days are needed to get back above the limit", () => {
    // 6 dari 10 (60%): (6+x)/(10+x) >= 0.75 → x >= 6
    expect(summarizeAttendance([...mk("Present", 6), ...mk("Absent", 4)])).toMatchObject({ pct: 60, needPresent: 6 });
    expect(summarizeAttendance(mk("Present", 5)).needPresent).toBe(0);
  });
  it("averages the check-in time and survives no data", () => {
    expect(summarizeAttendance([...mk("Present", 1, "07:00:00"), ...mk("Present", 1, "07:30:00")].map((d, i) => ({ ...d, date: `2026-10-0${i + 1}` }))).avgCheckIn).toBe("07:15");
    expect(summarizeAttendance([])).toMatchObject({ pct: null, recorded: 0, canMiss: 0, avgCheckIn: null });
  });
});
