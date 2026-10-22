import { dateLocale, tr } from "$lib/i18n.svelte";
// Pemformat teks untuk data Notch (bahasa Indonesia, tanpa pustaka).

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return tr("belum ada", "none yet");
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return tr("belum ada", "none yet");
  if (s < 45) return tr("baru saja", "just now");
  if (s < 3600) return tr(`${Math.round(s / 60)} menit lalu`, `${Math.round(s / 60)} min ago`);
  if (s < 86_400) return tr(`${Math.round(s / 3600)} jam lalu`, `${Math.round(s / 3600)} h ago`);
  return tr(`${Math.round(s / 86_400)} hari lalu`, `${Math.round(s / 86_400)} d ago`);
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }).replace(":", dateLocale() === "id-ID" ? "." : ":");

export function dueLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const diff = Date.parse(iso) - now;
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) return hours >= 0 ? (hours < 1 ? tr("kurang dari 1 jam lagi", "in under 1 hour") : tr(`${hours} jam lagi`, `in ${hours} h`)) : tr(`${-hours} jam lalu`, `${-hours} h ago`);
  const days = Math.round(diff / 86_400_000);
  return days >= 0 ? (days === 1 ? tr("besok", "tomorrow") : tr(`${days} hari lagi`, `in ${days} d`)) : tr(`${-days} hari lalu`, `${-days} d ago`);
}

export function countdown(endsAt: string | null, now = Date.now()): string {
  if (!endsAt) return "";
  const s = Math.round((Date.parse(endsAt) - now) / 1000);
  if (s <= 0) return tr("selesai", "done");
  const m = Math.floor(s / 60);
  return m >= 1 ? tr(`${m} menit lagi`, `${m} min left`) : tr(`${s} detik lagi`, `${s} s left`);
}
