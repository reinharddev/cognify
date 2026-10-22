// Klien hubungan ke Cognify Notch (src-tauri/src/link). Di browser biasa dipakai data contoh
// supaya tampilan bisa dicoba tanpa Notch.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LinkStatus, NotchData } from "./types";

const CHANGED = "notch-data-changed";

// ── pratinjau di browser ──
const KEY = "cognify.preview.link";
const preview = {
  read(): { connected: boolean; clipboard: boolean } {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "") ?? { connected: false, clipboard: false };
    } catch {
      return { connected: false, clipboard: false };
    }
  },
  write(v: { connected: boolean; clipboard: boolean }) {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* pratinjau saja */
    }
  },
  status(): LinkStatus {
    const s = preview.read();
    let old = false;
    try {
      old = localStorage.getItem("cognify.preview.link.old") === "1";
    } catch {
      /* pratinjau saja */
    }
    return {
      connected: s.connected, shareClipboard: s.clipboard, connectedAt: s.connected ? new Date().toISOString() : null,
      notchInstalled: true, lastUpdate: s.connected ? new Date(Date.now() - 20_000).toISOString() : null,
      needsNewerCognify: false, folder: "~/Library/Application Support/Cognify Link",
      // Di pratinjau: `localStorage["cognify.preview.link.old"] = "1"` mensimulasikan Notch versi lama.
      linkAvailable: true, notchVersion: old ? "1.0.12" : "1.0.13", minNotchVersion: "1.0.13", notchOutdated: old,
    };
  },
  data(): NotchData | null {
    const s = preview.read();
    if (!s.connected) return null;
    const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    return {
      schema: 1, platform: "mac", appVersion: "1.0.12", updatedAt: new Date(Date.now() - 20_000).toISOString(),
      todos: [
        { id: "t1", title: "Kerjakan PR fisika", done: false, dueAt: at(26 * 60) },
        { id: "t2", title: "Bayar uang kas", done: false, dueAt: null },
        { id: "t3", title: "Kembalikan buku perpustakaan", done: true, dueAt: null },
      ],
      notes: [
        { id: "n1", text: "Ide judul skripsi: pengaruh LMS terhadap motivasi belajar siswa", createdAt: at(-90) },
        { id: "n2", text: "Tanya guru soal nomor 5", createdAt: at(-600) },
      ],
      clipboard: s.clipboard ? [{ id: "c1", kind: "link", text: "https://id.wikipedia.org/wiki/Fotosintesis", at: at(-20) }] : [],
      tray: [{ id: "f1", name: "laporan.pdf", path: "/Users/x/laporan.pdf", addedAt: at(-300) }],
      timers: [{ id: "m1", title: "Pasta", durationSec: 600, endsAt: at(7), running: true }],
      water: {
        goalMl: 2000, today: [{ at: at(-120), ml: 250 }, { at: at(-30), ml: 250 }],
        history: [{ date: "2026-10-20", ml: 1500 }, { date: "2026-10-21", ml: 1750 }],
      },
      agenda: [
        { id: "e1", title: "Kelas Fisika", start: at(40), end: at(100), allDay: false, calendar: "Sekolah" },
        { id: "e2", title: "Latihan band", start: at(7 * 60), end: null, allDay: false, calendar: "Pribadi" },
      ],
      now: {
        weather: { tempC: 29, summary: "Berawan", place: "Jakarta" },
        playing: { title: "Ada Selamanya", artist: "For Revenge" },
        battery: { percent: 80, charging: false },
      },
    };
  },
};

export const link = {
  status: async (): Promise<LinkStatus> => (isTauri() ? invoke("link_status") : preview.status()),
  connect: async (shareClipboard = false): Promise<LinkStatus> => {
    if (isTauri()) return invoke("link_connect", { shareClipboard });
    preview.write({ connected: true, clipboard: shareClipboard });
    return preview.status();
  },
  setShareClipboard: async (on: boolean): Promise<LinkStatus> => {
    if (isTauri()) return invoke("link_set_share_clipboard", { on });
    preview.write({ connected: preview.read().connected, clipboard: on });
    return preview.status();
  },
  disconnect: async (): Promise<LinkStatus> => {
    if (isTauri()) return invoke("link_disconnect");
    preview.write({ connected: false, clipboard: false });
    return preview.status();
  },
  writeAgenda: async (json: string): Promise<void> => {
    if (isTauri()) await invoke("link_write_agenda", { json });
  },
  data: async (): Promise<NotchData | null> => (isTauri() ? invoke("link_data") : preview.data()),
  onChanged: async (cb: () => void): Promise<UnlistenFn> => (isTauri() ? listen(CHANGED, cb) : () => {}),
};
