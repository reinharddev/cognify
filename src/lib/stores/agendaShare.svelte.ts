// Membagikan agenda kalender Cognify ke Notch (Windows memakainya sebagai sumber kalender) selagi
// terhubung: ditulis ulang saat acara atau langganan berubah (tunda 2 detik), tiap 5 menit, dan saat
// hubungan baru tersambung. Tidak menulis apa pun bila tidak terhubung.

import { buildAgenda, agendaRange, taskRange } from "$lib/link/agenda";
import { buildHub, todayRange } from "$lib/link/hub";
import { tools } from "$lib/tools/registry";
import { loc } from "$lib/i18n.svelte";
import { ws } from "./workspace.svelte";
import { link } from "$lib/link/api";
import { calendar } from "./calendar.svelte";
import { notchLink } from "./link.svelte";
import { moodle } from "./moodle.svelte";
import { prefs } from "./prefs.svelte";
import { school } from "./school.svelte";

const EVERY_MS = 5 * 60_000;
const DEBOUNCE_MS = 2000;

let started = false;

async function write() {
  if (!notchLink.connected) return;
  const now = Date.now();
  const [from, to] = agendaRange(now);
  try {
    const occ = calendar.occurrences(from, to);
    // Tugas Moodle dibagikan dengan rentang lebih lebar supaya tampil di To-do notch, termasuk yang terlambat.
    const seen = new Set(occ.map((o) => o.key));
    const [tFrom, tTo] = taskRange(now);
    for (const o of calendar.occurrences(tFrom, tTo)) if (o.origin === "moodle" && !seen.has(o.key)) occ.push(o);
    await link.writeAgenda(JSON.stringify(buildAgenda(occ, now)));
    const [dFrom, dTo] = todayRange(now);
    await link.writeHub(
      JSON.stringify(
        buildHub({
          now,
          occurrences: calendar.occurrences(dFrom, dTo),
          favorites: ws.favorites,
          recent: ws.recent,
          tools: tools.filter((t) => t.status === "ready").map((t) => ({ id: t.id, name: loc(t.name) })),
        }),
      ),
    );
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
      void [JSON.stringify(calendar.events), calendar.sources.map((s) => `${s.id}${s.fetchedAt}${s.enabled}`).join(), moodle.active, moodle.remindMin, moodle.items.map((i) => `${i.id}${i.due}${i.submitted}`).join(), school.activeLessons.map((l) => `${l.key}${l.end}${l.subject}`).join(), school.exams.map((e) => `${e.id}${e.at}`).join(), school.activeClass, ws.nodes.map((n) => `${n.id}${n.title}${n.favorite}${n.updatedAt}`).join(), school.schedulePeriod, prefs.value.lessonReminders, prefs.value.showLessons];
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
