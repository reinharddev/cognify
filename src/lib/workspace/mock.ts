// Pengganti penyimpanan Rust hanya untuk pratinjau di browser biasa (`npm run dev` tanpa Tauri),
// supaya tampilan bisa dicoba tanpa membuka aplikasi. Perilakunya disederhanakan dan datanya
// disimpan di localStorage; logika sebenarnya (dan semua tesnya) ada di src-tauri/src/store.

import type { Page, PageNode, SearchHit, TrashItem } from "./types";

type Row = Page;
const KEY = "cognify.preview.workspace";

function load(): { rows: Row[]; settings: Record<string, string>; proposals?: any[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* pratinjau saja */
  }
  return { rows: [], settings: {} };
}

let state = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* pratinjau saja */
  }
};

const now = () => new Date().toISOString();
const node = (r: Row): PageNode => ({
  id: r.id, parentId: r.parentId, kind: r.kind, title: r.title, icon: r.icon,
  position: r.position, favorite: r.favorite, updatedAt: r.updatedAt,
});
const find = (id: string) => {
  const r = state.rows.find((x) => x.id === id);
  if (!r) throw { code: "not_found", message: `Halaman tidak ditemukan: ${id}` };
  return r;
};
const kids = (id: string | null) =>
  state.rows.filter((r) => r.parentId === id && !r.trashedAt).sort((a, b) => a.position - b.position);
const subtree = (id: string): Row[] => [find(id), ...state.rows.filter((r) => r.parentId === id).flatMap((r) => subtree(r.id))];

const mockSources = new Map<string, { source: unknown; marks: unknown[] }>();
const bridge: { enabled: boolean; paired: boolean; code: string | null } = { enabled: false, paired: false, code: null };

