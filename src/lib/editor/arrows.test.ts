import { describe, expect, it } from "vitest";
import { ARROW_COUNT, arrowHead, arrowShape } from "./arrows";

describe("arrows", () => {
  it("ada 10 rancangan", () => expect(ARROW_COUNT).toBe(10));

  it("semua rancangan menghasilkan path dan arah yang sah untuk berbagai arah dan jarak", () => {
    const starts = [{ x: 0, y: 0 }, { x: 100, y: 200 }];
    const ends = [{ x: 300, y: 0 }, { x: -200, y: 150 }, { x: 0, y: -400 }, { x: 100.4, y: 200.4 }, { x: 100, y: 200 }];
    for (let i = 0; i < ARROW_COUNT; i++)
      for (const a of starts)
        for (const b of ends) {
          const s = arrowShape(i, a, b);
          expect(s.d.startsWith("M ")).toBe(true);
          expect(s.d).not.toMatch(/NaN|Infinity/);
          expect(Number.isFinite(s.angle)).toBe(true);
          expect(arrowHead(b, s.angle)).not.toMatch(/NaN/);
        }
  });

  it("indeks di luar rentang diputar kembali", () => {
    expect(arrowShape(13, { x: 0, y: 0 }, { x: 10, y: 10 }).d).toBe(arrowShape(3, { x: 0, y: 0 }, { x: 10, y: 10 }).d);
  });
});
