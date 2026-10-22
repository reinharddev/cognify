import { tr } from "$lib/i18n.svelte";
// Dialog "Simpan sebagai" untuk ekspor (mis. gambar papan). Di mode browser
// (pengembangan UI tanpa Tauri) path diketik manual.
import { isTauri } from "@tauri-apps/api/core";
import { dialog } from "$lib/stores/dialog.svelte";

export async function pickSavePath(defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (!isTauri()) {
    return (await dialog.prompt(tr("Simpan ke (path lengkap):", "Save to (full path):"), `/tmp/${defaultName}`, { okLabel: tr("Simpan", "Save") }))?.trim() || null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath: defaultName, filters: [filter] })) ?? null;
}
