import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { concentric, gapBetween, gapInside, PHI, RADIUS, SPACE } from "./scale";

const SRC = join(__dirname, "..", "..");
const css = readFileSync(join(SRC, "app.css"), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(\\d+)px;`).exec(css);
  return m ? Number(m[1]) : NaN;
};

describe("skala ruang dan radius", () => {
  it("token CSS sama dengan skala (4px × Fibonacci)", () => {
    SPACE.forEach((v, i) => expect(token(`space-${i + 1}`), `--space-${i + 1}`).toBe(v));
    RADIUS.forEach((v, i) => expect(token(`radius-${i + 1}`), `--radius-${i + 1}`).toBe(v));
    expect(token("space-0")).toBe(2);
  });

  it("dua langkah berurutan berjumlah langkah berikutnya, rasionya mendekati φ", () => {
    for (let i = 2; i < SPACE.length; i++) {
      expect(SPACE[i]).toBe(SPACE[i - 1] + SPACE[i - 2]);
      expect(Math.abs(SPACE[i] / SPACE[i - 1] - PHI)).toBeLessThan(0.15);
    }
  });

  it("radius bersarang konsentris selalu jatuh di langkah skala", () => {
    for (let n = 2; n < RADIUS.length; n++) {
      // induk S(n), jarak S(n-1) atau S(n-2) → anak S(n-2) atau S(n-1)
      expect(RADIUS).toContain(concentric(SPACE[n], SPACE[n - 1]));
      expect(RADIUS).toContain(concentric(SPACE[n], SPACE[n - 2]));
    }
    expect([concentric(20, 12), concentric(12, 8), concentric(32, 20), concentric(20, 8), concentric(12, 4)]).toEqual([8, 4, 12, 12, 8]);
    expect(concentric(8, 12)).toBe(4); // tidak pernah di bawah radius terkecil
  });

  it("jarak dalam, jarak antar kelompok: satu langkah di bawah dan di atas", () => {
    expect(gapInside(20)).toBe(12);
    expect(gapBetween(20)).toBe(32);
    expect(gapInside(12)).toBe(8);
    expect(gapBetween(12)).toBe(20);
    expect(() => gapInside(14)).toThrow();
  });
});

// ── Pengaman: jarak dan radius di komponen harus lewat token, bukan angka bebas ─────
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

describe("jarak dan radius lewat token", () => {
  it("tidak ada angka px bebas di padding, margin, gap, dan border-radius (kecuali garis rambut ≤ 1,5px)", () => {
    const bad: string[] = [];
    const scan = (name: string, text: string) => {
      for (const m of text.matchAll(/(?<![\w-])((?:border-(?:top|bottom)-(?:left|right)-radius)|border-radius|gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left|inline|block))?|margin(?:-(?:top|right|bottom|left|inline|block))?)\s*:\s*([^;{}]+);/g)) {
        for (const px of m[2].matchAll(/(?<![\w.-])-?(\d*\.?\d+)px\b/g)) {
          if (Number(px[1]) > 1.5) bad.push(`${name}: ${m[1]}: ${m[2].trim()}`);
        }
      }
    };
    for (const f of files(SRC)) {
      const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(readFileSync(f, "utf8"));
      if (style) scan(relative(SRC, f), style[1]);
    }
    scan("app.css", css);
    expect(bad, `Pakai token --space-N / --radius-N (lihat app.css):\n${bad.join("\n")}`).toEqual([]);
  });

  it("hanya memakai token yang ada (--space-0…7, --radius-1…5, nama lama)", () => {
    const known = new Set(["space-0", "space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-7", "radius-1", "radius-2", "radius-3", "radius-4", "radius-5", "radius-pill", "radius", "radius-sm", "radius-lg"]);
    const unknown: string[] = [];
    for (const f of [...files(SRC), join(SRC, "app.css")]) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\(--((?:space|radius)[\w-]*)/g)) {
        if (!known.has(m[1])) unknown.push(`${relative(SRC, f)}: --${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
