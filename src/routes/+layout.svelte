<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import "../app.css";
  import { onMount, type Snippet } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { FileText, Home, Search, Shapes, Table2 } from "@lucide/svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import DialogHost from "$lib/ui/DialogHost.svelte";
  import { editableOf, textMenu } from "$lib/ui/textmenu";
  import { installTooltips } from "$lib/ui/tooltip";
  import SearchPalette from "$lib/components/SearchPalette.svelte";
  import { contextMenu } from "$lib/stores/contextmenu.svelte";
  import type { PageKind } from "$lib/workspace/types";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ToolPane from "$lib/components/ToolPane.svelte";
  import { startReminders } from "$lib/calendar/reminders";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { proposals } from "$lib/stores/proposals.svelte";
  import { startAgendaShare } from "$lib/stores/agendaShare.svelte";
  import { onNavigate } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import { isTauri } from "@tauri-apps/api/core";
  import { NotepadText } from "@lucide/svelte";
  import { workspace } from "$lib/workspace/api";
  import { Menu } from "@lucide/svelte";
  import { motionOff, startClickFx, startIconFx } from "$lib/motion";
  import { calendar } from "$lib/stores/calendar.svelte";
  import { notchLink } from "$lib/stores/link.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { getTool } from "$lib/tools/registry";

  let { children }: { children: Snippet } = $props();

  // Jendela catatan melayang memakai route yang sama tetapi tanpa sidebar dan tugas latar.
  const isSticky = $derived(page.url.pathname.startsWith("/sticky/"));
  let searching = $state(false);
  // Di layar sempit sidebar menjadi laci yang dibuka lewat tombol menu.
  let navOpen = $state(false);
  $effect(() => {
    void page.url.pathname;
    navOpen = false;
  });

  onMount(() => {
    const stopTips = installTooltips();
    if (isSticky) {
      void prefs.init();
      return stopTips;
    }
    void notchLink.init();
    void calendar.init();
    void (async () => {
      await Promise.all([prefs.init(), ws.init()]);
      // Halaman awal "terakhir dibuka": hanya bila aplikasi dibuka di Beranda dan halamannya masih ada.
      if (prefs.value.startPage === "last" && page.url.pathname === "/") {
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_KEY);
        } catch {
          /* tidak ada riwayat */
        }
        if (last && ws.nodes.some((n) => n.id === last)) await goto(`/p/${last}`, { replaceState: true });
      }
    })();
    const stopReminders = startReminders(() => prefs.value.reminders);
    const stopProposals = proposals.start();
    const stopAgenda = startAgendaShare();
    const stopClickFx = startClickFx();
    // Dari tray atau catatan melayang: buka halaman tertentu di jendela utama.
    // Catatan melayang membuat atau mengubah halaman dari jendela lain: muat ulang daftar halaman.
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const stopPages = isTauri()
      ? listen("pages-changed", () => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void ws.refresh(), 250);
        })
      : null;
    const stopNav = isTauri() ? listen<string>("tray-navigate", (e) => void goto(e.payload)) : null;
    const stopIconFx = startIconFx();
    return () => {
      stopTips();
      stopClickFx();
      void stopNav?.then((off) => off());
      void stopPages?.then((off) => off());
      clearTimeout(refreshTimer);
      stopIconFx();
      stopReminders();
      stopProposals();
      stopAgenda();
    };
  });

  // Perpindahan halaman memudar dan naik pelan lewat View Transitions; di webview tanpa fiturnya, langsung ganti.
  onNavigate((navigation) => {
    type VT = { finished: Promise<void> };
    const start = (document as Document & { startViewTransition?: (cb: () => Promise<void>) => VT }).startViewTransition;
    const area = document.querySelector("main");
    if (!start || !area || motionOff()) return;
    // Hanya area konten yang beranimasi; nama dipasang selama transisi saja.
    area.style.viewTransitionName = "content";
    return new Promise((resolve) => {
      const t = start.call(document, async () => {
        resolve();
        await navigation.complete;
      });
      const clear = () => area.style.removeProperty("view-transition-name");
      t.finished.then(clear, clear);
    });
  });

  const LAST_KEY = "cognify.lastPage";
  $effect(() => {
    if (page.route.id !== "/p/[id]" || !page.params.id) return;
    try {
      localStorage.setItem(LAST_KEY, page.params.id);
    } catch {
      /* hanya kenyamanan */
    }
  });

  // Alat tetap terpasang setelah dibuka pertama kali (disembunyikan, tidak dihancurkan) supaya
  // berkas, pengaturan, dan pekerjaan yang berjalan tidak hilang saat pindah halaman.
  const currentTool = $derived(
    page.route.id === "/tools/[id]" && getTool(page.params.id ?? "") ? page.params.id! : null,
  );
  let visited = $state<string[]>([]);
  $effect(() => {
    if (currentTool && !visited.includes(currentTool)) visited.push(currentTool);
  });

  async function newPage(kind: PageKind) {
    await goto(`/p/${(await ws.create(kind)).id}`);
  }

  // Tidak ada menu bawaan webview ("Back", "Reload", "Inspect Element", salin/tempel sistem) di mana pun:
  // kolom teks dan editor memakai menu teks sendiri, teks terpilih menawarkan Salin, selebihnya menu aplikasi.
  function oncontextmenu(event: MouseEvent) {
    if (event.defaultPrevented) return; // sudah ditangani menu khusus (mis. baris sidebar, papan)
    const target = event.target as Element | null;
    if (target?.closest(".excalidraw")) return void event.preventDefault();
    const field = editableOf(target);
    if (field) return contextMenu.show(event, textMenu(field));
    if (window.getSelection()?.toString()) return contextMenu.show(event, textMenu(null));
    if (isSticky) return void event.preventDefault();
    contextMenu.show(event, [
      { label: tr("Dokumen baru", "New document"), icon: FileText, onclick: () => newPage("doc") },
      { label: tr("Papan baru", "New board"), icon: Shapes, onclick: () => newPage("board") },
      { label: tr("Tabel baru", "New table"), icon: Table2, onclick: () => newPage("table") },
      { label: tr("Catatan melayang baru", "New floating note"), icon: NotepadText, onclick: () => void workspace.sticky.create() },
      { label: "Cari", icon: Search, separator: true, onclick: () => void (searching = true) },
      { label: tr("Beranda", "Home"), icon: Home, onclick: () => goto("/") },
    ]);
  }

  // Pilih semua hanya bekerja di dalam kolom isian atau dokumen; di tempat lain tidak memilih apa pun,
  // supaya sidebar dan tampilan aplikasi tidak ikut terblok. Zoom halaman ala browser juga dimatikan.
  function appKeys(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const k = event.key.toLowerCase();
    if (k === "a" && !editableOf(event.target as Element | null) && !(event.target as Element | null)?.closest?.(".excalidraw")) event.preventDefault();
    if (k === "+" || k === "=" || k === "-" || k === "0") event.preventDefault();
  }
  const noZoom = (event: WheelEvent) => event.ctrlKey && event.preventDefault();
  $effect(() => {
    // Harus tidak pasif supaya preventDefault berlaku.
    window.addEventListener("wheel", noZoom, { passive: false });
    return () => window.removeEventListener("wheel", noZoom);
  });

  function onkeydown(event: KeyboardEvent) {
    appKeys(event);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searching = !searching;
    }
  }
