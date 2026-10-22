import { describe, expect, it } from "vitest";
import { MAX_ANGLE, atRest, push, safeAngle, shown, step, still } from "./swing";

const run = (s: ReturnType<typeof still>, seconds: number, dt = 1 / 60) => {
  let cur = s;
  for (let t = 0; t < seconds; t += dt) cur = step(cur, dt);
  return cur;
};

describe("swing", () => {
  it("stays still without a push", () => {
    expect(atRest(run(still(), 1))).toBe(true);
  });

  it("swings opposite to the push, then comes back and settles", () => {
    const pushed = push(still(), 1200); // jendela dipercepat ke kanan
    expect(pushed.vel).toBeGreaterThan(0);
    let s = pushed;
    let peak = 0;
    let crossed = false;
    for (let t = 0; t < 4; t += 1 / 60) {
      s = step(s, 1 / 60);
      peak = Math.max(peak, Math.abs(s.angle));
      if (s.angle < -0.001) crossed = true;
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(crossed).toBe(true); // berayun ke sisi lain, bukan hanya meredam
    expect(atRest(run(s, 6))).toBe(true);
  });

  it("never exceeds the maximum angle, however hard it is pushed", () => {
    let s = still();
    for (let i = 0; i < 50; i++) {
      s = push(s, 5000);
      s = step(s, 1 / 60);
      expect(Math.abs(s.angle)).toBeLessThanOrEqual(MAX_ANGLE + 1e-9);
    }
  });

  it("is stable for long and uneven frame times", () => {
    const s = run(push(still(), 800), 3, 0.05);
    expect(Number.isFinite(s.angle)).toBe(true);
    expect(Math.abs(s.angle)).toBeLessThanOrEqual(MAX_ANGLE);
    expect(Number.isFinite(step(push(still(), 800), 5).angle)).toBe(true);
  });

  it("a push in the other direction swings the other way", () => {
    const a = run(push(still(), 1000), 0.1).angle;
    const b = run(push(still(), -1000), 0.1).angle;
    expect(a * b).toBeLessThan(0);
  });

  it("never draws past the limit, and is nearly linear for small angles", () => {
    expect(Math.abs(shown(5, 0.2))).toBeLessThanOrEqual(0.2);
    expect(Math.abs(shown(-5, 0.2))).toBeLessThanOrEqual(0.2);
    expect(shown(0.01, 0.2)).toBeCloseTo(0.01, 3);
    expect(shown(-0.01, 0.2)).toBeCloseTo(-0.01, 3);
  });

  it("allows a smaller angle for taller cards so the swing fits the margin", () => {
    const room = 34;
    for (const h of [180, 320, 600]) {
      expect(h * Math.sin(safeAngle(h, room))).toBeLessThanOrEqual(room + 1e-9);
    }
    expect(safeAngle(600, room)).toBeLessThan(safeAngle(180, room));
    expect(safeAngle(10, room)).toBe(MAX_ANGLE);
  });
});
