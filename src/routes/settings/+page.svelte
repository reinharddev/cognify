<script lang="ts">
  import { i18n, setLang, tr } from "$lib/i18n.svelte";
  import ColorPicker from "$lib/ui/ColorPicker.svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { FONTS, prefs, type FontChoice, type StyleChoice } from "$lib/stores/prefs.svelte";
  import { derive, PRESETS } from "$lib/theme/palette";
  import { hslToHex, hexToHsl } from "$lib/theme/color";
  import { workspace } from "$lib/workspace/api";
  import ExtensionGuide from "$lib/components/ExtensionGuide.svelte";
  import type { BridgeStatus, McpInfo } from "$lib/workspace/types";

  type Tab = "general" | "appearance" | "preferences" | "mcp" | "data" | "about";
  const TABS = $derived<{ id: Tab; label: string }[]>([
    { id: "general", label: tr("Umum", "General") },
    { id: "appearance", label: tr("Tampilan", "Appearance") },
    { id: "preferences", label: tr("Preferensi", "Preferences") },
    { id: "mcp", label: "MCP (AI)" },
    { id: "data", label: "Data" },
    { id: "about", label: tr("Tentang", "About") },
  ]);
  const PRESET_EN: Record<string, string> = { peach: "Peach", butter: "Butter", mint: "Mint", sky: "Sky", rose: "Rose", graphite: "Graphite" };
  const FONT_EN: Record<string, string> = { rounded: "Rounded", system: "System" };
  let tab = $state<Tab>("general");

  const p = $derived(prefs.value);

  // Contoh warna untuk kotak pilihan: latar dan aksen dari tema yang sedang dipakai.
  function swatch(hue: number, sat: number) {
    const t = derive(hue, sat, prefs.resolved);
    return { bg: t.bg, accent: t.accent, strong: t["accent-strong"], text: t.text };
  }
  // Palet bawaan memakai nilai di app.css (krem hangat, aksen lavender), jadi contohnya ditulis langsung dari token itu.
  const defaultSwatch = { bg: "var(--bg)", accent: "var(--accent)", strong: "var(--accent-strong)" };
  const customHex = $derived(p.palette.kind === "custom" ? p.palette.hex : hslToHex(257, 100, 70));
  const customSwatch = $derived.by(() => {
    const { h, s } = hexToHsl(customHex);
    return swatch(h, s / 100);
  });

  let mcpInfo = $state<McpInfo | null>(null);
  let client = $state<"claude" | "codex" | "json">("claude");
  let copied = $state(false);
  const cmd = $derived(mcpInfo?.command ?? "/Applications/Cognify.app/Contents/MacOS/cognify");
  const snippet = $derived(
    client === "claude"
      ? `claude mcp add cognify -- "${cmd}" --mcp`
      : client === "codex"
        ? `[mcp_servers.cognify]\ncommand = "${cmd}"\nargs = ["--mcp"]`
        : JSON.stringify({ mcpServers: { cognify: { command: cmd, args: ["--mcp"] } } }, null, 2),
  );
  const where = $derived(
    client === "claude" ? tr("Jalankan di terminal.", "Run it in a terminal.") : client === "codex" ? tr("Tambahkan ke ~/.codex/config.toml.", "Add it to ~/.codex/config.toml.") : tr("Untuk Claude Desktop, Cursor, dan klien MCP lain yang memakai berkas konfigurasi JSON.", "For Claude Desktop, Cursor, and other MCP clients that use a JSON config file."),
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* salin manual dari kotak di atas */
    }
  }

  // Ekstensi browser: kode pemasangan berlaku 5 menit; status diperiksa ulang selama kode tampil.
  let ext = $state<BridgeStatus | null>(null);
  let extBusy = $state(false);
  let extNote = $state("");
  async function extRun(job: () => Promise<BridgeStatus>) {
    extBusy = true;
    extNote = "";
    try {
      ext = await job();
    } catch (e) {
      extNote = String((e as { message?: string })?.message ?? e);
    } finally {
      extBusy = false;
    }
  }
  async function extFolder() {
    try {
      await workspace.bridge.revealFolder();
    } catch (e) {
      extNote = String((e as { message?: string })?.message ?? e);
    }
  }
  $effect(() => {
    if (tab !== "data" || !ext?.code) return;
    const timer = setInterval(async () => {
      try {
        ext = await workspace.bridge.status();
      } catch {
        /* diperiksa lagi sebentar lagi */
      }
    }, 2000);
    return () => clearInterval(timer);
  });

  let version = $state("");
  onMount(async () => {
    workspace.bridge.status().then((s) => (ext = s), () => {});
    try {
      mcpInfo = await workspace.mcp.info();
    } catch {
      /* pakai jalur bawaan di contoh */
    }
    if (!isTauri()) return;
    try {
      version = (await (await import("@tauri-apps/api/app")).getVersion()) ?? "";
    } catch {
      /* hanya informasi */
    }
  });
