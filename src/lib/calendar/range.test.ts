import { describe, expect, it } from "vitest";
import { dayKey } from "./dates";
import { resolveRange } from "./range";

// Rabu, 28 Oktober 2026
const now = new Date(2026, 9, 28, 15, 0).getTime();
const days = (r: { from: number; to: number }) => [dayKey(r.from), dayKey(r.to)];
const base = { from: "", to: "" };

describe("resolveRange", () => {
  it("hari ini", () => expect(days(resolveRange({ ...base, range: "today" }, now))).toEqual(["2026-10-28", "2026-10-28"]));
  it("pekan ini mulai Senin atau Minggu", () => {
    expect(days(resolveRange({ ...base, range: "week" }, now, 1))).toEqual(["2026-10-26", "2026-11-01"]);
    expect(days(resolveRange({ ...base, range: "week" }, now, 0))).toEqual(["2026-10-25", "2026-10-31"]);
  });
  it("bulan ini", () => expect(days(resolveRange({ ...base, range: "month" }, now))).toEqual(["2026-10-01", "2026-10-31"]));
  it("7 hari ke depan termasuk hari ini", () => expect(days(resolveRange({ ...base, range: "next7" }, now))).toEqual(["2026-10-28", "2026-11-03"]));
  it("tanggal sendiri, urutan terbalik dirapikan", () =>
    expect(days(resolveRange({ range: "custom", from: "2026-11-05", to: "2026-11-02" }, now))).toEqual(["2026-11-02", "2026-11-05"]));
  it("tanggal sendiri yang kosong jatuh ke hari ini", () => expect(days(resolveRange({ range: "custom", from: "", to: "" }, now))).toEqual(["2026-10-28", "2026-10-28"]));
});
