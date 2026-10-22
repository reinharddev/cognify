// Pemformat teks untuk data Notch (bahasa Indonesia, tanpa pustaka).

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "belum ada";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "belum ada";
  if (s < 45) return "baru saja";
  if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
  if (s < 86_400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86_400)} hari lalu`;
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", ".");

export function dueLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const diff = Date.parse(iso) - now;
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) return hours >= 0 ? (hours < 1 ? "kurang dari 1 jam lagi" : `${hours} jam lagi`) : `${-hours} jam lalu`;
  const days = Math.round(diff / 86_400_000);
  return days >= 0 ? (days === 1 ? "besok" : `${days} hari lagi`) : `${-days} hari lalu`;
}

export function countdown(endsAt: string | null, now = Date.now()): string {
  if (!endsAt) return "";
  const s = Math.round((Date.parse(endsAt) - now) / 1000);
  if (s <= 0) return "selesai";
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m} menit lagi` : `${s} detik lagi`;
}