</script>

<svelte:window {onkeydown} {oncontextmenu} />

{#if isSticky}
  {@render children()}
{:else}
<div class="shell">
  <div class="side" class:open={navOpen}>
    <Sidebar onsearch={() => { navOpen = false; searching = true; }} />
  </div>
  {#if navOpen}<button class="scrim" aria-label={tr("Tutup menu", "Close menu")} onclick={() => (navOpen = false)}></button>{/if}
  <button class="burger" aria-label={tr("Buka menu", "Open menu")} aria-expanded={navOpen} onclick={() => (navOpen = true)}><Menu size={18} /></button>
  <main>
    {#if ws.error}
      <p class="fail">Penyimpanan tidak bisa dibuka: {ws.error}</p>
    {/if}
    {#each visited as id (id)}
      <div class="pane" hidden={id !== currentTool}>
        <ToolPane {id} active={id === currentTool} />
      </div>
    {/each}
    {@render children()}
  </main>
</div>

{/if}

<SearchPalette bind:open={searching} />
<ContextMenu />
<DialogHost />

<style>
  .shell {
    display: flex;
    height: 100vh;
  }
  .pane[hidden] {
    display: none;
  }
  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-6) var(--space-8);
  }
  .side {
    display: contents;
  }
  .burger,
  .scrim {
    display: none;
  }
  @media (max-width: 800px) {
    .side {
      display: block;
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 80;
      height: 100dvh;
      transform: translateX(-105%);
      transition: transform var(--dur-3) var(--ease-out);
    }
    .side.open {
      transform: none;
    }
    .side :global(aside) {
      height: 100%;
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 79;
      border: 0;
      border-radius: 0;
      background: color-mix(in srgb, var(--text) 32%, transparent);
      animation: fade var(--dur-2) ease both;
    }
    .burger {
      display: grid;
      place-items: center;
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 40;
      width: 38px;
      height: 38px;
      padding: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    main {
      padding: 58px var(--space-4) var(--space-6);
    }
  }
  .fail {
    color: var(--danger);
  }
</style>
