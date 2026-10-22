// Status ruang kerja untuk seluruh UI: daftar halaman (untuk sidebar) dan aksi dasarnya.

import { workspace } from "$lib/workspace/api";
import { buildTree, planMove, type DropZone } from "$lib/workspace/tree";
import type { NewPage, Page, PageKind, PageNode, TagCount } from "$lib/workspace/types";

const EXPANDED_KEY = "cognify.sidebar.expanded";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

class WorkspaceStore {
  nodes = $state<PageNode[]>([]);
  tags = $state<TagCount[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  expanded = $state<Set<string>>(loadExpanded());

  tree = $derived(buildTree(this.nodes));
  favorites = $derived(this.nodes.filter((n) => n.favorite));
  recent = $derived([...this.nodes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6));

  async init() {
    try {
      this.nodes = await workspace.pages.tree();
      this.error = null;
      await this.refreshTags();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Penyimpanan tidak bisa dibuka.";
    } finally {
      this.loaded = true;
    }
  }

  async refreshTags() {
    try {
      this.tags = await workspace.tags.list();
    } catch {
      /* daftar tag hanya pelengkap */
    }
  }

  async refresh() {
    this.nodes = await workspace.pages.tree();
  }

  toggle(id: string, open?: boolean) {
    const next = new Set(this.expanded);
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    this.expanded = next;
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* hanya kenyamanan */
    }
  }

  async create(kind: PageKind, parentId: string | null = null, init: Partial<NewPage> = {}): Promise<Page> {
    const page = await workspace.pages.create({ kind, parentId, ...init });
    if (parentId) this.toggle(parentId, true);
    await this.refresh();
    return page;
  }

  /** Halaman yang sedang diseret di sidebar, dan sasaran yang disorot. */
  drag = $state<{ id: string; over: { id: string; zone: DropZone } | null } | null>(null);

  /** Pindahkan `id` ke `zone` pada `targetId`; mengembalikan false bila tidak ada yang berubah. */
  async dropOn(id: string, targetId: string, zone: DropZone): Promise<boolean> {
    const plan = planMove(this.nodes, id, targetId, zone);
    if (!plan) return false;
    await workspace.pages.move(id, plan.parentId, plan.beforeId);
    if (plan.parentId) this.toggle(plan.parentId, true);
    await this.refresh();
    return true;
  }

  async trash(id: string) {
    await workspace.pages.trash(id);
    await this.refresh();
  }

  async setFavorite(id: string, favorite: boolean) {
    await workspace.pages.update(id, { favorite });
    this.nodes = this.nodes.map((n) => (n.id === id ? { ...n, favorite } : n));
  }

  /** Perbarui satu simpul di sidebar tanpa mengambil ulang seluruh pohon (mis. saat judul diketik). */
  patch(id: string, patch: Partial<PageNode>) {
    this.nodes = this.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
  }
}

export const ws = new WorkspaceStore();
