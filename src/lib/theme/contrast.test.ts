// Menjaga sistem warna tetap nyaman dan konsisten: membaca token langsung dari src/app.css dan
// memeriksa kontras WCAG tiap pasangan yang dipakai di UI, di tema terang dan gelap.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");
const css = readFileSync(join(SRC, "app.css"), "utf8");

type Tokens = Record<string, string>;

function parseBlock(block: string): Tokens {
  const out: Tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = parseBlock(css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"]')));
const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
const dark = { ...light, ...parseBlock(darkBlock.slice(0, darkBlock.indexOf("\n}\n\n") > 0 ? darkBlock.indexOf("\n}\n\n") : undefined)) };

function resolve(tokens: Tokens, name: string, depth = 0): string {
  const v = tokens[name];
  if (v === undefined) throw new Error(`Token --${name} tidak ada`);
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (ref && depth < 5) return resolve(tokens, ref[1], depth + 1);
  return v;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Bukan warna hex: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: [string, Tokens][] = [["terang", light], ["gelap", dark]];
const TINTS = [1, 2, 3, 4, 5, 6].map((n) => `tint-${n}`);
const CATS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `cat-${n}`);
const STATUS = ["ok", "warn", "danger", "info"];
const KINDS = ["doc", "board", "table", "folder", "calendar", "notch"].map((k) => `kind-${k}`);

describe.each(THEMES)("kontras tema %s", (_name, t) => {
  const c = (n: string) => resolve(t, n);
  const need = (fg: string, bg: string, min: number) => {
    const r = ratio(c(fg), c(bg));
    expect(r, `--${fg} di atas --${bg} = ${r.toFixed(2)}, perlu ${min}`).toBeGreaterThanOrEqual(min);
  };

  it("teks utama terbaca nyaman di semua permukaan dan kartu berwarna", () => {
    for (const bg of ["bg", "surface", "surface-2", "accent-soft", ...TINTS]) need("text", bg, 7);
  });

  it("teks redup tetap memenuhi AA", () => {
    for (const bg of ["bg", "surface", "surface-2"]) need("text-muted", bg, 4.5);
  });

  it("tautan terbaca di semua permukaan", () => {
    for (const bg of ["bg", "surface", "surface-2", "accent-soft"]) need("link", bg, 4.5);
  });

  it("tombol aksen: teks di atas isian pastel dan saat disorot", () => {
    need("accent-contrast", "accent", 7);
    need("accent-contrast", "accent-hover", 7);
  });

  it("garis fokus dan pinggir aktif terlihat jelas", () => {
    for (const bg of ["bg", "surface"]) need("accent-strong", bg, 3);
  });

  it("status terbaca sebagai teks di permukaan dan di latar lembutnya", () => {
    for (const s of STATUS) {
      for (const bg of ["bg", "surface", "surface-2", `${s}-soft`]) need(s, bg, 4.5);
    }
  });

  it("warna jenis halaman dan kategori terlihat di atas permukaan", () => {
    for (const k of [...KINDS, ...CATS]) for (const bg of ["bg", "surface", "surface-2"]) need(k, bg, 3);
    for (const k of KINDS) need(k, `${k}-soft`, 2);
  });

  it("pinggir halus: ada tapi tidak keras", () => {
    const r = ratio(c("border"), c("bg"));
    expect(r).toBeGreaterThan(1.1);
    expect(r).toBeLessThan(2.2);
    expect(ratio(c("border-strong"), c("bg"))).toBeGreaterThan(1.3);
  });

  it("latar tetap pastel: tidak terlalu terang atau terlalu gelap, dan tidak ada hitam atau putih murni di halaman", () => {
    const l = luminance(c("bg"));
    if (_name === "terang") {
      expect(l).toBeGreaterThan(0.9);
      expect(c("bg").toLowerCase()).not.toBe("#ffffff");
    } else {
      expect(l).toBeLessThan(0.05);
      expect(l).toBeGreaterThan(0.005);
    }
    expect(c("text").toLowerCase()).not.toMatch(/^#(000000|ffffff)$/);
  });
});

describe("konsistensi", () => {
  it("setiap token tema terang yang dipakai komponen juga punya nilai di tema gelap bila tema gelap perlu mengubahnya", () => {
    // Token berwarna (bukan ukuran/huruf) yang berubah antar-tema harus ada di kedua blok.
    const colorTokens = Object.keys(light).filter((k) => /^#/.test(light[k]));
    const overridden = new Set(Object.keys(parseBlock(darkBlock)));
    const missing = colorTokens.filter((k) => !overridden.has(k));
    expect(missing, `Token berwarna tanpa nilai tema gelap: ${missing.join(", ")}`).toEqual([]);
  });

  it("tidak ada warna hex di komponen, kecuali yang memang sengaja", () => {
    const allowed: Record<string, string[]> = {
      "lib/tools/dev/QrCreate.svelte": ["#000000", "#ffffff"], // QR harus hitam di atas putih agar terbaca pemindai
      // Isi pemilih warna: data pilihan pengguna, bukan warna tema.
      "lib/ui/ColorPicker.svelte": ["#7e6cf0", "#3592be", "#39986c", "#b27f19", "#e26336", "#dd5b92", "#a26cf0", "#3d9793", "#2b2745", "#6a6486", "#ffffff", "#000000", "#000", "#fff", "#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f"],
      "lib/components/Editor.svelte": ["#7e6cf0", "#ffe066"], // warna awal pemilih warna teks dan sorot
      "lib/components/EventForm.svelte": ["#7e6cf0", "#3592be", "#b27f19", "#dd5b92", "#39986c", "#e26336"], // = --cat-* terang
    };
    const skip = /(\.test\.ts|mock\.ts|templates\.ts|i18n\.svelte\.ts|app\.css|theme\/palette\.ts)$/; // palette.ts = mesin warna, putih murni untuk kartu tema terang
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(svelte|ts)$/.test(name) && !skip.test(p)) {
          const rel = p.slice(SRC.length + 1);
          const found = [...readFileSync(p, "utf8").matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g)].map((m) => m[0].toLowerCase());
          for (const hex of found) if (!(allowed[rel] ?? []).includes(hex)) offenders.push(`${rel}: ${hex}`);
        }
      }
    };
    walk(SRC);
    expect(offenders, `Warna keras di komponen:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("pilihan warna acara sama dengan warna kategori tema terang", () => {
    const palette = ["#7e6cf0", "#3592be", "#b27f19", "#dd5b92", "#39986c", "#e26336"];
    const cats = CATS.map((n) => resolve(light, n).toLowerCase());
    for (const p of palette) expect(cats).toContain(p);
    // Terbaca di kedua tema, karena warnanya disimpan sebagai hex tetap.
    for (const p of palette) {
      expect(ratio(p, resolve(light, "bg"))).toBeGreaterThanOrEqual(3);
      expect(ratio(p, resolve(dark, "bg"))).toBeGreaterThanOrEqual(3);
    }
  });
});
