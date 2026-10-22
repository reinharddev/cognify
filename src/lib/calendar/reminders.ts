// Pengingat acara lewat notifikasi desktop selama Cognify berjalan. Hanya acara buatan sendiri yang
// punya pengingat; tiap kemunculan diingatkan sekali.

import { isTauri } from "@tauri-apps/api/core";
import { calendar } from "$lib/stores/calendar.svelte";
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
    .filter((o) => o.origin === "local" && o.remindMin !== null && !already.has(o.key))
    .filter((o) => {
      const remindAt = o.start - o.remindMin! * 60_000;
      return remindAt <= now && now < Math.max(o.start, remindAt + GRACE_MS);
    });
}

export function startReminders(enabled: () => boolean = () => true): () => void {
  const reminded = new Set(load());
  let busy = false;

  const tick = async () => {
    if (busy || !isTauri() || !enabled()) return;
    busy = true;
    try {
      const due = dueReminders(Date.now(), reminded);
      if (!due.length || !(await ensureNotificationPermission())) return;
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      for (const o of due) {
        reminded.add(o.key);
        const when = o.allDay ? longDate(o.start) : `${clock(o.start)}, ${longDate(o.start)}`;
        sendNotification({ title: o.title, body: when });
      }
      try {
        localStorage.setItem(KEY, JSON.stringify([...reminded].slice(-MAX_REMEMBERED)));
      } catch {
        /* hanya kenyamanan: paling buruk pengingat terulang setelah dibuka ulang */
      }
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  return () => clearInterval(timer);
}
