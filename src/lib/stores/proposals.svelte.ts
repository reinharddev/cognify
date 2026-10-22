// Usulan dari AI (lewat MCP) yang menunggu persetujuan. Server MCP berjalan di proses lain dan menulis
// ke database yang sama, jadi daftar ini disegarkan berkala dan saat jendela kembali aktif.

import { workspace } from "$lib/workspace/api";
import type { Page, Proposal } from "$lib/workspace/types";

const POLL_MS = 5000;

class ProposalStore {
  items = $state<Proposal[]>([]);
  error = $state<string | null>(null);
  count = $derived(this.items.length);

  async refresh() {
    try {
      this.items = await workspace.proposals.list();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Usulan tidak bisa dimuat.";
    }
  }

  /** Mulai menyegarkan berkala; mengembalikan fungsi untuk menghentikannya. */
  start(): () => void {
    void this.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, POLL_MS);
    const onFocus = () => void this.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }

  async approve(id: string): Promise<Page> {
    const page = await workspace.proposals.approve(id);
    await this.refresh();
    return page;
  }

  async reject(id: string) {
    await workspace.proposals.reject(id);
    await this.refresh();
  }
}

export const proposals = new ProposalStore();
