// Palet warna yang bisa dipilih pengguna. Dari satu rona (hue) dan tingkat warna (saturasi) dihitung
// token permukaan, teks, dan aksen untuk tema terang dan gelap. Kontrasnya dijamin lewat penyesuaian
// kecerahan, jadi warna kustom apa pun tetap nyaman dibaca. Token berarti (status, jenis halaman,
// kategori, tint) tidak diubah: warna itu membawa makna, bukan selera.
import { clamp, contrast, hexToHsl, hslToHex } from "./color";

export type Mode = "light" | "dark";
export type Tokens = Record<string, string>;

export type PaletteChoice =
  | { kind: "default" }
  | { kind: "preset"; id: string }
  | { kind: "custom"; hex: string };

export interface Preset {
  id: string;
  name: string;
  hue: number;
  /** 0 (hampir abu-abu) sampai 1 (pastel penuh). */
  sat: number;
}

export const PRESETS: Preset[] = [
  { id: "peach", name: "Persik", hue: 14, sat: 1 },
  { id: "butter", name: "Mentega", hue: 44, sat: 1 },
  { id: "mint", name: "Mint", hue: 152, sat: 0.9 },
  { id: "sky", name: "Langit", hue: 203, sat: 1 },
  { id: "rose", name: "Mawar", hue: 335, sat: 1 },
  { id: "graphite", name: "Grafit", hue: 250, sat: 0.05 },
];

/** Turunkan kecerahan (atau naikkan, bila dir = 1) sampai kontras terhadap semua latar memenuhi `min`. */
function fit(h: number, s: number, l: number, dir: -1 | 1, min: number, against: string[]): string {
  let L = l;
  let hex = hslToHex(h, s, L);
  while (L > 0 && L < 100 && !against.every((bg) => contrast(hex, bg) >= min)) {
    L += dir * 0.5;
    hex = hslToHex(h, s, L);
  }
  return hex;
}

export function derive(hue: number, sat: number, mode: Mode): Tokens {
  const k = 0.08 + 0.92 * clamp(sat, 0, 1); // skala saturasi
  const S = (base: number) => base * k;
  const h = hue;

  if (mode === "light") {
    const bg = hslToHex(h, S(100), 98.6);
    const surface = "#ffffff";
    const surface2 = hslToHex(h, S(100), 95.8);
    const accentSoft = hslToHex(h, S(100), 94.5);
    const base = [bg, surface, surface2, accentSoft];
    const text = fit(h, S(30), 20, -1, 9, base);
    const accent = hslToHex(h, S(100), 87);
    const accentHover = hslToHex(h, S(100), 84);
    return {
      bg,
      surface,
      "surface-2": surface2,
      border: fit(h, S(70), 91.5, -1, 1.12, [bg]),
      "border-strong": fit(h, S(55), 84, -1, 1.32, [bg]),
      text,
      "text-muted": fit(h, S(16), 42, -1, 4.8, base),
      link: fit(h, S(62), 46, -1, 4.8, base),
      accent,
      "accent-hover": accentHover,
      "accent-contrast": text,
      "accent-strong": fit(h, S(70), 56, -1, 3.2, [bg, surface, surface2]),
      "accent-soft": accentSoft,
    };
  }

  const bg = hslToHex(h, S(34), 14.5);
  const surface = hslToHex(h, S(34), 19.5);
  const surface2 = hslToHex(h, S(34), 16.5);
  const text = fit(h, S(100), 96, 1, 9, [bg, surface, surface2]);
  // Latar aksen lembut digelapkan sampai teks utama dan tautan tetap nyaman di atasnya (rona kuning lebih terang).
  const accentSoft = fit(h, S(30), 28, -1, 7.5, [text]);
  const base = [bg, surface, surface2, accentSoft];
  return {
    bg,
    surface,
    "surface-2": surface2,
    border: hslToHex(h, S(30), 27),
    "border-strong": hslToHex(h, S(28), 36),
    text,
    "text-muted": fit(h, S(30), 72, 1, 4.8, base),
    link: fit(h, S(100), 82, 1, 4.8, base),
    accent: hslToHex(h, S(100), 85),
    "accent-hover": hslToHex(h, S(100), 90),
    "accent-contrast": bg,
    "accent-strong": fit(h, S(100), 74, 1, 3.2, [bg, surface, surface2]),
    "accent-soft": accentSoft,
  };
}

/** Rona dan saturasi untuk pilihan palet, atau null bila memakai warna bawaan. */
export function paletteSource(choice: PaletteChoice): { hue: number; sat: number } | null {
  if (choice.kind === "preset") {
    const p = PRESETS.find((x) => x.id === choice.id);
    return p ? { hue: p.hue, sat: p.sat } : null;
  }
  if (choice.kind === "custom" && /^#[0-9a-f]{6}$/i.test(choice.hex)) {
    const { h, s } = hexToHsl(choice.hex);
    return { hue: h, sat: clamp(s / 100, 0, 1) };
  }
  return null;
}

/** Token yang harus ditimpa untuk pilihan palet dan tema; kosong untuk bawaan. */
export function overrides(choice: PaletteChoice, mode: Mode): Tokens {
  const src = paletteSource(choice);
  return src ? derive(src.hue, src.sat, mode) : {};
}
