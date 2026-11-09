// Pusat notifikasi dalam app: riwayat, jumlah belum dibaca, toast, dan bunyi. Seluruhnya lokal;
// riwayat disimpan di database (kunci "notifications"), maksimal MAX entri terbaru.

import { workspace } from "$lib/workspace/api";

export type NotifKind = "event" | "moodle" | "info";

export interface AppNotification {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  /** Tujuan saat diklik (mis. "/calendar"); null bila hanya informasi. */
  href: string | null;
  /** Waktu dibuat, epoch ms. */
  at: number;
  read: boolean;
}

const KEY = "notifications";
export const MAX = 100;
const TOAST_MS = 6_000;

/** Bersihkan data tersimpan: buang entri rusak, urut terbaru dulu, batasi jumlahnya. */
export function sanitizeList(raw: unknown): AppNotification[] {
  if (!Array.isArray(raw)) return [];
  const out: AppNotification[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const n = r as Record<string, unknown>;
    if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.at !== "number") continue;
    out.push({
      id: n.id,
      kind: n.kind === "event" || n.kind === "moodle" ? n.kind : "info",
      title: n.title,
      body: typeof n.body === "string" ? n.body : "",
      href: typeof n.href === "string" ? n.href : null,
      at: n.at,
      read: n.read === true,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX);
}

let beepCtx: AudioContext | null = null;
/** Nada pendek lewat WebAudio: tanpa berkas bunyi dan tanpa permintaan jaringan. */
function beep() {
  try {
    beepCtx ??= new AudioContext();
    const ctx = beepCtx;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    for (const [freq, at] of [[880, 0], [1175, 0.14]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    }
  } catch {
    /* tanpa bunyi bila audio tidak tersedia */
  }
}

class NotificationStore {
  items = $state<AppNotification[]>([]);
  /** Toast yang sedang tampil (subset dari items). */
  toasts = $state<AppNotification[]>([]);
  open = $state(false);
  loaded = $state(false);

  readonly unread = $derived(this.items.filter((n) => !n.read).length);

  async init() {
    try {
      const raw = await workspace.settings.get(KEY);
      if (raw) this.items = sanitizeList(JSON.parse(raw));
    } catch {
      /* mulai kosong */
    }
    this.loaded = true;
  }

  private async save() {
    try {
      await workspace.settings.set(KEY, JSON.stringify(this.items));
    } catch {
      /* daftar di memori tetap benar; tersimpan pada perubahan berikutnya */
    }
  }

  /** Tambah satu notifikasi. `sound` dan `toast` mengikuti preferensi pemanggil. */
  push(n: Omit<AppNotification, "id" | "at" | "read">, opts: { sound?: boolean; toast?: boolean } = {}): AppNotification {
    const item: AppNotification = { ...n, id: crypto.randomUUID(), at: Date.now(), read: false };
    this.items = [item, ...this.items].slice(0, MAX);
    void this.save();
    if (opts.sound) beep();
    if (opts.toast) {
      this.toasts = [item, ...this.toasts].slice(0, 3);
      setTimeout(() => this.dismissToast(item.id), TOAST_MS);
    }
    return item;
  }

  dismissToast(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  markRead(id: string) {
    this.items = this.items.map((n) => (n.id === id ? { ...n, read: true } : n));
    void this.save();
  }

  markAllRead() {
    if (!this.unread) return;
    this.items = this.items.map((n) => (n.read ? n : { ...n, read: true }));
    void this.save();
  }

  remove(id: string) {
    this.items = this.items.filter((n) => n.id !== id);
    this.dismissToast(id);
    void this.save();
  }

  clear() {
    this.items = [];
    this.toasts = [];
    void this.save();
  }
}

export const notifications = new NotificationStore();
