process.env.TZ = process.env.TEST_TZ ?? "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import { expandEvent } from "./expand";
import type { CalEvent } from "./types";

const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m, d, h, mi).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const base: CalEvent = {
  id: "e", title: "Acara", notes: "", start: iso(at(2026, 9, 22, 9)), end: null, allDay: false,
  repeat: "none", repeatUntil: null, remindMin: null, color: null,
};
const range = (from: number, to: number, e: Partial<CalEvent>) => expandEvent({ ...base, ...e }, from, to);
const days = (occ: { start: number }[]) => occ.map((o) => `${new Date(o.start).getMonth() + 1}/${new Date(o.start).getDate()}`);

describe("single events", () => {
  it("appears only when it overlaps the range", () => {
    expect(range(at(2026, 9, 22), at(2026, 9, 23), {})).toHaveLength(1);
    expect(range(at(2026, 9, 23), at(2026, 9, 24), {})).toHaveLength(0);
    expect(range(at(2026, 9, 1), at(2026, 9, 21), {})).toHaveLength(0);
  });

  it("an event that started earlier but is still running is included", () => {
    const e = { start: iso(at(2026, 9, 22, 22)), end: iso(at(2026, 9, 23, 2)) };
    expect(range(at(2026, 9, 23), at(2026, 9, 24), e)).toHaveLength(1);
  });

  it("all-day events use local dates and the end date counts as a day of the event", () => {
    const e = { allDay: true, start: "2026-10-22", end: "2026-10-24" };
    const [o] = range(at(2026, 9, 1), at(2026, 9, 31), e);
    expect(o.start).toBe(at(2026, 9, 22));
    expect(o.end).toBe(at(2026, 9, 25)); // tengah malam sesudah hari terakhir (eksklusif)
    expect(o.allDay).toBe(true);
    expect(range(at(2026, 9, 1), at(2026, 9, 31), { allDay: true, start: "2026-10-22", end: null })[0].end).toBeNull();
  });

  it("returns nothing for an unreadable start", () => {
    expect(range(0, Date.now() * 2, { start: "bukan tanggal" })).toEqual([]);
    expect(range(0, Date.now() * 2, { allDay: true, start: "2026-02-30" })).toEqual([]);
  });

  it("gives every occurrence a unique key and the Cognify event id", () => {
    const occ = range(at(2026, 9, 1), at(2026, 10, 30), { repeat: "weekly" });
    expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length);
    expect(occ.every((o) => o.eventId === "e" && o.origin === "local")).toBe(true);
  });
});

describe("repeating events", () => {
  it("daily steps one calendar day", () => {
    const occ = range(at(2026, 9, 22), at(2026, 9, 26, 23), { repeat: "daily" });
    expect(days(occ)).toEqual(["10/22", "10/23", "10/24", "10/25", "10/26"]);
  });

  it("weekly keeps the weekday and the local clock time across a daylight saving change", () => {
    // 26 Okt 2026 pukul 09.00; di zona dengan jam musim panas (mis. New York) perpindahan jam jatuh 1 Nov.
    const occ = range(at(2026, 9, 20), at(2026, 10, 20), { repeat: "weekly", start: iso(at(2026, 9, 26, 9)) });
    expect(days(occ)).toEqual(["10/26", "11/2", "11/9", "11/16"]);
    expect(occ.every((o) => new Date(o.start).getHours() === 9 && new Date(o.start).getDay() === 1)).toBe(true);
  });

  it("monthly clamps to the last day of shorter months", () => {
    const occ = range(at(2027, 0, 1), at(2027, 4, 1), { repeat: "monthly", start: iso(at(2027, 0, 31, 10)) });
    expect(days(occ)).toEqual(["1/31", "2/28", "3/31", "4/30"]);
  });

  it("yearly handles 29 February", () => {
    const occ = range(at(2028, 0, 1), at(2031, 11, 31), { repeat: "yearly", start: iso(at(2028, 1, 29, 8)) });
    expect(days(occ)).toEqual(["2/29", "2/28", "2/28", "2/28"]);
  });

  it("stops after the until date, inclusive", () => {
    const occ = range(at(2026, 9, 1), at(2026, 11, 31), { repeat: "weekly", repeatUntil: "2026-11-05" });
    expect(days(occ)).toEqual(["10/22", "10/29", "11/5"]);
  });

  it("an until date before the first occurrence still shows the first one only if it is on or before it", () => {
    expect(range(at(2026, 9, 1), at(2026, 11, 31), { repeat: "daily", repeatUntil: "2026-10-21" })).toHaveLength(0);
    expect(range(at(2026, 9, 1), at(2026, 11, 31), { repeat: "daily", repeatUntil: "2026-10-22" })).toHaveLength(1);
  });

  it("does not list occurrences before the first one", () => {
    expect(range(at(2026, 8, 1), at(2026, 9, 21), { repeat: "daily" })).toHaveLength(0);
  });

  it("long timed events keep their length on every occurrence", () => {
    const occ = range(at(2026, 9, 22), at(2026, 9, 30), { repeat: "weekly", end: iso(at(2026, 9, 22, 11)) });
    expect(occ[0].end! - occ[0].start).toBe(2 * 3_600_000);
  });

  it("is bounded: a far-away range does not loop forever", () => {
    const t0 = Date.now();
    const occ = range(at(2026, 9, 22), at(2100, 0, 1), { repeat: "daily" });
    expect(occ.length).toBeLessThanOrEqual(20_000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
