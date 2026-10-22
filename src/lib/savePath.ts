// Dialog "Simpan sebagai" untuk ekspor (mis. gambar papan). Di mode browser
// (pengembangan UI tanpa Tauri) path diketik manual.
import { isTauri } from "@tauri-apps/api/core";
import { dialog } from "$lib/stores/dialog.svelte";

export async function pickSavePath(defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (!isTauri()) {
    return (await dialog.prompt("Simpan ke (path lengkap):", `/tmp/${defaultName}`, { okLabel: "Simpan" }))?.trim() || null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath: defaultName, filters: [filter] })) ?? null;
}
