// Excalidraw (React) sebagai "pulau" di dalam halaman Svelte. Modul ini hanya dimuat oleh halaman
// whiteboard (import dinamis), jadi React tidak ikut membebani halaman lain.
//
// Tetap offline: font dari /excalidraw/fonts (disalin oleh scripts/excalidraw-assets.mjs), fitur
// yang memakai server Excalidraw dimatikan (kolaborasi, pustaka online), dan CSP Tauri
// memblokir sisa permintaan ke luar.
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { WhiteboardScene } from "$lib/workspace/types";

(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";

export type Theme = "light" | "dark";

export interface MountOptions {
  scene: WhiteboardScene;
  theme: Theme;
  /** Dipanggil setiap kali isi whiteboard berubah (bukan saat hanya digeser/di-zoom). */
  onChange: (scene: WhiteboardScene) => void;
  onLinkOpen: (url: string) => void;
}

export interface WhiteboardHandle {
  setTheme(theme: Theme): void;
  /** Isi terbaru, atau null jika editor belum siap. */
  current(): WhiteboardScene | null;
  exportPng(): Promise<Blob>;
  exportSvg(): Promise<string>;
  unmount(): void;
}

function toScene(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>): WhiteboardScene {
  return {
    type: "excalidraw",
    version: 2,
    elements: [...elements],
    appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize },
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
    if (faces.length) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function mountWhiteboard(container: HTMLElement, opts: MountOptions): WhiteboardHandle {
  const root = createRoot(container);
  let api: ExcalidrawImperativeAPI | null = null;
  let theme = opts.theme;
  let lastSig: string | null = null;

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
            elements: opts.scene.elements as never,
            appState: opts.scene.appState as never,
            files: opts.scene.files as never,
            scrollToContent: true,
          },
          excalidrawAPI: (a: ExcalidrawImperativeAPI) => (api = a),
          onChange: (elements, appState, files) => {
            const sig = signature(elements, appState, files);
            if (lastSig === null) {
              lastSig = sig; // render pertama = isi yang baru dimuat, bukan perubahan
              return;
            }
            if (sig === lastSig) return;
            lastSig = sig;
            opts.onChange(toScene(elements, appState as never, files as never));
          },
          onLinkOpen: (element, event) => {
            event.preventDefault();
            if (element.link && /^https?:\/\//i.test(element.link)) opts.onLinkOpen(element.link);
          },
          langCode: "id-ID",
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

  function scene(): WhiteboardScene | null {
    if (!api) return null;
    return toScene(api.getSceneElements(), api.getAppState() as never, api.getFiles() as never);
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
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      render();
    },
    current: scene,
    exportPng: () => exportToBlob({ ...exportInput(), mimeType: "image/png", getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) }),
    exportSvg: async () => (await exportToSvg(exportInput())).outerHTML,
    unmount: () => root.unmount(),
  };
}
