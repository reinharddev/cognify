import { describe, expect, it } from "vitest";
import { ago, countdown, dueLabel } from "./format";

const NOW = Date.parse("2026-10-22T08:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe("ago", () => {
  it("describes how long ago in plain Indonesian", () => {
    expect(ago(at(-10_000), NOW)).toBe("baru saja");
    expect(ago(at(-5 * 60_000), NOW)).toBe("5 menit lalu");
    expect(ago(at(-3 * 3_600_000), NOW)).toBe("3 jam lalu");
    expect(ago(at(-2 * 86_400_000), NOW)).toBe("2 hari lalu");
  });
  it("copes with missing or invalid input", () => {
    expect(ago(null, NOW)).toBe("belum ada");
    expect(ago("bukan tanggal", NOW)).toBe("belum ada");
  });
});

describe("dueLabel", () => {
  it("labels near and far deadlines", () => {
    expect(dueLabel(null, NOW)).toBe("");
    expect(dueLabel(at(20 * 60_000), NOW)).toBe("kurang dari 1 jam lagi");
    expect(dueLabel(at(5 * 3_600_000), NOW)).toBe("5 jam lagi");
    expect(dueLabel(at(26 * 3_600_000), NOW)).toBe("besok");
    expect(dueLabel(at(-2 * 3_600_000), NOW)).toBe("2 jam lalu");
    expect(dueLabel(at(-3 * 86_400_000), NOW)).toBe("3 hari lalu");
  });
});

describe("countdown", () => {
  it("shows minutes, seconds, and done", () => {
    expect(countdown(at(7 * 60_000), NOW)).toBe("7 menit lagi");
    expect(countdown(at(30_000), NOW)).toBe("30 detik lagi");
    expect(countdown(at(-1000), NOW)).toBe("selesai");
    expect(countdown(null, NOW)).toBe("");
  });
});
