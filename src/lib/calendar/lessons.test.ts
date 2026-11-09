process.env.TZ = "Asia/Jakarta";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendar } from "$lib/stores/calendar.svelte";
import { prefs } from "$lib/stores/prefs.svelte";
import { school } from "$lib/stores/school.svelte";
import { parseSchedule } from "$lib/school/schedule";

const HEAD = ["Day", "Begin", "End", "Room", "Subject", "Teacher(s)"];
const NEW = "12.2 / First / 2026-2027";
const OLD = "11.2 / Second / 2025-2026";
const rows = [
  ["Monday", "07:50:00", "09:50:00", "B305", "PoCC Informatika | PoCC Informatics", "A"],
  ["Monday", "10:10:00", "11:30:00", "B305", "Biologi | Biology", "B"],
  ["Friday", "07:10:00", "08:30:00", "B305", "Seni dan Budaya | Art", "C"],
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 9, 8, 0)); // Senin 9 November 2026
  calendar.events = [];
  calendar.sources = [];
  school.items = [];
  school.lessons = [...parseSchedule([{ headers: HEAD, rows }], NEW), ...parseSchedule([{ headers: HEAD, rows: [["Monday", "07:00", "08:00", "X", "Fisika | Physics", "G"]] }], OLD)];
  prefs.value.lessonReminders = false;
  prefs.value.showLessons = true;
});
afterEach(() => vi.useRealTimers());

const day = (d: number) => [new Date(2026, 10, d).getTime(), new Date(2026, 10, d, 23, 59).getTime()] as const;

describe("lessons in the calendar", () => {
  it("shows only the current period's lessons on the matching weekdays", () => {
    const monday = calendar.occurrences(...day(9)).filter((o) => o.origin === "lesson");
    expect(monday.map((o) => o.title)).toEqual(["PoCC Informatics", "Biology"]); // Physics adalah periode lama
    expect(calendar.occurrences(...day(10)).filter((o) => o.origin === "lesson")).toEqual([]); // Selasa kosong
    expect(calendar.occurrences(...day(13)).filter((o) => o.origin === "lesson").map((o) => o.title)).toEqual(["Art"]);
  });

  it("repeats weekly for the next weeks but not into the past", () => {
    expect(calendar.occurrences(...day(16)).filter((o) => o.origin === "lesson")).toHaveLength(2); // Senin pekan depan
    expect(calendar.occurrences(...day(2)).filter((o) => o.origin === "lesson")).toEqual([]); // pekan lalu
  });

  it("carries the real start and end times", () => {
    const [first] = calendar.occurrences(...day(9)).filter((o) => o.origin === "lesson");
    expect(first.start).toBe(new Date(2026, 10, 9, 7, 50).getTime());
    expect(first.end).toBe(new Date(2026, 10, 9, 9, 50).getTime());
  });

  it("rings only when the lesson reminder is turned on", () => {
    expect(calendar.occurrences(...day(9)).find((o) => o.origin === "lesson")?.remindMin).toBeNull();
    prefs.value.lessonReminders = true;
    expect(calendar.occurrences(...day(9)).find((o) => o.origin === "lesson")?.remindMin).toBe(10);
  });

  it("can be hidden and shown again", () => {
    prefs.value.showLessons = false;
    expect(calendar.occurrences(...day(9)).filter((o) => o.origin === "lesson")).toEqual([]);
    prefs.value.showLessons = true;
    expect(calendar.occurrences(...day(9)).filter((o) => o.origin === "lesson")).toHaveLength(2);
  });
});
