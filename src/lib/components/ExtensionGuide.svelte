<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { onMount } from "svelte";
  import { ChevronRight, RotateCcw } from "@lucide/svelte";
  import type { BridgeStatus } from "$lib/workspace/types";

  // Alur lima langkah untuk pemakai pertama. Tombol aksi ada di langkahnya masing-masing (tidak perlu mencari di halaman),
  // langkah yang sudah selesai ditandai ✓ dari status jembatan. Adegan mini (CSS, transform/opacity saja) main sekali saat
  // terlihat dan bisa diputar ulang; gerak dimatikan oleh pengaturan Gerak dan prefers-reduced-motion (lihat app.css).
  let {
    ext,
    busy,
    inApp,
    onToggle,
    onCode,
    onUnpair,
    onFolder,
  }: {
    ext: BridgeStatus | null;
    busy: boolean;
    inApp: boolean;
    onToggle: (on: boolean) => void;
    onCode: () => void;
    onUnpair: () => void;
    onFolder: () => void;
  } = $props();

  const enabled = $derived(ext?.enabled ?? false);
  const paired = $derived(ext?.paired ?? false);
  const done = $derived([enabled, false, paired, false, false]);

  let copied = $state(false);
  let moreOpen = $state(false);
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* alamatnya juga tertulis di layar */
    }
  }

  const TITLES = $derived([tr("Nyalakan", "Turn on"), tr("Pasang di browser", "Install in the browser"), tr("Hubungkan", "Connect"), tr("Simpan dari website", "Save from a website"), tr("Lihat di Cognify", "See it in Cognify")]);
  let runs = $state([0, 0, 0, 0, 0]);
  let seen = $state([false, false, false, false, false]);
  let rows: HTMLElement[] = [];

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = rows.indexOf(e.target as HTMLElement);
          if (e.isIntersecting && i >= 0 && !seen[i]) {
            seen[i] = true;
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.6 },
    );
    rows.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  });
</script>

