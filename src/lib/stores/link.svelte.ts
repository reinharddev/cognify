// Status hubungan ke Cognify Notch dan data terakhirnya, dipakai halaman Notch dan Beranda.

import { link } from "$lib/link/api";
import type { LinkStatus, NotchData } from "$lib/link/types";

/** Notch dianggap berjalan bila datanya diperbarui kurang dari ini (ia menyegarkan tiap 60 detik). */
const ALIVE_MS = 3 * 60_000;

class LinkStore {
  status = $state<LinkStatus | null>(null);
  data = $state<NotchData | null>(null);
  error = $state<string | null>(null);
  now = $state(Date.now());
  loaded = $state(false);

  connected = $derived(this.status?.connected ?? false);
  online = $derived(
    !!this.status?.lastUpdate && this.now - Date.parse(this.status.lastUpdate) < ALIVE_MS,
  );

  #started = false;

  async init() {
    if (this.#started) return;
    this.#started = true;
    await this.refresh();
    this.loaded = true;
    await link.onChanged(() => void this.refresh());
    setInterval(() => (this.now = Date.now()), 30_000);
  }

  async refresh() {
    try {
      this.status = await link.status();
      this.data = this.status.connected ? await link.data() : null;
      this.error = null;
    } catch (e) {
      this.error = typeof e === "string" ? e : e instanceof Error ? e.message : "Data Notch tidak bisa dibaca.";
    }
  }

  async connect(shareClipboard = false) {
    this.status = await link.connect(shareClipboard);
    await this.refresh();
  }

  async disconnect() {
    this.status = await link.disconnect();
    this.data = null;
  }

  async setShareClipboard(on: boolean) {
    this.status = await link.setShareClipboard(on);
    await this.refresh();
  }
}

export const notchLink = new LinkStore();
