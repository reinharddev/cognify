// Sinkronisasi isi halaman antarjendela secara langsung: jendela utama dan catatan melayang bisa membuka
// halaman yang sama, dan perubahan di satu jendela langsung tampil di yang lain tanpa menunggu penyimpanan.
// Tiap jendela memberi sumber unik supaya tidak menerima gema perubahannya sendiri.

import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export interface PageChange {
  id: string;
  /** Isi (JSON Tiptap) dan/atau judul yang berubah. */
  content?: string;
  title?: string;
  from: string;
}

const EVENT = "page-synced";
// Di luar Tauri (pratinjau browser) antartab memakai BroadcastChannel.
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cognify-page-sync") : null;
const SOURCE = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

/** Kirim perubahan ke jendela lain, digabung dan ditahan ≈120 ms supaya mengetik cepat tidak membanjiri. */
export function createBroadcaster(pageId: () => string) {
  let acc: { content?: string; title?: string } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    timer = undefined;
    const out = acc;
    acc = {};
    if (out.content === undefined && out.title === undefined) return;
    if (!isTauri()) return void channel?.postMessage({ id: pageId(), ...out, from: SOURCE } satisfies PageChange);
    void emit(EVENT, { id: pageId(), ...out, from: SOURCE } satisfies PageChange).catch(() => undefined);
  };
  return {
    push(change: { content?: string; title?: string }) {
      acc = { ...acc, ...change };
      timer ??= setTimeout(send, 120);
    },
    /** Kirim sekarang (mis. sebelum jendela ditutup). */
    flush() {
      clearTimeout(timer);
      send();
    },
  };
}

/** Dengarkan perubahan dari jendela lain; mengembalikan fungsi untuk berhenti. */
export function onRemoteChange(handler: (change: PageChange) => void): () => void {
  if (!isTauri()) {
    if (!channel) return () => undefined;
    const on = (e: MessageEvent<PageChange>) => e.data.from !== SOURCE && handler(e.data);
    channel.addEventListener("message", on);
    return () => channel.removeEventListener("message", on);
  }
  const off = listen<PageChange>(EVENT, (e) => {
    if (e.payload.from !== SOURCE) handler(e.payload);
  });
  return () => void off.then((fn) => fn());
}
