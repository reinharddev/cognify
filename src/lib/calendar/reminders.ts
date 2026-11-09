// Pengingat acara lewat notifikasi desktop selama Cognify berjalan. Hanya acara buatan sendiri yang
// punya pengingat; tiap kemunculan diingatkan sekali.

import { isTauri } from "@tauri-apps/api/core";
import { calendar } from "$lib/stores/calendar.svelte";
import { notifications } from "$lib/stores/notifications.svelte";
import { prefs } from "$lib/stores/prefs.svelte";
import { clock, longDate } from "./dates";

const KEY = "cognify.reminded";
const TICK_MS = 30_000;
const MAX_REMEMBERED = 500;
const LOOKAHEAD_MS = 7 * 86_400_000 + 3_600_000;
/** Pengingat yang terlambat sedikit (mis. app baru dibuka) tetap dibunyikan sampai selama ini sesudah waktunya. */
const GRACE_MS = 2 * 60_000;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
  return (await isPermissionGranted()) || (await requestPermission()) === "granted";
}

/**
 * Kemunculan yang saat pengingatnya sudah tiba dan belum lewat: sebelum acara mulai, atau paling lama
 * dua menit sesudah saat pengingat (supaya "saat acara mulai" bisa berbunyi). Tiap kemunculan sekali saja.
 */
export function dueReminders(now: number, already: ReadonlySet<string>) {
  return calendar
    .occurrences(now - GRACE_MS, now + LOOKAHEAD_MS) // acara yang baru mulai tetap dilihat untuk jendela toleransi
    .filter((o) => (o.origin === "local" || o.origin === "moodle" || o.origin === "school" || o.origin === "lesson") && o.remindMin !== null && !already.has(o.key))
    .filter((o) => {
      const remindAt = o.start - o.remindMin! * 60_000;
      return remindAt <= now && now < Math.max(o.start, remindAt + GRACE_MS);
    });
}

/** Pengingat terlewat (app tertutup, Mac tidur) tetap dicatat di lonceng selama acaranya belum lewat sehari. */
const CATCHUP_MS = 24 * 3_600_000;

/**
 * Kemunculan yang pengingatnya sudah lewat jendela normal tanpa pernah dibunyikan, dan yang belum
 * lebih dari sehari lalu. Dicatat diam-diam sebagai "Terlewat": tanpa bunyi, toast, atau notifikasi sistem.
 */
export function missedReminders(now: number, already: ReadonlySet<string>) {
  const due = new Set(dueReminders(now, already).map((o) => o.key));
  return calendar
    .occurrences(now - CATCHUP_MS, now)
    // Pelajaran tidak ikut "Terlewat": pengingatnya hanya berguna tepat waktu, dan jadwal sehari penuh akan membanjiri lonceng.
    .filter((o) => (o.origin === "local" || o.origin === "moodle" || o.origin === "school") && o.remindMin !== null && !already.has(o.key) && !due.has(o.key))
    .filter((o) => o.start - o.remindMin! * 60_000 <= now);
}

/**
 * Jalur kirim yang sama untuk pengingat asli dan tes. Mengembalikan hasil notifikasi sistem:
 * "ok" terkirim, "skipped" tidak dikirim (jendela sedang dilihat atau dimatikan), "denied" izin ditolak,
 * "error" gagal kirim, "browser" bukan di app Tauri.
 */
export async function deliver(
  n: { kind: "event" | "moodle" | "info"; title: string; body: string; href: string | null },
): Promise<"ok" | "skipped" | "denied" | "error" | "browser"> {
  // Seperti Discord: saat jendela sedang dilihat cukup toast dan bunyi di app; saat tidak, kirim notifikasi sistem juga.
  const watching = document.hasFocus() && document.visibilityState === "visible";
  const { notifySound, notifyDesktop } = prefs.value;
  notifications.push(n, { sound: notifySound, toast: watching });
  if (!isTauri()) return "browser";
  if (!notifyDesktop || watching) return "skipped";
  try {
    if (!(await ensureNotificationPermission())) return "denied";
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    await sendNotification({ title: n.title, body: n.body });
    return "ok";
  } catch (e) {
    console.error("notifikasi sistem gagal", e);
    return "error";
  }
}

/** Uji manual dari Pengaturan. `delaySec` memberi waktu pindah ke app lain sebelum notifikasi dikirim. */
export async function testReminder(delaySec = 0) {
  if (delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1000));
  return deliver({ kind: "info", title: "Tes pengingat", body: "Kalau ini terlihat dan terdengar, pengingat bekerja.", href: null });
}

export function startReminders(enabled: () => boolean = () => true): () => void {
  const reminded = new Set(load());
  let busy = false;

  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...reminded].slice(-MAX_REMEMBERED)));
    } catch {
      /* hanya kenyamanan: paling buruk pengingat terulang setelah dibuka ulang */
    }
  };

  const tick = async () => {
    if (busy || !isTauri() || !enabled()) return;
    busy = true;
    try {
      const now = Date.now();
      const missed = missedReminders(now, reminded);
      for (const o of missed) {
        reminded.add(o.key);
        const when = o.allDay ? longDate(o.start) : `${clock(o.start)}, ${longDate(o.start)}`;
        notifications.push({ kind: o.origin === "moodle" || o.origin === "school" ? "moodle" : "event", title: o.title, body: `Terlewat · ${when}`, href: o.origin === "moodle" ? "/moodle" : o.origin === "school" ? "/nilai/tugas" : "/calendar" });
      }
      const due = dueReminders(now, reminded);
      if (!due.length) {
        if (missed.length) persist();
        return;
      }
      for (const o of due) {
        reminded.add(o.key);
        const when = o.allDay ? longDate(o.start) : `${clock(o.start)}, ${longDate(o.start)}`;
        await deliver({ kind: o.origin === "moodle" || o.origin === "school" ? "moodle" : "event", title: o.title, body: when, href: o.origin === "moodle" ? "/moodle" : o.origin === "school" ? "/nilai/tugas" : "/calendar" });
      }
      persist();
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  // Timer webview bisa tertunda saat jendela tersembunyi atau Mac tidur: cek segera saat kembali terlihat.
  const wake = () => document.visibilityState === "visible" && void tick();
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  void tick();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
  };
}
