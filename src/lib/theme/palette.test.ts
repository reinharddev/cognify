// Warna kustom apa pun, dari rona dan saturasi mana pun, harus tetap lolos batas kontras yang sama
// dengan palet bawaan (lihat contrast.test.ts).
import { describe, expect, it } from "vitest";
import { clamp, contrast, hexToHsl, hslToHex, isHex } from "./color";
import { PRESETS, derive, overrides, paletteSource } from "./palette";

const HUES = Array.from({ length: 24 }, (_, i) => i * 15);
const SATS = [0, 0.05, 0.3, 0.6, 1];

describe("color", () => {
  it("hex dan HSL bolak-balik", () => {
    for (const hex of ["#c8bdff", "#ff7a59", "#43b081", "#ffffff", "#000000", "#808080"]) {
      const { h, s, l } = hexToHsl(hex);
      const back = hslToHex(h, s, l);
      // pembulatan rona ke bilangan bulat boleh menggeser satu-dua tingkat per kanal
      for (const i of [1, 3, 5]) expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(4);
    }
  });
  it("memvalidasi hex", () => {
    expect(isHex("#a1b2c3")).toBe(true);
    expect(isHex("a1b2c3")).toBe(false);
    expect(isHex("#abc")).toBe(false);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe.each(["light"] as const)("palet turunan, tema %s", (mode) => {
  for (const hue of HUES) {
    for (const sat of SATS) {
      it(`rona ${hue}, saturasi ${sat}`, () => {
        const t = derive(hue, sat, mode);
        const c = (n: string) => t[n];
        const need = (fg: string, bgs: string[], min: number) => {
          for (const bg of bgs) {
            const r = contrast(c(fg), c(bg));
            expect(r, `--${fg} di atas --${bg} = ${r.toFixed(2)}, perlu ${min}`).toBeGreaterThanOrEqual(min);
          }
        };
        need("text", ["bg", "surface", "surface-2", "accent-soft"], 7);
        need("text-muted", ["bg", "surface", "surface-2"], 4.5);
        need("link", ["bg", "surface", "surface-2", "accent-soft"], 4.5);
        need("accent-contrast", ["accent", "accent-hover"], 7);
        need("accent-strong", ["bg", "surface"], 3);
        const border = contrast(c("border"), c("bg"));
        expect(border).toBeGreaterThan(1.05);
        expect(border).toBeLessThan(2.2);
        expect(contrast(c("border-strong"), c("bg"))).toBeGreaterThan(1.25);
      });
    }
  }
});

describe("pilihan palet", () => {
  it("bawaan tidak menimpa apa pun", () => {
    expect(overrides({ kind: "default" }, "light")).toEqual({});
  });
  it("preset dikenali, id asing diabaikan", () => {
    for (const p of PRESETS) expect(paletteSource({ kind: "preset", id: p.id })).not.toBeNull();
    expect(paletteSource({ kind: "preset", id: "tidak-ada" })).toBeNull();
  });
  it("warna kustom yang rusak diabaikan", () => {
    expect(paletteSource({ kind: "custom", hex: "merah" })).toBeNull();
    expect(overrides({ kind: "custom", hex: "#12" }, "light")).toEqual({});
  });
  it("warna kustom diubah jadi rona dan saturasi", () => {
    const s = paletteSource({ kind: "custom", hex: "#ff0000" })!;
    expect(s.hue).toBe(0);
    expect(s.sat).toBeCloseTo(1, 1);
  });
  it("latar tetap pastel (hampir putih)", () => {
    for (const hue of HUES) expect(contrast(derive(hue, 1, "light").bg, "#ffffff")).toBeLessThan(1.1);
  });
});
