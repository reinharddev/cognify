import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("menggabungkan ketikan beruntun menjadi satu simpan", async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave<{ a?: number; b?: number }>(save, () => {});
    a.push({ a: 1 });
    a.push({ b: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 1, b: 2 });
  });

  it("tetap menyimpan walau terus mengetik (maxWait)", async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave<{ n: number }>(save, () => {});
    for (let i = 0; i < 12; i++) {
      a.push({ n: i });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(save).toHaveBeenCalled();
  });

  it("menyimpan satu per satu sesuai urutan", async () => {
    const order: number[] = [];
    let running = 0;
    const save = vi.fn(async ({ n }: { n: number }) => {
      running++;
      expect(running).toBe(1);
      await new Promise((r) => setTimeout(r, 100));
      order.push(n);
      running--;
    });
    const a = createAutosave<{ n: number }>(save, () => {});
    a.push({ n: 1 });
    void a.flush();
    a.push({ n: 2 });
    const done = a.flush();
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(order).toEqual([1, 2]);
  });

  it("mencoba ulang saat gagal tanpa kehilangan isi", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("x");
    });
    const states: string[] = [];
    const a = createAutosave<{ n: number }>(save, (s) => states.push(s));
    a.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(states.at(-1)).toBe("error");
    expect(a.dirty()).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(save).toHaveBeenLastCalledWith({ n: 1 });
    expect(states.at(-1)).toBe("saved");
    expect(a.dirty()).toBe(false);
  });
});
