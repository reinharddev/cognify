// Excalidraw (React) sebagai "pulau" di dalam halaman Svelte. Modul ini hanya dimuat oleh halaman
// whiteboard (import dinamis), jadi React tidak ikut membebani halaman lain.
//
// Tetap offline: font dari /excalidraw/fonts (disalin oleh scripts/excalidraw-assets.mjs), fitur
// yang memakai server Excalidraw dimatikan (kolaborasi, pustaka online), dan CSP Tauri
// memblokir sisa permintaan ke luar.
import { i18n } from "$lib/i18n.svelte";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { WhiteboardScene } from "$lib/workspace/types";
import { NEO_DEFAULTS, detectStyle, neoAll, neoStyle, plainAll, type El } from "./neo";

/** Nilai awal bawaan Excalidraw, dipakai saat gaya aplikasi "normal". */
const PLAIN_DEFAULTS = {
  currentItemRoughness: 1,
  currentItemStrokeWidth: 2,
  currentItemStrokeColor: "#1e1e1e",
  currentItemFillStyle: "solid",
  currentItemBackgroundColor: "transparent",
  currentItemRoundness: "round",
  currentItemOpacity: 100,
  currentItemFontFamily: 5,
};

(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";

export type Theme = "light" | "dark";

export interface MountOptions {
  scene: WhiteboardScene;
  theme: Theme;
  /** Dipanggil setiap kali isi whiteboard berubah (bukan saat hanya digeser/di-zoom). */
  onChange: (scene: WhiteboardScene) => void;
  onLinkOpen: (url: string) => void;
  /** Kunci untuk mengingat posisi gulir dan zoom per papan (di perangkat ini). */
  viewKey?: string;
  /** Gambar baru otomatis bergaya neo (garis tegas + bayangan). */
  neo?: () => boolean;
}

interface View {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
}

function loadView(key?: string): View | null {
  if (!key) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && Number.isFinite(v.scrollX) && Number.isFinite(v.scrollY) && Number.isFinite(v.zoom?.value) ? v : null;
  } catch {
    return null;
  }
}

export interface WhiteboardHandle {
  /** Ganti nilai awal gambar baru antara gaya neo dan polos (gambar yang sudah ada tidak berubah). */
  setNeo(on: boolean): void;
  setTheme(theme: Theme): void;
  /** Isi terbaru, atau null jika editor belum siap. */
  current(): WhiteboardScene | null;
  exportPng(): Promise<Blob>;
  exportSvg(): Promise<string>;
  unmount(): void;
}

function toScene(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>, style: string): WhiteboardScene {
  return {
    type: "excalidraw",
    version: 2,
    elements: [...elements],
    appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize, cognifyStyle: style },
    files: { ...files },
  };
}

/** Berubah hanya jika gambar berubah: versi tiap elemen, file gambar, warna latar. */
function signature(elements: readonly { id: string; version: number }[], appState: { viewBackgroundColor: string }, files: object): string {
  let sum = 0;
  for (const el of elements) sum += el.version;
  return `${elements.length}:${sum}:${Object.keys(files).length}:${appState.viewBackgroundColor}`;
}

/**
 * Muat font tulisan tangan bawaan (Excalifont) segera setelah editor terpasang. Excalidraw baru
 * mengunduhnya saat teks pertama diketik; teks yang terlanjur diukur dengan font cadangan
 * tersimpan terlalu sempit dan terpotong saat diekspor. Font didaftarkan Excalidraw saat mount,
 * jadi dicoba beberapa kali sampai tersedia.
 */