<ol class="guide">
  {#each TITLES as title, i (title)}
    <li bind:this={rows[i]} class:done={done[i]}>
      <span class="n" aria-hidden="true">{done[i] ? "✓" : i + 1}</span>
      <div class="txt">
        <b>{title}{#if done[i]}<em class="tick">{tr("selesai", "done")}</em>{/if}</b>
        {#if i === 0}
          <p>{tr("Klik tombol di bawah ini supaya Cognify mau menerima simpanan dari browser. Aman, semuanya tetap ada di laptopmu dan tidak dikirim ke internet.", "Click the button below so Cognify accepts saves from the browser. It is safe: everything stays on your laptop and nothing is sent to the internet.")}</p>
          <button class="tgl" class:on={enabled} role="switch" aria-checked={enabled} disabled={busy || !inApp} onclick={() => onToggle(!enabled)}>
            <span class="track"><span class="thumb"></span></span>
            <span>{enabled ? tr("Menyala. Klik untuk mematikan.", "On. Click to turn off.") : tr("Mati. Klik di sini untuk menyalakan.", "Off. Click here to turn on.")}</span>
          </button>
          {#if ext?.error}<p class="warn">{ext.error}</p>{/if}
        {:else if i === 1}
          <p>{tr("Ekstensi ini belum ada di toko aplikasi Chrome, jadi dipasang manual dulu. Gampang kok, cuma sekali (sekitar 1 menit) di Chrome, Edge, atau Brave:", "This extension is not in the Chrome store yet, so install it manually for now. It is easy and only once (about 1 minute) in Chrome, Edge, or Brave:")}</p>
          <ol class="micro">
            <li>{tr("Klik tombol", "Click the")} <b>{tr("Buka folder ekstensi", "Open extension folder")}</b> {tr("di bawah. Satu folder akan terbuka, biarkan saja.", "button below. A folder will open; just leave it.")}</li>
            <li>{tr("Buka browsermu (halamannya bernama", "Open your browser (the page is called")} <b>Extensions</b>), {tr("lalu tempel alamat", "then paste the address")} <code>chrome://extensions</code> {tr("di kolom alamat dan tekan Enter. Alamat ini bisa disalin dengan tombol di bawah. (Pakai Edge? Ganti kata chrome dengan edge. Brave? Ganti dengan brave.)", "into the address bar and press Enter. You can copy it with the button below. (Using Edge? Replace chrome with edge. Brave? Replace it with brave.)")}</li>
            <li>{tr("Di halaman itu, nyalakan tombol", "On that page, turn on")} <b>{tr("Mode pengembang", "Developer mode")}</b> <i>(Developer mode)</i> {tr("di pojok kanan atas. Tenang, ini aman dan memang begini untuk ekstensi yang dipasang manual. Browsermu berbahasa Inggris? Tulisan dalam kurung adalah nama aslinya.", "in the top right corner. Don't worry, this is safe and normal for manually installed extensions. Is your browser in English? The text in brackets is the original name.")}</li>
            <li>{tr("Klik", "Click")} <b>{tr("Muat yang belum dibuka", "Load unpacked")}</b> <i>(Load unpacked)</i>, {tr("lalu pilih folder yang tadi terbuka.", "then choose the folder that opened earlier.")}</li>
          </ol>
          <div class="acts">
            <button class="act main" disabled={!inApp} onclick={onFolder}>{tr("Buka folder ekstensi", "Open extension folder")}</button>
            <button class="act" onclick={copyUrl}>{copied ? tr("Tersalin", "Copied") : tr("Salin alamat", "Copy address")}</button>
          </div>
          <div class="more">
            <button type="button" class="moreBtn" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}>
              <ChevronRight size={14} class={moreOpen ? "turn" : ""} /> {tr("Pakai Firefox atau Safari?", "Using Firefox or Safari?")}
            </button>
            {#if moreOpen}<p>{tr("Dua browser itu butuh langkah tambahan yang lebih rumit. Panduannya ada di berkas", "Those two browsers need extra, more involved steps. The guide is in the")} <code>README.md</code> {tr("di folder ekstensi.", "file in the extension folder.")}</p>{/if}
          </div>
        {:else if i === 2}
          <p>{tr("Klik ikon Cognify di pojok kanan atas browser (kalau tidak kelihatan, klik ikon puzzle, lalu klik", "Click the Cognify icon in the top right of the browser (if you can't see it, click the puzzle icon, then click")} <b>{tr("sematkan", "pin")}</b> <i>(pin)</i> {tr("di samping Cognify). Ketik 6 angka dari sini, lalu klik Sambungkan. Cukup sekali.", "next to Cognify). Type the 6 digits from here, then click Connect. Only once.")}</p>
          <div class="acts">
            <button class="act main" disabled={busy || !enabled} onclick={onCode}>{paired ? tr("Buat kode baru", "Create new code") : tr("Buat kode", "Create code")}</button>
            {#if paired}<button class="act" disabled={busy} onclick={onUnpair}>{tr("Putuskan", "Disconnect")}</button>{/if}
          </div>
          {#if !enabled}<p class="muted">{tr("Nyalakan dulu di langkah 1.", "Turn it on first in step 1.")}</p>{/if}
          {#if ext?.code}
            <p class="pair-code" aria-live="polite"><span>{ext.code}</span><small>{tr(`berlaku ${Math.max(1, Math.round((ext.codeExpiresIn ?? 0) / 60))} menit`, `valid for ${Math.max(1, Math.round((ext.codeExpiresIn ?? 0) / 60))} min`)}</small></p>
          {/if}
          {#if paired}<p class="ok">{tr("Sudah terhubung! Buat kode baru hanya kalau mau menghubungkan browser lain.", "Connected! Create a new code only if you want to connect another browser.")}</p>{/if}
        {:else if i === 3}
          <p>{tr("Blok tulisan di website, klik kanan, lalu pilih", "Select text on a website, right-click, then choose")} <b>{tr("Simpan teks terpilih ke Cognify", "Save selected text to Cognify")}</b>. {tr("Mau simpan satu halaman penuh? Klik kanan di bagian kosong halaman, pilih", "Want to save a whole page? Right-click an empty part of the page and choose")} <b>{tr("Simpan halaman ini ke Cognify", "Save this page to Cognify")}</b>. {tr("Jalan pintas: Alt+Shift+S (satu halaman) dan Alt+Shift+D (tulisan yang diblok).", "Shortcuts: Alt+Shift+S (whole page) and Alt+Shift+D (selected text).")}</p>
        {:else}
          <p>{tr("Buka Cognify, simpananmu ada di halaman", "Open Cognify; your saves are on the")} <b>{tr("Kliping web", "Web clippings")}</b> {tr("di menu samping. Tulisan yang kamu blok dari satu website digabung jadi satu catatan. Di popup ekstensi kamu juga bisa memilih disimpan ke mana dan memberi tag.", "page in the side menu. Text you select from one website is merged into a single note. In the extension popup you can also choose where to save it and add tags.")}</p>
        {/if}
      </div>
      <div class="scene-wrap">
        {#key runs[i]}
          <div class="scene s{i + 1}" class:play={seen[i]} role="img" aria-label={title}>
            {#if i === 0}
              <div class="bar"><i></i><i class="w"></i></div>
              <div class="sw"><span class="knob"></span></div>
            {:else if i === 1}
              <div class="url">chrome://extensions</div>
              <div class="row"><i class="w"></i><div class="sw"><span class="knob"></span></div></div>
              <div class="btn">Muat yang belum dibuka</div>
              <div class="card"><img class="logo" src="/cognify-logo.png" alt="" /><i class="w"></i></div>
            {:else if i === 2}
              <div class="tool"><img class="logo" src="/cognify-logo.png" alt="" /></div>
              <div class="pop">
                <div class="boxes"><b>4</b><b>8</b><b>2</b><b>9</b><b>1</b><b>3</b></div>
                <div class="go">Sambungkan</div>
                <div class="ok">✓ Tersambung</div>
              </div>
            {:else if i === 3}
              <div class="page"><i class="w"></i><i class="sel"></i><i class="w2"></i></div>
              <div class="menu"><i></i><i class="hit"></i><i></i></div>
              <div class="badge">✓</div>
            {:else}
              <div class="side">
                <div class="r"><i></i><i class="w"></i></div>
                <div class="r folder"><i class="k"></i><span>Kliping web</span></div>
                <div class="r kid"><i></i><span>Sorotan: Artikel</span><em>web</em></div>
              </div>
            {/if}
          </div>
        {/key}
        <button class="replay" aria-label="{tr("Putar ulang animasi langkah", "Replay animation of step")} {i + 1}" onclick={() => { seen[i] = true; runs[i]++; }}><RotateCcw size={13} /></button>
      </div>
    </li>
  {/each}
</ol>

<style>
  .guide, .guide > li { list-style: none; }
  .guide { list-style: none; margin: 0 0 var(--space-4); padding: 0; display: grid; gap: var(--space-3); }
  li { display: grid; grid-template-columns: 26px 1fr 184px; gap: var(--space-3); align-items: start; padding: var(--space-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); }
  li.done { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
  li.done .n { background: var(--ok-soft); color: var(--ok); }
  .n { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 99px; background: var(--accent); color: var(--accent-contrast); font-weight: 700; font-size: 0.85em; }
  .txt > b { display: block; margin-bottom: 2px; }
  .txt p { margin: 0; color: var(--text-muted); font-size: 0.9em; }
  .tick { margin-left: 8px; font-style: normal; font-weight: 600; font-size: 0.8em; color: var(--ok); }
  .txt p { margin: 0 0 var(--space-2); }
  .micro { margin: 0 0 var(--space-2); padding-left: 1.2em; color: var(--text-muted); font-size: 0.9em; }
  .micro li { display: list-item; padding: 0; background: none; border: 0; margin-bottom: 3px; }
  .micro b, .micro i { color: var(--text); }
  code { font: 0.85em var(--font-mono); background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 0 4px; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0; }
  .act { padding: 7px 14px; border: 1px solid var(--border-strong); border-radius: 99px; background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
  .act:hover:not(:disabled) { background: var(--accent-soft); }
  .act.main { background: var(--accent); border-color: transparent; color: var(--accent-contrast); font-weight: 600; }
  .act.main:hover:not(:disabled) { background: var(--accent-hover); }
  .act:disabled { opacity: 0.5; cursor: default; }
  .act:focus-visible, .moreBtn:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
  .tgl { display: inline-flex; align-items: center; gap: var(--space-3); padding: 6px 14px 6px 8px; border: 1px solid var(--border-strong); border-radius: 99px; background: var(--surface); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
  .tgl:hover:not(:disabled) { background: var(--accent-soft); }
  .tgl:disabled { opacity: 0.5; cursor: default; }
  .tgl:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
  .track { position: relative; flex: none; width: 38px; height: 22px; border-radius: 99px; background: var(--border-strong); transition: background var(--dur-2); }
  .thumb { position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 99px; background: var(--surface); box-shadow: 0 1px 3px var(--shadow-4); transition: transform var(--dur-2) var(--ease-spring); }
  .tgl.on .track { background: var(--ok); }
  .tgl.on .thumb { transform: translateX(16px); }
  .more { margin-top: var(--space-2); font-size: 0.9em; color: var(--text-muted); }
  .moreBtn { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: none; background: none; font: inherit; cursor: pointer; color: var(--link); }
  .moreBtn :global(.turn) { transform: rotate(90deg); }
  .muted { color: var(--text-muted); font-size: 0.9em; }
  .ok { color: var(--ok); }
  .warn { color: var(--danger); }
  .pair-code { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-3); margin: var(--space-2) 0; padding: var(--space-3) var(--space-4); background: var(--accent-soft); border-radius: var(--radius); animation: slideUp var(--dur-3) var(--ease-out) backwards; }
  .pair-code span { font: 600 1.8em/1 var(--font-mono); letter-spacing: 0.25em; user-select: all; }
  .pair-code small { color: var(--text-muted); }
  .scene-wrap { position: relative; }
  .replay { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 99px; color: var(--text-muted); cursor: pointer; opacity: 0; transition: opacity var(--dur-1); }
  .scene-wrap:hover .replay, .replay:focus-visible { opacity: 1; }
  @media (max-width: 640px) { li { grid-template-columns: 26px 1fr; } .scene-wrap { grid-column: 1 / -1; } }

  /* Adegan: kotak 184x110. Semua gerak hanya transform dan opacity; keadaan awal = sebelum main, akhir = hasil. */
  .scene { position: relative; height: 110px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 10px; --e: var(--ease-out); }
  .scene i { display: block; height: 6px; border-radius: 3px; background: var(--border-strong); }
  .scene i.w { width: 60%; } .scene i.w2 { width: 40%; }
  .sw { width: 28px; height: 16px; border-radius: 99px; background: var(--border-strong); position: relative; }
  .sw .knob { position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 99px; background: var(--surface); }
  .logo { width: 18px; height: 18px; border-radius: 5px; display: block; }

  /* 1 */
  .s1 .bar { position: absolute; left: 12px; top: 14px; width: 90px; display: grid; gap: 5px; }
  .s1 .sw { position: absolute; right: 12px; top: 10px; }
  .s1.play .sw { animation: bgOn 0.3s 0.5s var(--e) both; }
  .s1.play .knob { animation: knobOn 0.3s 0.5s var(--e) both; }

  /* 2 */
  .s2 .url { position: absolute; left: 10px; right: 10px; top: 8px; padding: 3px 8px; background: var(--surface-2); border-radius: 99px; color: var(--text-muted); }
  .s2 .row { position: absolute; left: 14px; right: 14px; top: 32px; display: flex; align-items: center; justify-content: space-between; }
  .s2 .row .w { width: 70px; }
  .s2 .btn { position: absolute; left: 14px; top: 50px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface-2); }
  .s2 .card { position: absolute; right: 12px; bottom: 4px; width: 70px; display: flex; align-items: center; gap: 5px; padding: 4px 6px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 7px; box-shadow: 0 2px 6px var(--shadow-4); opacity: 0; }
  .s2.play .sw { animation: bgOn 0.3s 0.4s var(--e) both; }
  .s2.play .knob { animation: knobOn 0.3s 0.4s var(--e) both; }
  .s2.play .btn { animation: press 0.4s 1.1s var(--e) both; }
  .s2.play .card { animation: slideUp 0.45s 1.6s var(--ease-spring) both; }

  /* 3 */
  .s3 .tool { position: absolute; right: 10px; top: 8px; padding: 3px; background: var(--surface-2); border-radius: 6px; }
  .s3 .pop { position: absolute; right: 10px; top: 34px; width: 150px; padding: 8px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; box-shadow: 0 3px 10px var(--shadow-4); display: grid; gap: 6px; transform-origin: top right; opacity: 0; }
  .s3 .boxes { display: flex; gap: 3px; }
  .s3 .boxes b { flex: 1; height: 20px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 4px; font: 700 11px var(--font-mono); color: transparent; }
  .s3 .go { text-align: center; padding: 3px; border-radius: 5px; background: var(--accent); color: var(--accent-contrast); font-weight: 700; }
  .s3 .ok { position: absolute; inset: 0; display: grid; place-items: center; background: var(--surface); border-radius: 8px; color: var(--ok); font-weight: 700; opacity: 0; }
  .s3.play .tool { animation: press 0.35s 0.3s var(--e) both; }
  .s3.play .pop { animation: popIn 0.35s 0.6s var(--ease-spring) both; }
  .s3.play .boxes b { animation: digit 0.01s both; color: var(--text); }
  .s3.play .boxes b:nth-child(1) { animation-delay: 1.0s; } .s3.play .boxes b:nth-child(2) { animation-delay: 1.15s; }
  .s3.play .boxes b:nth-child(3) { animation-delay: 1.3s; } .s3.play .boxes b:nth-child(4) { animation-delay: 1.45s; }
  .s3.play .boxes b:nth-child(5) { animation-delay: 1.6s; } .s3.play .boxes b:nth-child(6) { animation-delay: 1.75s; }
  .s3.play .go { animation: press 0.3s 2.0s var(--e) both; }
  .s3.play .ok { animation: fade 0.3s 2.35s var(--e) both; }
  .s3:not(.play) .boxes b { color: transparent; }

  /* 4 */
  .s4 .page { position: absolute; left: 12px; top: 14px; width: 100px; display: grid; gap: 6px; }
  .s4 .page .sel { width: 80%; background: var(--accent); transform-origin: left; transform: scaleX(0); height: 8px; }
  .s4 .menu { position: absolute; left: 70px; top: 40px; width: 96px; padding: 4px; display: grid; gap: 4px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 7px; box-shadow: 0 3px 10px var(--shadow-4); transform-origin: top left; opacity: 0; }
  .s4 .menu i { height: 9px; background: var(--border); }
  .s4 .menu i.hit { background: var(--accent-soft); outline: 1px solid var(--accent-strong); }
  .s4 .badge { position: absolute; right: 10px; top: 8px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 99px; background: var(--ok); color: var(--surface); font-weight: 700; opacity: 0; }
  .s4.play .sel { animation: grow 0.6s 0.4s var(--e) both; }
  .s4.play .hit { animation: flash 0.4s 1.8s var(--e) both; }
  .s4.play .menu { animation: popIn 0.3s 1.2s var(--ease-spring) both, fadeOut 0.2s 2.3s both; }
  .s4.play .badge { animation: popIn 0.4s 2.4s var(--ease-spring) both; }
  .s4:not(.play) .sel { transform: scaleX(0); }

  /* 5 */
  .s5 .side { position: absolute; left: 10px; top: 10px; right: 10px; display: grid; gap: 6px; }
  .s5 .r { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; }
  .s5 .r i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .s5 .r.folder { background: var(--accent-soft); opacity: 0; }
  .s5 .r.folder .k { background: var(--kind-doc); }
  .s5 .r.kid { margin-left: 14px; background: var(--surface-2); opacity: 0; }
  .s5 .r.kid i { background: var(--kind-doc); }
  .s5 .r.kid em { margin-left: auto; font-style: normal; padding: 1px 6px; border-radius: 99px; background: var(--ok-soft); color: var(--ok); }
  .s5.play .folder { animation: slideUp 0.4s 0.3s var(--ease-spring) both; }
  .s5.play .kid { animation: slideUp 0.4s 0.9s var(--ease-spring) both; }

  @keyframes bgOn { to { background: var(--accent-strong); } }
  @keyframes knobOn { to { transform: translateX(12px); } }
  @keyframes popIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
  @keyframes fade { to { opacity: 1; } }
  @keyframes fadeOut { to { opacity: 0; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes press { 40% { transform: scale(0.92); } }
  @keyframes grow { to { transform: scaleX(1); } }
  @keyframes flash { 50% { transform: scale(1.04); } }
  @keyframes digit { from { opacity: 0; } to { opacity: 1; } }
</style>
