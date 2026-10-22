<script lang="ts">
  // Papan gambar tanpa batas (Excalidraw). Isinya JSON adegan Excalidraw yang disimpan sebagai
  // `content` halaman; teks di papan dikirim sebagai teks pencarian.
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import type { WhiteboardHandle } from "$lib/whiteboard/excalidraw";
  import type { WhiteboardScene } from "$lib/workspace/types";

  let { content, onchange }: { content: string; onchange: (json: string, plain: string) => void } = $props();

  let container: HTMLDivElement;
  let handle: WhiteboardHandle | null = null;
  let failed = $state<string | null>(null);

  const EMPTY: WhiteboardScene = { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} };

  function parse(raw: string): WhiteboardScene {
    if (!raw.trim()) return EMPTY;
    try {
      const v = JSON.parse(raw);
      return v && Array.isArray(v.elements) ? { ...EMPTY, ...v } : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  /** Teks dari semua elemen teks yang belum dihapus, satu per baris, untuk pencarian. */
  function plainTextOf(scene: WhiteboardScene): string {
    return (scene.elements as { type?: string; text?: string; isDeleted?: boolean }[])
      .filter((e) => e.type === "text" && !e.isDeleted && e.text)
      .map((e) => e.text!.trim())
      .filter(Boolean)
      .join("\n");
  }

  onMount(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => handle?.setTheme(dark.matches ? "dark" : "light");
    let gone = false;
    import("$lib/whiteboard/excalidraw")
      .then((lib) => {
        if (gone) return;
        handle = lib.mountWhiteboard(container, {
          scene: parse(content),
          theme: dark.matches ? "dark" : "light",
          onChange: (scene) => onchange(JSON.stringify(scene), plainTextOf(scene)),
          onLinkOpen: (url) => (isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener")),
        });
        dark.addEventListener("change", onScheme);
      })
      .catch(() => (failed = "Papan tidak bisa dimuat."));
    return () => {
      gone = true;
      dark.removeEventListener("change", onScheme);
      handle?.unmount();
      handle = null;
    };
  });

  export function exportPng(): Promise<Blob> {
    if (!handle) return Promise.reject(new Error("Papan belum siap"));
    return handle.exportPng();
  }

  export function exportSvg(): Promise<string> {
    if (!handle) return Promise.reject(new Error("Papan belum siap"));
    return handle.exportSvg();
  }
</script>

{#if failed}<p class="err">{failed}</p>{/if}
<div class="canvas" bind:this={container}></div>

<style>
  .canvas {
    height: calc(100vh - 190px);
    min-height: 360px;
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .err {
    color: var(--danger);
  }
</style>