export async function mockCall(command: string, a: Record<string, any> = {}): Promise<any> {
  switch (command) {
    case "page_create": {
      const n = a.new;
      const row: Row = {
        id: crypto.randomUUID(), parentId: n.parentId ?? null, kind: n.kind, title: (n.title ?? "").trim(), icon: null,
        position: Math.max(0, ...kids(n.parentId ?? null).map((k) => k.position)) + 1, favorite: false,
        updatedAt: now(), content: n.content ?? "", tags: [], createdAt: now(), trashedAt: null,
      };
      (row as any).plainText = n.plainText ?? "";
      state.rows.push(row);
      save();
      return structuredClone(row);
    }
    case "page_get":
      return structuredClone(find(a.id));
    case "page_tree":
      return state.rows.filter((r) => !r.trashedAt).sort((x, y) => (x.parentId ?? "").localeCompare(y.parentId ?? "") || x.position - y.position).map(node);
    case "page_update": {
      const r = find(a.id), u = a.update;
      if (u.title !== undefined) r.title = u.title.trim();
      if (u.icon !== undefined) r.icon = u.icon.trim() || null;
      if (u.content !== undefined) r.content = u.content;
      if (u.plainText !== undefined) (r as any).plainText = u.plainText;
      if (u.favorite !== undefined) r.favorite = u.favorite;
      if (u.tags !== undefined) r.tags = [...new Set<string>(u.tags.map((t: string) => t.trim()).filter(Boolean))];
      r.updatedAt = now();
      save();
      return structuredClone(r);
    }
    case "page_move": {
      const r = find(a.id);
      if (a.parentId && subtree(r.id).some((x) => x.id === a.parentId)) throw { code: "invalid", message: "Halaman tidak bisa dipindahkan ke dalam dirinya sendiri." };
      const sib = kids(a.parentId ?? null).filter((x) => x.id !== r.id);
      const at = a.beforeId ? sib.findIndex((x) => x.id === a.beforeId) : sib.length;
      sib.splice(at < 0 ? sib.length : at, 0, r);
      r.parentId = a.parentId ?? null;
      sib.forEach((x, i) => (x.position = i + 1));
      save();
      return null;
    }
    case "page_trash": {
      const ts = now();
      const list = subtree(a.id).filter((x) => !x.trashedAt);
      list.forEach((x) => (x.trashedAt = ts));
      save();
      return { count: list.length };
    }
    case "page_restore": {
      const r = find(a.id);
      const ts = r.trashedAt;
      const list = subtree(a.id).filter((x) => x.trashedAt === ts);
      if (r.parentId && find(r.parentId).trashedAt) r.parentId = null;
      list.forEach((x) => (x.trashedAt = null));
      save();
      return { count: list.length };
    }
    case "page_delete_forever": {
      const ids = new Set(subtree(a.id).map((x) => x.id));
      state.rows = state.rows.filter((x) => !ids.has(x.id));
      save();
      return null;
    }
    case "trash_list":
      return state.rows
        .filter((r) => r.trashedAt && (!r.parentId || find(r.parentId).trashedAt !== r.trashedAt))
        .map((r): TrashItem => ({ ...node(r), trashedAt: r.trashedAt!, descendants: subtree(r.id).length - 1 }));
    case "trash_empty": {
      const n = state.rows.filter((r) => r.trashedAt).length;
      state.rows = state.rows.filter((r) => !r.trashedAt);
      save();
      return { count: n };
    }
    case "page_search": {
      const words = String(a.query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (!words.length) return [];
      return state.rows
        .filter((r) => !r.trashedAt)
        .filter((r) => words.every((w) => `${r.title} ${(r as any).plainText ?? ""}`.toLowerCase().includes(w)))
        .slice(0, a.limit ?? 20)
        .map((r): SearchHit => ({ id: r.id, kind: r.kind, title: r.title, icon: r.icon, snippet: String((r as any).plainText ?? "").slice(0, 80) }));
    }
    case "tag_list": {
      const counts = new Map<string, { tag: string; count: number }>();
      for (const r of state.rows.filter((x) => !x.trashedAt))
        for (const t of r.tags) {
          const k = t.toLowerCase();
          counts.set(k, { tag: counts.get(k)?.tag ?? t, count: (counts.get(k)?.count ?? 0) + 1 });
        }
      return [...counts.values()].sort((x, y) => x.tag.localeCompare(y.tag));
    }
    case "page_by_tag": {
      const t = String(a.tag).trim().toLowerCase();
      if (!t) return [];
      return state.rows.filter((r) => !r.trashedAt && r.tags.some((x) => x.toLowerCase() === t)).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).map(node);
    }
    case "proposal_list":
      return (state.proposals ?? []).filter((p) => p.status === "pending");
    case "proposal_approve": {
      const p = (state.proposals ?? []).find((x) => x.id === a.id && x.status === "pending");
      if (!p) throw { code: "invalid", message: "Usulan ini sudah diputuskan." };
      p.status = "approved";
      const page = await mockCall("page_create", { new: { kind: "doc", title: p.title, plainText: p.body } });
      p.pageId = page.id;
      save();
      return page;
    }
    case "proposal_reject": {
      const p = (state.proposals ?? []).find((x) => x.id === a.id && x.status === "pending");
      if (!p) throw { code: "invalid", message: "Usulan ini sudah diputuskan." };
      p.status = "rejected";
      save();
      return null;
    }
    case "sticky_new": {
      const page = await mockCall("page_create", { new: { kind: "doc", title: "" } });
      return page.id;
    }
    case "sticky_open":
    case "sticky_close":
    case "sticky_pin":
    case "sticky_open_in_main":
    case "sticky_shortcut":
      return null;
    case "page_source_get":
      return mockSources.get(a.id) ?? null;
    case "page_source_set":
      mockSources.set(a.id, { source: a.source, marks: mockSources.get(a.id)?.marks ?? [] });
      return null;
    case "bridge_status":
    case "bridge_set_enabled":
    case "bridge_new_code":
    case "bridge_unpair": {
      if (command === "bridge_set_enabled") bridge.enabled = !!a.enabled;
      if (command === "bridge_new_code") bridge.code = String(Math.floor(100000 + Math.random() * 900000));
      if (command === "bridge_unpair") bridge.paired = false;
      return { enabled: bridge.enabled, running: bridge.enabled, port: 47615, paired: bridge.paired, error: null, code: bridge.code, codeExpiresIn: bridge.code ? 300 : null };
    }
    case "reveal_extension_folder":
      return "/extension";
    case "mcp_info":
      return { command: "/Applications/Cognify.app/Contents/MacOS/cognify", dev: false };
    case "setting_get":
      return state.settings[a.key] ?? null;
    case "setting_set":
      state.settings[a.key] = a.value;
      save();
      return null;
    default:
      throw { code: "invalid", message: `Perintah pratinjau tidak dikenal: ${command}` };
  }
}
