// Pembaruan Cognify: cek, unduh, pasang. Inti ada di src-tauri/src/updater.rs (Velopack di Windows, DMG bertanda tangan di Mac).
// Satu-satunya permintaan keluar adalah daftar rilis dan berkas rilis di GitHub, dan hanya bila pemeriksaan dinyalakan.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tr } from "$lib/i18n.svelte";

export type UpdateStage = "idle" | "checking" | "found" | "downloading" | "ready" | "installing" | "error";

interface Found {
  version: string;
  notes: string;
  url: string;
  size: number;
  selfUpdate: boolean;
}

const KEY_CHECK = "cognify.update.check";
const KEY_AUTO = "cognify.update.auto";
const KEY_DISMISSED = "cognify.update.dismissed";
const KEY_LAST = "cognify.update.last";

const read = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* tanpa penyimpanan, pilihan hanya berlaku sesi ini */
  }
};

/** Ukuran berkas yang mudah dibaca: 21,4 MB. */
export function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

class UpdateStore {
  stage = $state<UpdateStage>("idle");
  version = $state("");
  notes = $state("");
  url = $state("");
  size = $state(0);
  received = $state(0);
  selfUpdate = $state(false);
  error = $state("");
  /** Status singkat untuk Pengaturan, mis. "Sudah versi terbaru." */
  text = $state("");
  lastChecked = $state(read(KEY_LAST, ""));
  /** Pemeriksaan otomatis (bawaan nyala). */
  checkOn = $state(read(KEY_CHECK, "1") !== "0");
  /** Unduh otomatis dan pasang saat Cognify ditutup (bawaan nyala). */
  autoOn = $state(read(KEY_AUTO, "1") !== "0");
  /** Versi yang kartunya sudah ditutup pengguna (tidak muncul lagi untuk versi itu). */
  dismissed = $state(read(KEY_DISMISSED, ""));
  current = $state("");
  /** Kartu "siap" ditutup pengguna untuk sesi ini; pembaruan tetap terpasang saat Cognify ditutup. */
  hideReady = $state(false);

  get percent(): number {
    return this.size > 0 ? Math.min(100, Math.round((this.received / this.size) * 100)) : 0;
  }
  /** Kartu tampil saat ada yang perlu dilihat pengguna. */
  get cardVisible(): boolean {
    if (this.stage === "ready") return !this.hideReady;
    if (this.stage === "downloading" || this.stage === "installing") return true;
    if (this.stage === "found") return this.dismissed !== this.version;
    return false;
  }

  setCheck(on: boolean) {
    this.checkOn = on;
    write(KEY_CHECK, on ? "1" : "0");
  }
  setAuto(on: boolean) {
    this.autoOn = on;
    write(KEY_AUTO, on ? "1" : "0");
  }
  dismiss() {
    this.dismissed = this.version;
    write(KEY_DISMISSED, this.version);
  }

  /** `manual` = tombol "Cek pembaruan": hasilnya selalu ditampilkan, termasuk "sudah terbaru". */
  async check(manual = false) {
    if (!isTauri() || ["checking", "downloading", "installing"].includes(this.stage)) return;
    if (this.stage === "ready") return;
    const before = this.stage;
    this.stage = "checking";
    this.error = "";
    if (manual) this.text = tr("Memeriksa…", "Checking…");
    try {
      const found = await invoke<Found | null>("update_check");
      this.lastChecked = new Date().toISOString();
      write(KEY_LAST, this.lastChecked);
      if (found) {
        this.version = found.version;
        this.notes = found.notes;
        this.url = found.url;
        this.size = found.size;
        this.received = 0;
        this.selfUpdate = found.selfUpdate;
        this.stage = "found";
        this.text = tr(`Versi ${found.version} tersedia.`, `Version ${found.version} is available.`);
        if (manual) {
          this.dismissed = "";
          write(KEY_DISMISSED, "");
        }
        if (found.selfUpdate && this.autoOn) void this.download(true);
      } else {
        this.stage = "idle";
        this.text = manual ? tr("Sudah versi terbaru.", "You are up to date.") : "";
      }
    } catch (e) {
      this.stage = before === "found" ? "found" : "idle";
      if (manual) this.text = tr("Tidak bisa memeriksa sekarang.", "Can't check right now.");
      console.warn("update check failed", e);
    }
  }

  /** Mengunduh; bila `auto`, lanjut dijadwalkan terpasang saat Cognify ditutup. */
  async download(auto = false) {
    if (!isTauri() || this.stage === "downloading") return;
    this.stage = "downloading";
    this.received = 0;
    this.error = "";
    this.text = tr(`Mengunduh versi ${this.version}…`, `Downloading version ${this.version}…`);
    try {
      await invoke("update_download");
      this.stage = "ready";
      this.text = tr(`Versi ${this.version} siap dipasang.`, `Version ${this.version} is ready to install.`);
      if (auto) await invoke("update_apply", { onExit: true });
    } catch (e) {
      this.stage = "found";
      this.error = String(e);
      this.text = tr("Gagal mengunduh pembaruan: ", "Couldn't download the update: ") + this.error;
    }
  }

  /** Pasang sekarang dan mulai ulang. Tidak kembali bila berhasil. */
  async installNow() {
    if (!isTauri()) return;
    if (this.stage !== "ready") {
      await this.download(false);
      if ((this.stage as UpdateStage) !== "ready") return;
    }
    this.stage = "installing";
    this.text = tr("Memasang dan memulai ulang…", "Installing and restarting…");
    try {
      await invoke("update_apply", { onExit: false });
    } catch (e) {
      this.stage = "ready";
      this.error = String(e);
      this.text = tr("Gagal memasang pembaruan: ", "Couldn't install the update: ") + this.error;
    }
  }

  /** Dipanggil sekali dari tata letak utama: versi sekarang, pendengar kemajuan, dan pemeriksaan terjadwal. */
  start(): () => void {
    if (!isTauri()) return () => {};
    void (async () => {
      this.current = (await (await import("@tauri-apps/api/app")).getVersion()) ?? "";
      this.selfUpdate = !!(await invoke<boolean>("update_supported").catch(() => false));
    })();
    const un = listen<{ received: number; total: number }>("update-progress", (e) => {
      this.received = e.payload.received;
      if (e.payload.total) this.size = e.payload.total;
    });
    const run = () => {
      if (this.checkOn) void this.check(false);
    };
    const first = setTimeout(run, 30_000);
    const daily = setInterval(run, 24 * 3600_000);
    return () => {
      clearTimeout(first);
      clearInterval(daily);
      void un.then((off) => off());
    };
  }
}

export const update = new UpdateStore();
