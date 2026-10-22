<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  // Jendela catatan melayang. Isinya halaman dokumen biasa (tersimpan di app); jendelanya transparan,
  // selalu di atas, dan kartunya berayun seperti bandul saat jendela digeser (lib/swing.ts).
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { isTauri } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LogicalPosition } from "@tauri-apps/api/dpi";
  import { ExternalLink, Palette, Pin, PinOff, Trash2, X } from "@lucide/svelte";
  import { createAutosave } from "$lib/autosave";
  import Editor from "$lib/components/Editor.svelte";
  import { motionOff } from "$lib/motion";
  import { createBroadcaster, onRemoteChange } from "$lib/pageSync";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { atRest, push, safeAngle, shown, step, still, type Swing } from "$lib/swing";
  import { workspace } from "$lib/workspace/api";
  import type { Page } from "$lib/workspace/types";

  const id = $derived(page.params.id ?? "");
  // Kunci pengaturan: tanda hubung tidak diizinkan, selaras dengan sticky.rs (`record_key`).
  const recordKey = $derived(`sticky.${id.replaceAll("-", "_")}`);
  /** Ruang di sisi kartu untuk ayunan (px); harus sama dengan padding .frame di bawah. */
  const ROOM = 34;
  const COLORS = 6; // --tint-1 … --tint-6

  let note = $state<Page | null>(null);
  let error = $state("");
  let color = $state(0);
  let pinned = $state(true);
  let moving = $state(false);
  let card: HTMLElement | undefined = $state();
  let editor = $state<{ setRemote(json: string): void }>();
  const sync = createBroadcaster(() => id);

  let plain = "";
  let titleAuto = true;
  let geometry: { x?: number; y?: number; w?: number; h?: number } = {};

  // ── Penyimpanan isi ──
  /** Beri tahu jendela utama supaya daftar halaman di sidebarnya ikut diperbarui. */
  const announce = () => (isTauri() ? void emit("pages-changed") : undefined);

  const firstLine = (text: string) => text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 60) ?? "";

  const saver = createAutosave<{ content: string; plainText: string; title?: string }>(
    async (patch) => {
      await workspace.pages.update(id, patch);
      announce();
    },
    (state) => (error = state === "error" ? tr("Catatan belum tersimpan, mencoba lagi…", "The note is not saved yet, retrying…") : ""),
  );
  const flush = () => saver.flush();

  function onEdit(json: string, text: string) {
    plain = text;
    sync.push({ content: json, ...(titleAuto ? { title: firstLine(text) } : {}) });
    saver.push({ content: json, plainText: text, ...(titleAuto ? { title: firstLine(text) } : {}) });
  }

  // ── Warna, posisi, dan ukuran jendela ──
  let recTimer: ReturnType<typeof setTimeout> | undefined;
  function saveRecord() {
    clearTimeout(recTimer);
    recTimer = setTimeout(() => {
      void workspace.settings.set(recordKey, JSON.stringify({ ...geometry, color, pin: pinned }));
    }, 400);
  }

  async function captureGeometry() {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const [pos, size, sf] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
    if (!drag) winPos = { x: pos.x / sf, y: pos.y / sf };
    geometry = { x: Math.round(pos.x / sf), y: Math.round(pos.y / sf), w: Math.round(size.width / sf), h: Math.round(size.height / sf) };
    saveRecord();
  }

  function cycleColor() {
    color = (color + 1) % COLORS;
    saveRecord();
  }

  async function togglePin() {
    pinned = !pinned;
    await workspace.sticky.pin(id, pinned);
    saveRecord();
  }

  async function closeNote() {
    await flush();
    // Catatan kosong tidak perlu disimpan: langsung dibuang supaya tidak menumpuk.
    if (!plain.trim() && !(note?.title ?? "").trim()) await workspace.pages.trash(id).catch(() => undefined);
    announce();
    await workspace.sticky.close(id);
  }

  async function deleteNote() {
    saver.cancel();
    await workspace.pages.trash(id).catch(() => undefined);
    announce();
    await workspace.sticky.close(id);
  }

  // ── Ayunan ──
  let swing: Swing = still();
  let raf = 0;
  let last = 0;
  // Jendela tidak langsung dipindah ke posisi pointer (event pointer datang tidak rata: kadang berkelompok, kadang
  // jarang saat cepat). Posisi tujuan dikejar tiap frame oleh penyusul halus (`fx`, `fy`) dan jendela dipindah tepat
  // sekali per frame, jadi geraknya berirama seragam. Kecepatan datar `fx` disaring dua kali (dua penyaring orde-1)
  // sehingga turunannya berubah mulus; perubahan kecepatan itu menjadi dorongan ke bandul. Setelah dilepas, semuanya
  // terus menyusul sampai diam, jadi ayunan baliknya halus.
  const FOLLOW = 0.018; // detik: seberapa lembut jendela mengejar pointer
  const TAU = 0.03; // detik: penghalusan kecepatan untuk ayunan
  let fx = 0;
  let fy = 0;
  let p1 = 0;
  let p2 = 0;
  let vPrev = 0;
  let wantCapture = false;

  function frame(t: number) {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
    last = t;
    const kf = 1 - Math.exp(-dt / FOLLOW);
    const following = Math.abs(target.x - fx) > 0.4 || Math.abs(target.y - fy) > 0.4;
    if (drag || following) {
      fx += (target.x - fx) * kf;
      fy += (target.y - fy) * kf;
      if (!following && !drag) {
        fx = target.x;
        fy = target.y;
      }
      moveTo(Math.round(fx), Math.round(fy));
    }
    const k = 1 - Math.exp(-dt / TAU);
    p1 += (fx - p1) * k;
    p2 += (p1 - p2) * k;
    const v = (p1 - p2) / TAU; // px/detik
    const swinging = !motionOff() && prefs.value.motion;
    if (swinging) {
      swing = push(swing, v - vPrev);
      swing = step(swing, dt);
      if (card) card.style.transform = `rotate(${shown(swing.angle, safeAngle(card.offsetHeight, ROOM))}rad)`;
    }
    vPrev = v;
    if (!drag && !following && Math.abs(v) < 1 && (!swinging || atRest(swing))) {
      swing = still();
      vPrev = 0;
      if (card) card.style.transform = "";
      raf = 0;
      last = 0;
      if (wantCapture) {
        wantCapture = false;
        void captureGeometry();
      }
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // ── Seret jendela ──
  // Digeser lewat pointer (bukan seret bawaan OS): selama seret bawaan, macOS tidak mengirim event gerak ke
  // halaman, jadi kecepatannya tidak terbaca. Dengan pointer, kecepatan datar langsung diketahui.
  let winPos = { x: 0, y: 0 }; // posisi jendela (piksel logis)
  let drag: { id: number; sx: number; sy: number; x0: number; y0: number } | null = null;
  let sending = false;
  let target = { x: 0, y: 0 };

  /** Satu permintaan pindah dalam satu waktu; yang terbaru menang (frame berikutnya mengirim posisi terkini). */
  function moveTo(x: number, y: number) {
    if (sending) return;
    sending = true;
    winPos = { x, y };
    getCurrentWindow()
      .setPosition(new LogicalPosition(x, y))
      .catch(() => undefined /* jendela sudah ditutup */)
      .finally(() => (sending = false));
  }

  function dragStart(event: PointerEvent) {
    if (!isTauri() || event.button !== 0 || (event.target as Element).closest("button")) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, sx: event.screenX, sy: event.screenY, x0: winPos.x, y0: winPos.y };
    fx = target.x = p1 = p2 = winPos.x;
    fy = target.y = winPos.y;
    vPrev = 0;
    moving = true;
    startLoop();
  }

  function dragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    target = { x: drag.x0 + (event.screenX - drag.sx), y: drag.y0 + (event.screenY - drag.sy) };
  }

  function dragEnd(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    moving = false;
    // Dilepas: `frame` terus menyusul tujuan lalu meluruhkan kecepatan ke nol, itulah yang membuat kartu terayun balik
    // dengan halus; posisi akhir disimpan setelah semuanya diam.
    wantCapture = true;
    startLoop();
  }

  onMount(() => {
    document.documentElement.classList.add("sticky-mode");
    void (async () => {
      try {
        const [p, rec] = await Promise.all([workspace.pages.get(id), workspace.settings.get(recordKey)]);
        note = p;
        titleAuto = !p.title || p.title === firstLine(p.title);
        if (rec) {
          const r = JSON.parse(rec) as { color?: number; pin?: boolean } & typeof geometry;
          color = Number.isInteger(r.color) ? (r.color as number) % COLORS : 0;
          pinned = r.pin !== false;
          geometry = { x: r.x, y: r.y, w: r.w, h: r.h };
        } else {
          color = Math.floor(Math.random() * COLORS);
        }
        // Muncul dengan sedikit ayunan, seperti kertas yang baru ditempel.
        swing = push(swing, -420);
        startLoop();
      } catch {
        error = tr("Catatan tidak ditemukan.", "Note not found.");
      }
    })();

    // Perubahan dari jendela utama langsung tampil di catatan ini (kecuali ada ketikan lokal yang belum tersimpan).
    const offRemote = onRemoteChange((c) => {
      if (c.id === id && c.content !== undefined && !saver.dirty()) editor?.setRemote(c.content);
    });
    if (!isTauri()) return () => { offRemote(); document.documentElement.classList.remove("sticky-mode"); };
    const win = getCurrentWindow();
    void captureGeometry();
    const offMove = win.onMoved(() => void captureGeometry());
    const offSize = win.onResized(() => void captureGeometry());
    return () => {
      void offMove.then((off) => off());
      void offSize.then((off) => off());
      offRemote();
      saver.dispose();
      sync.flush();
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("sticky-mode");
    };
  });

  function grip(event: PointerEvent) {
    if (!isTauri() || event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startResizeDragging("SouthEast");
  }
</script>

<svelte:window onbeforeunload={() => void flush()} />

<div class="frame">
  <section class="card" class:moving bind:this={card} style:--paper="var(--tint-{color + 1})" aria-label={tr("Catatan melayang", "Floating note")}>
    <header role="presentation" onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}>
      <button class="ico" title={tr("Ganti warna", "Change color")} aria-label={tr("Ganti warna", "Change color")} onclick={cycleColor}><Palette size={15} /></button>
      <button class="ico" class:on={pinned} title={pinned ? tr("Selalu di atas (klik untuk melepas)", "Always on top (click to release)") : tr("Biarkan di atas", "Keep on top")} aria-label={tr("Selalu di atas", "Always on top")} aria-pressed={pinned} onclick={togglePin}>
        {#if pinned}<Pin size={15} />{:else}<PinOff size={15} />{/if}
      </button>
      <span class="grow"></span>
      <button class="ico" title={tr("Buka di Cognify", "Open in Cognify")} aria-label={tr("Buka di Cognify", "Open in Cognify")} onclick={() => workspace.sticky.openInMain(id)}><ExternalLink size={15} /></button>
      <button class="ico" title={tr("Buang catatan", "Delete note")} aria-label={tr("Buang catatan", "Delete note")} onclick={deleteNote}><Trash2 size={15} /></button>
      <button class="ico" title={tr("Tutup (tetap tersimpan)", "Close (stays saved)")} aria-label={tr("Tutup", "Close")} onclick={closeNote}><X size={15} /></button>
    </header>
    <div class="body">
      {#if note}
        <Editor bind:this={editor} content={note.content} spellcheck={prefs.value.spellcheck} toolbar={false} onchange={onEdit} />
      {:else if error}
        <p class="msg">{error}</p>
      {/if}
    </div>
    {#if note && error}<p class="msg warn" role="status">{error}</p>{/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip" onpointerdown={grip} aria-hidden="true"></div>
  </section>
</div>

<style>
  .frame {
    position: fixed;
    inset: 0;
    /* Ruang di sekeliling kartu supaya kartu yang berayun tidak terpotong tepi jendela. */
    padding: 30px 40px 60px;
    display: flex;
  }
  .card {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
    border-radius: 10px;
    box-shadow: 0 8px 16px -8px var(--shadow-2), 0 2px 4px var(--shadow-1);
    /* Bergantung pada titik tengah tepi atas, seperti ditempel dengan satu peniti. */
    transform-origin: 50% 0;
    will-change: transform;
    animation: pop var(--dur-3) var(--ease-spring) backwards;
    transition: box-shadow var(--dur-2) ease;
  }
  .card.moving {
    box-shadow: 0 14px 24px -10px var(--shadow-3), 0 3px 8px var(--shadow-4);
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    cursor: grab;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    user-select: none;
    -webkit-user-select: none;
  }
  .grow {
    flex: 1;
    align-self: stretch;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .ico:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text);
  }
  .ico.on {
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 12px 14px;
  }
  .body :global(.tiptap) {
    outline: none;
    min-height: 100%;
    font-size: 0.95em;
  }
  .msg {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
  }
  .msg.warn {
    color: var(--danger);
    font-size: 0.85em;
    padding: 0 12px 8px;
  }
  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 55%, color-mix(in srgb, var(--text) 30%, transparent) 55%, color-mix(in srgb, var(--text) 30%, transparent) 62%, transparent 62%, transparent 74%, color-mix(in srgb, var(--text) 30%, transparent) 74%, color-mix(in srgb, var(--text) 30%, transparent) 81%, transparent 81%);
    border-bottom-right-radius: 10px;
  }
</style>
