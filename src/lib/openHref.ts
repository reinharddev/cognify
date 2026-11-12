// Tujuan tautan dari notifikasi: halaman di dalam app, atau alamat https di luar (mis. portal sekolah) yang dibuka di browser
// pengguna. Alamat luar hanya dibuka dari klik pengguna, dan hanya yang diizinkan capabilities Tauri.

import { isTauri } from "@tauri-apps/api/core";
import { goto } from "$app/navigation";

export const isExternal = (href: string) => /^https:\/\//i.test(href);

export async function openHref(href: string): Promise<void> {
  if (!isExternal(href)) return goto(href);
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else window.open(href, "_blank", "noopener");
}