async function preloadDefaultFont() {
  for (let i = 0; i < 20; i++) {
    const faces = await document.fonts.load("20px Excalifont", "Aa0").catch(() => []);
    // Font bawaan gaya neo (Nunito) dimuat juga supaya teks pertama terukur dengan benar.
    await document.fonts.load("20px Nunito", "Aa0").catch(() => []);
    if (faces.length) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function mountWhiteboard(container: HTMLElement, opts: MountOptions): WhiteboardHandle {
  const root = createRoot(container);
  let api: ExcalidrawImperativeAPI | null = null;
  let theme = opts.theme;
  let lastSig: string | null = null;
  const view = loadView(opts.viewKey);
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  let lastView = "";
  // Bentuk yang sudah dilihat; hanya bentuk baru yang otomatis diberi gaya neo (isi lama tidak diubah).
  // Gaya yang dipakai isi papan; bila berbeda dengan pilihan di Pengaturan, seluruh papan diubah mengikutinya.
  const wantNeo = () => opts.neo?.() !== false;
  let mode: "neo" | "normal" = wantNeo() ? "neo" : "normal";
  const savedMode = (opts.scene.appState as { cognifyStyle?: string }).cognifyStyle;
  const startMode = savedMode === "neo" || savedMode === "normal" ? savedMode : detectStyle(opts.scene.elements as El[]);
  let startElements = opts.scene.elements as unknown as El[];
  let resave = false;
  if (startMode !== mode) {
    startElements = mode === "neo" ? neoAll(startElements) : plainAll(startElements);
    resave = true;
  }
  const { cognifyStyle: _drop, ...sceneState } = opts.scene.appState as Record<string, unknown>;
  const seen = new Set<string>(startElements.map((e) => e.id));

  const menu = createElement(
    MainMenu,
    null,
    createElement(MainMenu.DefaultItems.SearchMenu),
    createElement(MainMenu.DefaultItems.ChangeCanvasBackground),
    createElement(MainMenu.DefaultItems.ClearCanvas),
    createElement(MainMenu.DefaultItems.Help),
  );

  function render() {
    root.render(
      createElement(
        Excalidraw,
        {
          initialData: {
            elements: startElements as never,
            // Gambar baru memakai gaya neo; isi yang sudah ada tidak diubah.
            appState: { ...(opts.neo?.() === false ? PLAIN_DEFAULTS : NEO_DEFAULTS), ...sceneState, ...(view ?? {}) } as never,
            files: opts.scene.files as never,
            // Tanpa posisi tersimpan, papan memusatkan isinya; dengan posisi tersimpan, kembali ke tempat terakhir.
            scrollToContent: !view,
          },
          excalidrawAPI: (a: ExcalidrawImperativeAPI) => (api = a),
          onChange: (elements, appState, files) => {
            rememberView(appState as unknown as Record<string, unknown>);
            autoNeo(elements as unknown as El[], appState as unknown as Record<string, unknown>);
            const sig = signature(elements, appState, files);
            if (lastSig === null) {
              lastSig = sig; // render pertama = isi yang baru dimuat, bukan perubahan
              if (resave) {
                resave = false;
                opts.onChange(toScene(elements, appState as never, files as never, mode));
              }
              return;
            }
            if (sig === lastSig) return;
            lastSig = sig;
            opts.onChange(toScene(elements, appState as never, files as never, mode));
          },
          onLinkOpen: (element, event) => {
            event.preventDefault();
            if (element.link && /^https?:\/\//i.test(element.link)) opts.onLinkOpen(element.link);
          },
          langCode: i18n.lang === "en" ? "en" : "id-ID",
          theme,
          aiEnabled: false,
          validateEmbeddable: false,
          UIOptions: {
            canvasActions: { export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: null },
          },
        },
        menu as ReactNode,
      ),
    );
  }
  render();
  preloadDefaultFont();

  // Menu "Mermaid to Excalidraw" (beserta judul "Generate"-nya) disembunyikan dari daftar alat tambahan.
  const hideGenerate = () => {
    for (const el of container.querySelectorAll<HTMLElement>(".dropdown-menu-item")) {
      if (!/mermaid/i.test(el.textContent ?? "")) continue;
      el.style.display = "none";
      const title = el.previousElementSibling as HTMLElement | null;
      if (title && !title.classList.contains("dropdown-menu-item")) title.style.display = "none";
    }
  };
  const generateObserver = new MutationObserver(hideGenerate);
  generateObserver.observe(container, { childList: true, subtree: true });

  /** Ingat posisi gulir dan zoom; menggeser tampilan saja tidak menyimpan ulang isi papan. */
  function rememberView(appState: Record<string, unknown>) {
    if (!opts.viewKey) return;
    const v = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: { value: (appState.zoom as { value: number }).value } };
    const text = JSON.stringify(v);
    if (text === lastView) return;
    lastView = text;
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      try {
        localStorage.setItem(opts.viewKey!, text);
      } catch {
        /* hanya kenyamanan */
      }
    }, 250);
  }

  /** Bentuk yang baru selesai digambar langsung bergaya neo (garis tegas + bayangan), tanpa menekan tombol. */
  function autoNeo(elements: readonly El[], appState: Record<string, unknown>) {
    if (opts.neo?.() === false) return;
    if (!api || lastSig === null) {
      for (const e of elements) seen.add(e.id);
      return;
    }
    // Tunggu sampai gambar selesai (bukan saat masih diseret atau teksnya diketik).
    if (appState.newElement || appState.editingTextElement) return;
    const fresh: Record<string, boolean> = {};
    for (const e of elements) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.isDeleted || e.customData?.neoShadowOf || e.groupIds.length) continue;
      if (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond") fresh[e.id] = true;
    }
    if (!Object.keys(fresh).length) return;
    const next = neoStyle(elements, fresh);
    if (next) for (const e of next) seen.add(e.id);
    if (next) queueMicrotask(() => api?.updateScene({ elements: next as never }));
  }

  function scene(): WhiteboardScene | null {
    if (!api) return null;
    return toScene(api.getSceneElements(), api.getAppState() as never, api.getFiles() as never, mode);
  }

  function exportInput() {
    if (!api) throw new Error("Whiteboard belum siap");
    return {
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
      files: api.getFiles(),
      exportPadding: 24,
    };
  }

  return {
    setNeo(on) {
      const next = on ? "neo" : "normal";
      if (!api || next === mode) return;
      mode = next;
      const els = api.getSceneElements() as unknown as El[];
      const converted = on ? neoAll(els) : plainAll(els);
      for (const e of converted) seen.add(e.id);
      api.updateScene({ elements: converted as never, appState: (on ? NEO_DEFAULTS : PLAIN_DEFAULTS) as never });
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      render();
    },
    current: scene,
    exportPng: () => exportToBlob({ ...exportInput(), mimeType: "image/png", getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) }),
    exportSvg: async () => (await exportToSvg(exportInput())).outerHTML,
    unmount: () => {
      generateObserver.disconnect();
      root.unmount();
    },
  };
}

