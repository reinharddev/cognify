// Preferensi pengguna: tema, warna, huruf, dan perilaku dasar. Disimpan di database (kunci "prefs"),
// dengan salinan kecil di localStorage ("cognify.boot") yang dibaca skrip di app.html sebelum halaman digambar.

import { workspace } from "$lib/workspace/api";
import { derive, overrides, type PaletteChoice, type Mode } from "$lib/theme/palette";

export type ThemeMode = "system" | "light" | "dark";
export type FontChoice = "rounded" | "system" | "serif" | "mono";
export type StartPage = "home" | "last";

export interface Prefs {
  mode: ThemeMode;
  palette: PaletteChoice;
  font: FontChoice;
  /** Ukuran huruf dasar dalam px. */
  fontSize: number;
  weekStart: 0 | 1;
  startPage: StartPage;
  reminders: boolean;
  spellcheck: boolean;
  /** Pintasan global untuk catatan melayang baru (Ctrl/Cmd+Alt+N). */
  stickyShortcut: boolean;
  /** Animasi (gerak halus). Mati total bila sistem meminta gerak dikurangi. */
  motion: boolean;
  /** Pintu MCP; lihat docs/MCP.md. */
  mcp: { enabled: boolean; propose: boolean };
}

export const DEFAULTS: Prefs = {
  mode: "system",
  palette: { kind: "default" },
  font: "rounded",
  fontSize: 15,
  weekStart: 1,
  startPage: "home",
  reminders: true,
  spellcheck: true,
  stickyShortcut: true,
  motion: true,
  mcp: { enabled: false, propose: false },
};

export const FONTS: Record<FontChoice, { name: string; css: string }> = {
  rounded: {
    name: "Bulat",
    css: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  },
  system: { name: "Sistem", css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { name: "Serif", css: 'ui-serif, "New York", Georgia, "Times New Roman", serif' },
  mono: { name: "Mono", css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
};

const BOOT_KEY = "cognify.boot";
const KEY = "prefs";

/** Gabungkan nilai tersimpan dengan bawaan, dan buang yang tidak valid. */
export function sanitize(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const pick = <T,>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  const pal = r.palette;
  let palette: PaletteChoice = DEFAULTS.palette;
  if (pal?.kind === "preset" && typeof pal.id === "string") palette = { kind: "preset", id: pal.id };
  else if (pal?.kind === "custom" && typeof pal.hex === "string" && /^#[0-9a-f]{6}$/i.test(pal.hex)) palette = { kind: "custom", hex: pal.hex };
  const size = Number(r.fontSize);
  return {
    mode: pick(r.mode, ["system", "light", "dark"] as const, DEFAULTS.mode),
    palette,
    font: pick(r.font, Object.keys(FONTS) as FontChoice[], DEFAULTS.font),
    fontSize: Number.isFinite(size) ? Math.min(19, Math.max(13, Math.round(size))) : DEFAULTS.fontSize,
    weekStart: r.weekStart === 0 ? 0 : 1,
    startPage: pick(r.startPage, ["home", "last"] as const, DEFAULTS.startPage),
    reminders: typeof r.reminders === "boolean" ? r.reminders : DEFAULTS.reminders,
    spellcheck: typeof r.spellcheck === "boolean" ? r.spellcheck : DEFAULTS.spellcheck,
    stickyShortcut: typeof r.stickyShortcut === "boolean" ? r.stickyShortcut : DEFAULTS.stickyShortcut,
    motion: typeof r.motion === "boolean" ? r.motion : DEFAULTS.motion,
    mcp: { enabled: r.mcp?.enabled === true, propose: r.mcp?.enabled === true && r.mcp?.propose === true },
  };
}

class PrefsStore {
  value = $state<Prefs>({ ...DEFAULTS });
  /** Tema yang benar-benar dipakai saat ini (mode "system" sudah diterjemahkan). */
  resolved = $state<Mode>("light");
  loaded = $state(false);
  private media: MediaQueryList | null = null;

  async init() {
    try {
      const raw = await workspace.settings.get(KEY);
      if (raw) this.value = sanitize(JSON.parse(raw));
    } catch {
      /* pakai bawaan */
    }
    this.loaded = true;
    this.apply();
    if (typeof matchMedia === "function") {
      this.media = matchMedia("(prefers-color-scheme: dark)");
      this.media.addEventListener("change", () => this.value.mode === "system" && this.apply());
    }
  }

  /** Ubah sebagian preferensi, terapkan, dan simpan. */
  async set(patch: Partial<Prefs>) {
    this.value = sanitize({ ...this.value, ...patch });
    this.apply();
    try {
      await workspace.settings.set(KEY, JSON.stringify(this.value));
    } catch {
      /* tampilan tetap berubah; simpan ulang pada perubahan berikutnya */
    }
  }

  async reset() {
    await this.set({ ...DEFAULTS });
  }

  apply() {
    const v = this.value;
    const dark = v.mode === "dark" || (v.mode === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
    this.resolved = dark ? "dark" : "light";
    const root = document.documentElement;
    const mode: Mode = this.resolved;
    // Hapus timpaan lama, lalu pasang yang baru.
    for (const m of ["light", "dark"] as Mode[]) for (const k of Object.keys(derive(0, 1, m))) root.style.removeProperty(`--${k}`);
    root.dataset.theme = mode;
    root.dataset.motion = v.motion ? "on" : "off";
    const vars = overrides(v.palette, mode);
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(`--${k}`, val);
    root.style.setProperty("--font", FONTS[v.font].css);
    root.style.setProperty("--fs", `${v.fontSize}px`);
    try {
      localStorage.setItem(
        BOOT_KEY,
        JSON.stringify({
          mode: v.mode,
          vars: { light: overrides(v.palette, "light"), dark: overrides(v.palette, "dark") },
          font: FONTS[v.font].css,
          fs: `${v.fontSize}px`,
          motion: v.motion,
        }),
      );
    } catch {
      /* hanya mencegah kedipan */
    }
  }
}

export const prefs = new PrefsStore();
