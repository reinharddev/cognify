process.env.TZ = process.env.TEST_TZ ?? "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import { addDays, dayKey, fromInputs, inputDate, inputTime, monthGrid, parseDayKey, sameDay, startOfDay, weekdayLabels } from "./dates";

const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m, d, h, mi).getTime();

describe("day helpers", () => {
  it("formats and parses a local day key round trip", () => {
    expect(dayKey(at(2026, 9, 22, 23, 59))).toBe("2026-10-22");
    expect(parseDayKey("2026-10-22")).toBe(at(2026, 9, 22));
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("22-10-2026")).toBeNull();
    expect(parseDayKey("")).toBeNull();
  });

  it("adds days on the calendar, not in 24 hour blocks", () => {
    expect(new Date(addDays(at(2026, 9, 31, 9), 1)).getDate()).toBe(1);
    expect(new Date(addDays(at(2026, 9, 31, 9), 1)).getHours()).toBe(9);
    expect(startOfDay(at(2026, 9, 22, 15, 30))).toBe(at(2026, 9, 22));
    expect(sameDay(at(2026, 9, 22, 1), at(2026, 9, 22, 23))).toBe(true);
    expect(sameDay(at(2026, 9, 22, 23), at(2026, 9, 23, 0))).toBe(false);
  });

  it("combines and splits form inputs", () => {
    expect(fromInputs("2026-10-22", "08:30")).toBe(at(2026, 9, 22, 8, 30));
    expect(fromInputs("2026-10-22", "")).toBe(at(2026, 9, 22, 0, 0));
    expect(fromInputs("2026-10-22", "24:00")).toBeNull();
    expect(fromInputs("bukan", "08:30")).toBeNull();
    expect(inputDate(at(2026, 9, 22, 8, 5))).toBe("2026-10-22");
    expect(inputTime(at(2026, 9, 22, 8, 5))).toBe("08:05");
  });
});

describe("monthGrid", () => {
  it("is always six weeks starting on Monday and includes neighbouring months", () => {
    const g = monthGrid(2026, 9); // Oktober 2026 mulai hari Kamis
    expect(g).toHaveLength(42);
    expect(new Date(g[0].ms).getDay()).toBe(1);
    expect(g[0].inMonth).toBe(false);
    expect(dayKey(g[0].ms)).toBe("2026-09-28");
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(dayKey(g[41].ms)).toBe("2026-11-08");
  });

  it("handles a month that starts on Monday and a leap February", () => {
    const june = monthGrid(2026, 5); // 1 Juni 2026 hari Senin
    expect(dayKey(june[0].ms)).toBe("2026-06-01");
    expect(june[0].inMonth).toBe(true);
    expect(monthGrid(2028, 1).filter((c) => c.inMonth)).toHaveLength(29);
    expect(monthGrid(2027, 1).filter((c) => c.inMonth)).toHaveLength(28);
  });

  it("works across a year boundary", () => {
    const g = monthGrid(2026, 11);
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(dayKey(g[41].ms)).toBe("2027-01-10");
  });
});

describe("pekan mulai Minggu", () => {
  it("grid dimulai pada hari Minggu dan tetap 42 sel", () => {
    const g = monthGrid(2026, 9, 0); // Oktober 2026 mulai hari Kamis
    expect(g).toHaveLength(42);
    expect(new Date(g[0].ms).getDay()).toBe(0);
    expect(dayKey(g[0].ms)).toBe("2026-09-27");
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
  });
  it("bulan yang dimulai hari Minggu tidak menggeser pekan pertama", () => {
    const g = monthGrid(2026, 1, 0); // 1 Februari 2026 hari Minggu
    expect(dayKey(g[0].ms)).toBe("2026-02-01");
    expect(g[0].inMonth).toBe(true);
  });
  it("label hari mengikuti awal pekan", () => {
    expect(weekdayLabels(1)[0]).toBe("Sen");
    expect(weekdayLabels(0)[0]).toBe("Min");
    expect(weekdayLabels(0)).toHaveLength(7);
  });
});
