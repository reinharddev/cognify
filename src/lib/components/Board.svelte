<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  // Papan gambar tanpa batas (Excalidraw). Isinya JSON adegan Excalidraw yang disimpan sebagai
  // `content` halaman; teks di papan dikirim sebagai teks pencarian.
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import type { WhiteboardHandle } from "$lib/whiteboard/excalidraw";
  import type { WhiteboardScene } from "$lib/workspace/types";

  let { content, onchange, viewKey }: { content: string; onchange: (json: string, plain: string) => void; viewKey?: string } = $props();

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

  // Ganti gaya di Pengaturan: gambar baru langsung mengikuti, tanpa membuka ulang papan.
  $effect(() => handle?.setNeo(prefs.value.style === "neo"));

  onMount(() => {
    let gone = false;
    import("$lib/whiteboard/excalidraw")
      .then((lib) => {
        if (gone) return;
        handle = lib.mountWhiteboard(container, {
          scene: parse(content),
          theme: "light",
          viewKey,
          neo: () => prefs.value.style === "neo",
          onChange: (scene) => onchange(JSON.stringify(scene), plainTextOf(scene)),
          onLinkOpen: (url) => (isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener")),
        });
      })
      .catch(() => (failed = tr("Papan tidak bisa dimuat.", "The board could not be loaded.")));
    return () => {
      gone = true;
      handle?.unmount();
      handle = null;
    };
  });

  export function exportPng(): Promise<Blob> {
    if (!handle) return Promise.reject(new Error(tr("Papan belum siap", "The board is not ready")));
    return handle.exportPng();
  }

  export function exportSvg(): Promise<string> {
    if (!handle) return Promise.reject(new Error(tr("Papan belum siap", "The board is not ready")));
    return handle.exportSvg();
  }
</script>

{#if failed}<p class="err">{failed}</p>{/if}
<div class="canvas" bind:this={container}></div>

<style>
  .canvas {
    height: calc(100vh - 190px);
    min-height: 360px;
    border: var(--edge-w) solid var(--edge);
    border-radius: 14px;
    box-shadow: var(--lift-lg);
    overflow: hidden;
  }
  /* Tombol di pojok kanan atas editor (dibuat di dalam Excalidraw, jadi gayanya global). */
  .canvas :global(.cog-neo) {
    margin-left: 8px;
    padding: 6px 12px;
    white-space: nowrap;
    flex: none;
    background: var(--accent);
    color: var(--accent-contrast);
    border: var(--edge-w) solid var(--edge);
    border-radius: 99px;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    transition: transform var(--dur-1), box-shadow var(--dur-1);
  }
  .canvas :global(.cog-neo:hover) {
    transform: translate(var(--hop), var(--hop));
    box-shadow: var(--lift);
  }
  .canvas :global(.cog-neo:active) {
    transform: none;
    box-shadow: none;
  }
  .err {
    color: var(--danger);
  }
</style>
