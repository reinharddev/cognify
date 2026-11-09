import { tr } from "$lib/i18n.svelte";
import type { CalcSettings, Status } from "./stats";

export const statusLabel = (s: Status): string =>
  ({ strong: tr("Kuat", "Strong"), ok: tr("Aman", "Steady"), improve: tr("Perlu ditingkatkan", "Needs work"), risk: tr("Di bawah batas", "Below the mark"), nodata: tr("Belum ada nilai", "No scores yet") })[s];

export const statusHint = (s: Status): string =>
  ({
    strong: tr("Nilai berbobot mencapai target dan tidak sedang turun.", "Weighted average reached the target and is not falling."),
    ok: tr("Di atas batas lulus dengan jarak aman.", "Above the pass mark with a safe margin."),
    improve: tr("Mendekati batas lulus atau nilai terbaru turun 5 poin atau lebih.", "Close to the pass mark, or recent scores dropped 5 points or more."),
    risk: tr("Nilai berbobot di bawah batas lulus.", "Weighted average is below the pass mark."),
    nodata: tr("Belum ada tugas yang dinilai.", "Nothing has been graded yet."),
  })[s];

/** Warna nilai: good di atas target, mid di atas batas lulus, low di bawahnya. */
export const tone = (n: number | null, c: CalcSettings): "good" | "mid" | "low" | "none" =>
  n === null ? "none" : n >= c.target ? "good" : n >= c.passMark ? "mid" : "low";

export const statusTone = (s: Status): "good" | "mid" | "low" | "none" => (s === "strong" ? "good" : s === "ok" ? "mid" : s === "nodata" ? "none" : "low");

export const signed = (n: number | null): string => (n === null ? "-" : n > 0 ? `+${n}` : String(n));

/** Tren dalam kata: naik, turun, atau stabil (selisih kurang dari 3 poin). */
export const trendText = (n: number | null): string =>
  n === null ? "" : n >= 3 ? tr(`naik ${n} poin`, `up ${n} points`) : n <= -3 ? tr(`turun ${Math.abs(n)} poin`, `down ${Math.abs(n)} points`) : tr("stabil", "steady");
