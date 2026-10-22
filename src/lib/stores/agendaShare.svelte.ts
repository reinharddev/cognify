// Membagikan agenda kalender Cognify ke Notch (Windows memakainya sebagai sumber kalender) selagi
// terhubung: ditulis ulang saat acara atau langganan berubah (tunda 2 detik), tiap 5 menit, dan saat
// hubungan baru tersambung. Tidak menulis apa pun bila tidak terhubung.

import { buildAgenda, agendaRange } from "$lib/link/agenda";
import { link } from "$lib/link/api";
import { calendar } from "./calendar.svelte";
import { notchLink } from "./link.svelte";

const EVERY_MS = 5 * 60_000;
const DEBOUNCE_MS = 2000;

let started = false;

async function write() {
  if (!notchLink.connected) return;
  const now = Date.now();
  const [from, to] = agendaRange(now);
  try {
    await link.writeAgenda(JSON.stringify(buildAgenda(calendar.occurrences(from, to), now)));
  } catch {
    /* paling buruk Notch memakai agenda lama sampai tulis berikutnya */
  }
}

export function startAgendaShare(): () => void {
  if (started) return () => {};
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = $effect.root(() => {
    $effect(() => {
      if (!notchLink.connected) return;
      // Membaca acara dan sumber supaya efek ini berjalan lagi saat salah satunya berubah.
      void [JSON.stringify(calendar.events), calendar.sources.map((s) => `${s.id}${s.fetchedAt}${s.enabled}`).join()];
      clearTimeout(timer);
      timer = setTimeout(() => void write(), DEBOUNCE_MS);
    });
  });
  const interval = setInterval(() => void write(), EVERY_MS);
  return () => {
    stop();
    clearInterval(interval);
    clearTimeout(timer);
    started = false;
  };
}
