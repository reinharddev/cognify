// Menyusun daftar datar halaman (urutan dari penyimpanan: per induk, lalu posisi) menjadi pohon.

import type { PageNode } from "./types";

export interface TreeNode extends PageNode {
  children: TreeNode[];
}

export function buildTree(nodes: PageNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [] });
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const node = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    // Induk yang tidak ada di daftar (mis. di sampah) menjadikan halaman ini tingkat teratas.
    (parent ?? { children: roots }).children.push(node);
  }
  return roots;
}

/** Rantai dari tingkat teratas sampai halaman `id` (untuk jejak "Ruang / Biologi / Sel"). */
export function ancestors(nodes: PageNode[], id: string): PageNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: PageNode[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    chain.unshift(cur);
  }
  return chain;
}

/** Semua halaman dalam urutan tampil, hanya turunan dari simpul yang terbuka. */
export function visibleRows(roots: TreeNode[], expanded: ReadonlySet<string>): { node: TreeNode; depth: number }[] {
  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth });
      if (expanded.has(node.id)) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

export type DropZone = "before" | "after" | "inside";

/**
 * Rencana pemindahan saat halaman `dragId` dilepas di `zone` pada halaman `targetId`: induk baru dan
 * halaman saudara yang menjadi acuan (`beforeId`; null = di akhir). Null bila tidak ada yang berubah
 * atau pemindahan tidak sah (ke dirinya sendiri atau ke dalam turunannya). `nodes` berurutan per induk.
 */
export function planMove(nodes: PageNode[], dragId: string, targetId: string, zone: DropZone): { parentId: string | null; beforeId: string | null } | null {
  if (dragId === targetId) return null;
  const drag = nodes.find((n) => n.id === dragId);
  const target = nodes.find((n) => n.id === targetId);
  if (!drag || !target) return null;
  if (ancestors(nodes, targetId).some((n) => n.id === dragId)) return null; // target ada di dalam yang diseret

  const parentId = zone === "inside" ? target.id : target.parentId;
  const siblings = nodes.filter((n) => n.parentId === parentId && n.id !== dragId);
  let at: number;
  if (zone === "inside") at = siblings.length;
  else {
    const i = siblings.findIndex((n) => n.id === target.id);
    if (i < 0) return null;
    at = zone === "before" ? i : i + 1;
  }
  if (drag.parentId === parentId) {
    const before = nodes.filter((n) => n.parentId === parentId).findIndex((n) => n.id === dragId);
    if (before === at) return null;
  }
  return { parentId, beforeId: siblings[at]?.id ?? null };
}