</script>

<div class="settings">
  <h1>{tr("Pengaturan", "Settings")}</h1>
  <div class="layout">
    <nav aria-label={tr("Bagian pengaturan", "Settings sections")}>
      {#each TABS as t (t.id)}
        <button class:on={tab === t.id} aria-current={tab === t.id ? "page" : undefined} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </nav>

    <div class="panel">
      {#if tab === "general"}
        <h2>{tr("Umum", "General")}</h2>
        <div class="row">
          <div><b>{tr("Bahasa", "Language")}</b><small>{tr("Bahasa tampilan Cognify.", "Display language of Cognify.")}</small></div>
          <div class="seg" role="group" aria-label={tr("Bahasa", "Language")}>
            <button class:on={i18n.lang === "id"} onclick={() => setLang("id")}>Indonesia</button>
            <button class:on={i18n.lang === "en"} onclick={() => setLang("en")}>English</button>
          </div>
        </div>
        <div class="row">
          <div><b>{tr("Halaman awal", "Start page")}</b><small>{tr("Yang terbuka saat Cognify dijalankan.", "What opens when Cognify starts.")}</small></div>
          <div class="seg" role="group" aria-label={tr("Halaman awal", "Start page")}>
            <button class:on={p.startPage === "home"} onclick={() => prefs.set({ startPage: "home" })}>{tr("Beranda", "Home")}</button>
            <button class:on={p.startPage === "last"} onclick={() => prefs.set({ startPage: "last" })}>{tr("Terakhir dibuka", "Last opened")}</button>
          </div>
        </div>
        <div class="row">
          <div><b>{tr("Pekan mulai hari", "Week starts on")}</b><small>{tr("Dipakai di Kalender.", "Used in the Calendar.")}</small></div>
          <div class="seg" role="group" aria-label={tr("Pekan mulai hari", "Week starts on")}>
            <button class:on={p.weekStart === 1} onclick={() => prefs.set({ weekStart: 1 })}>{tr("Senin", "Monday")}</button>
            <button class:on={p.weekStart === 0} onclick={() => prefs.set({ weekStart: 0 })}>{tr("Minggu", "Sunday")}</button>
          </div>
        </div>
      {:else if tab === "appearance"}
        <h2>{tr("Warna", "Color")}</h2>
        <p class="hint">{tr("Pilih templat, atau tentukan warnamu sendiri. Warna lain disesuaikan otomatis supaya teks tetap nyaman dibaca.", "Pick a template or choose your own color. Other colors adjust automatically so text stays easy to read.")}</p>
        <div class="swatches" role="group" aria-label={tr("Palet warna", "Color palette")}>
          <button class="sw" class:on={p.palette.kind === "default"} onclick={() => prefs.set({ palette: { kind: "default" } })} style="--sw-bg:{defaultSwatch.bg};--sw-a:{defaultSwatch.accent};--sw-s:{defaultSwatch.strong}">
            <span class="chip"><i></i><i></i></span>{tr("Krem (bawaan)", "Cream (default)")}
          </button>
          {#each PRESETS as pr (pr.id)}
            {@const s = swatch(pr.hue, pr.sat)}
            <button class="sw" class:on={p.palette.kind === "preset" && p.palette.id === pr.id} onclick={() => prefs.set({ palette: { kind: "preset", id: pr.id } })} style="--sw-bg:{s.bg};--sw-a:{s.accent};--sw-s:{s.strong}">
              <span class="chip"><i></i><i></i></span>{tr(pr.name, PRESET_EN[pr.id] ?? pr.name)}
            </button>
          {/each}
          <div class="sw custom" class:on={p.palette.kind === "custom"} style="--sw-bg:{customSwatch.bg};--sw-a:{customSwatch.accent};--sw-s:{customSwatch.strong}">
            <span class="chip"><i></i><i></i></span>{tr("Kustom", "Custom")}
            <ColorPicker bind:value={() => customHex, (hex) => prefs.set({ palette: { kind: "custom", hex } })} label={tr("Warna kustom", "Custom color")} />
          </div>
        </div>

        <h2>{tr("Gaya", "Style")}</h2>
        <div class="seg" role="group" aria-label={tr("Gaya tampilan", "Display style")}>
          {#each [["neo", "Neo"], ["normal", "Normal"]] as const as [id, name] (id)}
            <button class:on={p.style === id} onclick={() => prefs.set({ style: id as StyleChoice })}>{name}</button>
          {/each}
        </div>
        <p class="hint">{tr("Neo memakai garis tinta tegas dan bayangan kecil. Normal tampil datar dan tenang. Gaya Neo di papan berlaku untuk papan yang dibuka berikutnya.", "Neo uses bold ink outlines and small shadows. Normal looks flat and calm. The Neo style on boards applies to boards opened next.")}</p>

        <h2>{tr("Huruf", "Font")}</h2>
        <div class="seg" role="group" aria-label={tr("Jenis huruf", "Font family")}>
          {#each Object.entries(FONTS) as [id, f] (id)}
            <button class:on={p.font === id} style="font-family:{f.css}" onclick={() => prefs.set({ font: id as FontChoice })}>{tr(f.name, FONT_EN[id] ?? f.name)}</button>
          {/each}
        </div>
        <div class="row">
          <div><b>{tr("Ukuran huruf", "Font size")}</b><small>{p.fontSize} px</small></div>
          <input type="range" min="13" max="19" step="1" value={p.fontSize} aria-label={tr("Ukuran huruf", "Font size")} oninput={(e) => prefs.set({ fontSize: Number(e.currentTarget.value) })} />
        </div>
        <h2>{tr("Gerak", "Motion")}</h2>
        <label class="row">
          <div><b>{tr("Animasi", "Animations")}</b><small>{tr("Gerak halus saat berpindah halaman, membuka menu, dan mencentang tugas. Otomatis mati bila sistemmu meminta gerak dikurangi.", "Smooth motion when changing pages, opening menus, and checking tasks. Turns off automatically if your system asks for reduced motion.")}</small></div>
          <input type="checkbox" role="switch" checked={p.motion} onchange={(e) => prefs.set({ motion: e.currentTarget.checked })} />
        </label>
        <button class="plain" onclick={() => prefs.reset()}>{tr("Kembalikan tampilan ke bawaan", "Reset appearance to default")}</button>
      {:else if tab === "preferences"}
        <h2>{tr("Editor", "Editor")}</h2>
        <label class="row">
          <div><b>{tr("Periksa ejaan", "Spell check")}</b><small>{tr("Garis bawah pada kata yang diduga salah ketik.", "Underlines words that look misspelled.")}</small></div>
          <input type="checkbox" role="switch" checked={p.spellcheck} onchange={(e) => prefs.set({ spellcheck: e.currentTarget.checked })} />
        </label>
        <h2>{tr("Catatan melayang", "Floating notes")}</h2>
        <label class="row">
          <div><b>{tr("Pintasan global", "Global shortcut")}</b><small>{tr("Tekan Ctrl/⌘ + Alt + N dari aplikasi mana pun untuk membuat catatan melayang baru.", "Press Ctrl/⌘ + Alt + N from any app to create a new floating note.")}</small></div>
          <input type="checkbox" role="switch" checked={p.stickyShortcut} onchange={(e) => { prefs.set({ stickyShortcut: e.currentTarget.checked }); void workspace.sticky.shortcut(e.currentTarget.checked); }} />
        </label>
        <h2>{tr("Kalender", "Calendar")}</h2>
        <label class="row">
          <div><b>{tr("Pengingat acara", "Event reminders")}</b><small>{tr("Notifikasi desktop sebelum acara mulai.", "Desktop notification before an event starts.")}</small></div>
          <input type="checkbox" role="switch" checked={p.reminders} onchange={(e) => prefs.set({ reminders: e.currentTarget.checked })} />
        </label>
      {:else if tab === "mcp"}
        <h2>MCP (AI)</h2>
        <p class="hint">{tr("Hubungkan AI apa pun yang mendukung MCP, seperti Claude, Codex, atau Cursor, supaya bisa mencari dan membaca catatanmu. Bawaannya mati.", "Connect any AI that supports MCP, such as Claude, Codex, or Cursor, so it can search and read your notes. Off by default.")}</p>
        <label class="row">
          <div><b>{tr("Nyalakan MCP", "Turn on MCP")}</b><small>{tr("AI boleh mencari dan membaca halaman, tag, dan acara kalender. Tidak bisa mengubah atau menghapus apa pun.", "The AI can search and read pages, tags, and calendar events. It cannot change or delete anything.")}</small></div>
          <input type="checkbox" role="switch" checked={p.mcp.enabled} onchange={(e) => prefs.set({ mcp: { enabled: e.currentTarget.checked, propose: p.mcp.propose } })} />
        </label>
        <label class="row" class:off={!p.mcp.enabled}>
          <div><b>{tr("Izinkan AI mengusulkan halaman baru", "Let the AI propose new pages")}</b><small>{tr("Hanya usulan: halaman dibuat setelah kamu menyetujuinya di menu Usulan.", "Proposals only: a page is created after you approve it in the Proposals menu.")}</small></div>
          <input type="checkbox" role="switch" disabled={!p.mcp.enabled} checked={p.mcp.propose} onchange={(e) => prefs.set({ mcp: { enabled: p.mcp.enabled, propose: e.currentTarget.checked } })} />
        </label>

        <h2>{tr("Cara menghubungkan", "How to connect")}</h2>
        <div class="seg" role="group" aria-label={tr("Klien MCP", "MCP client")}>
          <button class:on={client === "claude"} onclick={() => (client = "claude")}>Claude Code</button>
          <button class:on={client === "codex"} onclick={() => (client = "codex")}>Codex</button>
          <button class:on={client === "json"} onclick={() => (client = "json")}>{tr("Lainnya (JSON)", "Other (JSON)")}</button>
        </div>
        <p class="hint where">{where}</p>
        <pre class="code">{snippet}</pre>
        <button class="plain tight" onclick={copy}>{copied ? tr("Tersalin", "Copied") : tr("Salin", "Copy")}</button>
        <p class="hint">{tr("Cognify tidak perlu terbuka saat AI membaca. Perintah di atas bisa berbeda di versi klien lain, jadi cocokkan dengan dokumentasinya bila gagal.", "Cognify does not need to be open while the AI reads. The command above may differ in other client versions, so check its documentation if it fails.")}{mcpInfo?.dev ? tr(" Ini build pengembangan: datanya terpisah dari app terpasang.", " This is a development build: its data is separate from the installed app.") : ""}</p>
      {:else if tab === "data"}
        <h2>Data</h2>
        <p class="hint">{tr("Semua halamanmu tersimpan di komputer ini. Tidak ada akun, dan tidak ada yang dikirim ke internet.", "All your pages are stored on this computer. There is no account, and nothing is sent to the internet.")}</p>
        <p class="hint"><a href="/trash">{tr("Buka Sampah", "Open Trash")}</a> {tr("untuk memulihkan halaman yang terhapus.", "to restore deleted pages.")}</p>

        <h2>{tr("Ekstensi browser", "Browser extension")}</h2>
        <p class="hint">{tr("Simpan tulisan, link, atau satu halaman website langsung ke Cognify. Ikuti 5 langkah ini dari atas; yang sudah beres diberi tanda ✓.", "Save text, links, or a whole web page straight into Cognify. Follow these 5 steps from the top; finished ones are marked ✓.")}</p>
        <ExtensionGuide
          {ext}
          busy={extBusy}
          inApp={isTauri()}
          onToggle={(on) => extRun(() => workspace.bridge.setEnabled(on))}
          onCode={() => extRun(workspace.bridge.newCode)}
          onUnpair={() => extRun(workspace.bridge.unpair)}
          onFolder={extFolder}
        />
        {#if extNote}<p class="hint warn" role="alert">{extNote}</p>{/if}
      {:else}
        <h2>{tr("Tentang", "About")}</h2>
        <p class="hint">Cognify{version ? ` ${version}` : ""}. {tr("Ruang catatan untuk belajar dan semua kegiatanmu. Gratis, tanpa akun.", "A notes space for studying and everything you do. Free, no account.")}</p>
        <p class="hint">{tr("Sedang dikerjakan: fitur dan tampilannya masih bisa berubah.", "Work in progress: features and looks may still change.")}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.9em; margin-bottom: var(--space-4); }
  .layout { display: grid; grid-template-columns: 160px 1fr; gap: var(--space-6); align-items: start; }
  nav { display: flex; flex-direction: column; gap: 2px; }
  nav button { text-align: left; background: none; border: 0; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); }
  nav button:hover { background: var(--surface-2); color: var(--text); }
  nav button.on { background: var(--accent-soft); color: var(--text); font-weight: 600; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-6); min-height: 280px; }
  h2 { font-size: 0.85em; font-weight: 600; color: var(--text-muted); margin: var(--space-6) 0 var(--space-2); }
  h2:first-child { margin-top: 0; }
  .hint { color: var(--text-muted); max-width: 560px; margin: 0 0 var(--space-3); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-top: 1px solid var(--border); }
  h2 + .row { border-top: 0; }
  .row small { display: block; color: var(--text-muted); }
  h2 + .seg { margin-bottom: var(--space-3); }
  .seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 99px; padding: 3px; gap: 2px; flex-wrap: wrap; }
  .seg button { background: none; border: 0; padding: 6px 14px; border-radius: 99px; cursor: pointer; color: var(--text-muted); }
  .seg button.on { background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .seg button:focus-visible, nav button:focus-visible, .sw:focus-visible, .plain:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--space-3); }
  .sw { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px; border: 2px solid var(--border); border-radius: var(--radius); background: var(--surface); cursor: pointer; position: relative; text-align: left; }
  .sw.on { border-color: var(--accent-strong); }
  .chip { display: flex; gap: 6px; width: 100%; padding: 10px; border-radius: var(--radius-sm); background: var(--sw-bg); border: 1px solid var(--border); }
  .chip i { flex: 1; height: 16px; border-radius: 99px; background: var(--sw-a); }
  .chip i + i { background: var(--sw-s); }
  input[type="range"] { width: 180px; }
  .row.off { opacity: 0.55; }
  .where { margin-top: var(--space-3); }
  .code { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-3); margin: 0 0 var(--space-2); white-space: pre-wrap; word-break: break-all; font: 0.85em/1.5 var(--font-mono); user-select: all; }
  .hint.warn { color: var(--danger); }
  .plain.tight { margin: 0 0 var(--space-3); }
  .plain { margin-top: var(--space-6); background: none; border: 1px solid var(--border-strong); border-radius: 99px; padding: 7px 16px; cursor: pointer; color: var(--text); }
  .plain:hover { background: var(--surface-2); }
  @media (max-width: 640px) {
    .layout { grid-template-columns: 1fr; }
    nav { flex-direction: row; flex-wrap: wrap; }
  }
  /* Layar sempit: label di atas, kontrol di bawah dan selebar baris; segmen menggulir, tidak membungkus. */
  @media (max-width: 560px) {
    .row { flex-direction: column; align-items: stretch; gap: var(--space-2); }
    .seg { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; align-self: flex-start; }
    .seg button { white-space: nowrap; flex: none; }
  }
</style>