/** Elemen yang benar-benar terlihat: yang tanpa garis, isian, atau teks tidak ikut menentukan ukuran gambar. */
function paints(e: Record<string, unknown>): boolean {
  if (e.isDeleted) return false;
  const clear = (c: unknown) => !c || c === "transparent";
  if (e.type === "text") return typeof e.text === "string" && e.text.trim() !== "";
  if (e.type === "image") return true;
  if (clear(e.strokeColor) && clear(e.backgroundColor)) return false;
  return Number(e.width) > 0.5 || Number(e.height) > 0.5;
}

/** Gambar papan sebagai SVG tanpa membuka editornya (untuk blok papan di dokumen). */
export async function sceneToSvg(scene: WhiteboardScene): Promise<string> {
  const visible = (scene.elements as Record<string, unknown>[]).filter(paints);
  if (!visible.length) return "";
  const svg = await exportToSvg({
    elements: visible as never,
    appState: { exportBackground: true, viewBackgroundColor: (scene.appState.viewBackgroundColor as string) ?? "#ffffff", exportWithDarkMode: false } as never,
    files: scene.files as never,
    exportPadding: 24,
  });
  // Tidak diperbesar melebihi ukuran aslinya (skala 1:1 seperti di papan), dan diletakkan di tengah.
  const natural = Number.parseFloat(svg.getAttribute("width") ?? "") || 0;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  if (natural) svg.style.maxWidth = `${natural}px`;
  svg.style.margin = "0 auto";
  return svg.outerHTML;
}
