// Penyimpanan otomatis yang tidak boleh kehilangan ketikan.
//  - Perubahan ditahan sebentar (delay), tetapi tidak lebih lama dari maxWait walau terus mengetik.
//  - Penyimpanan berjalan satu per satu: dua simpan yang tumpang tindih bisa tiba terbalik di sisi Rust
//    dan versi lama menimpa yang baru.
//  - Bila gagal, isinya dikembalikan ke antrean dan dicoba lagi sampai berhasil.
//  - Disimpan segera saat jendela kehilangan fokus, disembunyikan, atau ditutup.

export type SaveState = "saved" | "saving" | "error";

export interface Autosave<P> {
  /** Tambahkan perubahan; bidang yang sama ditimpa yang terbaru. */
  push(patch: P): void;
  /** Simpan sekarang; selesai setelah semua yang antre benar-benar tersimpan (atau gagal). */
  flush(): Promise<void>;
  /** Buang antrean yang belum terkirim (misalnya halaman dihapus). */
  cancel(): void;
  /** Ada perubahan yang belum selesai tersimpan. */
  dirty(): boolean;
  dispose(): void;
}

const live = new Set<() => Promise<void>>();
let hooked = false;

function hook() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  const all = () => void Promise.all([...live].map((f) => f()));
  window.addEventListener("blur", all);
  window.addEventListener("pagehide", all);
  window.addEventListener("beforeunload", all);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && all());
}

export function createAutosave<P extends object>(
  save: (patch: P) => Promise<void>,
  onState: (state: SaveState) => void,
  { delay = 400, maxWait = 2000, retry = 2000 } = {},
): Autosave<P> {
  let pending: P | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let firstAt = 0;
  let chain: Promise<void> = Promise.resolve();
  let inflight = 0;

  function flush(): Promise<void> {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    timer = undefined;
    firstAt = 0;
    if (!pending) return chain;
    const patch = pending;
    pending = null;
    inflight++;
    onState("saving");
    chain = chain.then(async () => {
      try {
        await save(patch);
        inflight--;
        if (!pending && !inflight) onState("saved");
      } catch {
        inflight--;
        // Yang lebih baru (sudah diketik selama menyimpan) tetap menang atas yang gagal.
        pending = { ...patch, ...(pending ?? {}) };
        onState("error");
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void flush(), retry);
      }
    });
    return chain;
  }

  live.add(flush);
  hook();

  return {
    push(patch) {
      pending = { ...(pending ?? {}), ...patch } as P;
      onState("saving");
      if (!firstAt) firstAt = Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), Math.max(0, Math.min(delay, maxWait - (Date.now() - firstAt))));
    },
    flush,
    dirty: () => pending !== null || inflight > 0,
    cancel() {
      pending = null;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      firstAt = 0;
    },
    dispose() {
      void flush();
      live.delete(flush);
    },
  };
}
