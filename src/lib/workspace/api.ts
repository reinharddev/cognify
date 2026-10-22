// Klien penyimpanan lokal: memanggil perintah Tauri di src-tauri/src/store/commands.rs.
// Halaman dan komponen memakai `workspace`, tidak memanggil `invoke` langsung.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { ApiError } from "./errors";
import { mockCall } from "./mock";
import type { BridgeStatus, McpInfo, PageSource, NewPage, Page, PageNode, PageUpdate, Proposal, SearchHit, TagCount, TrashItem } from "./types";

const STATUS: Record<string, number> = { not_found: 404, invalid: 422, db_error: 500 };

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    // Di browser biasa (pratinjau tampilan) dipakai penyimpanan sementara; di aplikasi selalu yang asli.
    return isTauri() ? await invoke<T>(command, args) : ((await mockCall(command, args)) as T);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err && typeof err === "object" && typeof err.code === "string") {
      throw new ApiError(STATUS[err.code] ?? 500, err.code, err.message ?? "Terjadi kesalahan");
    }
    throw new ApiError(500, "unknown", typeof e === "string" ? e : "Terjadi kesalahan");
  }
}

export const workspace = {
  pages: {
    create: (page: NewPage) => call<Page>("page_create", { new: page }),
    get: (id: string) => call<Page>("page_get", { id }),
    /** Seluruh halaman aktif tanpa isi; susun jadi pohon dengan `buildTree`. */
    tree: () => call<PageNode[]>("page_tree"),
    update: (id: string, update: PageUpdate) => call<Page>("page_update", { id, update }),
    /** `parentId: null` = tingkat teratas; `beforeId` kosong = taruh paling akhir. */
    move: (id: string, parentId: string | null, beforeId: string | null = null) =>
      call<void>("page_move", { id, parentId, beforeId }),
    trash: (id: string) => call<{ count: number }>("page_trash", { id }),
    restore: (id: string) => call<{ count: number }>("page_restore", { id }),
    deleteForever: (id: string) => call<void>("page_delete_forever", { id }),
    search: (query: string, limit = 20) => call<SearchHit[]>("page_search", { query, limit }),
    /** Data sumber (CSL-JSON) dan penunjuk sorotan untuk sitasi; null bila halaman belum punya. */
    source: (id: string) => call<PageSource | null>("page_source_get", { id }),
    setSource: (id: string, source: Record<string, unknown>) => call<void>("page_source_set", { id, source }),
  },
  trash: {
    list: () => call<TrashItem[]>("trash_list"),
    empty: () => call<{ count: number }>("trash_empty"),
  },
  tags: {
    list: () => call<TagCount[]>("tag_list"),
    pages: (tag: string) => call<PageNode[]>("page_by_tag", { tag }),
  },
  proposals: {
    list: () => call<Proposal[]>("proposal_list"),
    approve: (id: string) => call<Page>("proposal_approve", { id }),
    reject: (id: string) => call<void>("proposal_reject", { id }),
  },
  mcp: {
    info: () => call<McpInfo>("mcp_info"),
  },
  /** Catatan melayang: jendela kecil selalu di atas; isinya halaman dokumen biasa. */
  sticky: {
    create: () => call<string>("sticky_new"),
    open: (id: string) => call<void>("sticky_open", { id }),
    close: (id: string) => call<void>("sticky_close", { id }),
    pin: (id: string, pinned: boolean) => call<void>("sticky_pin", { id, pinned }),
    openInMain: (id: string) => call<void>("sticky_open_in_main", { id }),
    shortcut: (enabled: boolean) => call<void>("sticky_shortcut", { enabled }),
  },
  /** Jembatan ke ekstensi browser (src-tauri/src/bridge.rs). */
  bridge: {
    status: () => call<BridgeStatus>("bridge_status"),
    setEnabled: (enabled: boolean) => call<BridgeStatus>("bridge_set_enabled", { enabled }),
    newCode: () => call<BridgeStatus>("bridge_new_code"),
    unpair: () => call<BridgeStatus>("bridge_unpair"),
    revealFolder: () => call<string>("reveal_extension_folder"),
  },
  settings: {
    get: (key: string) => call<string | null>("setting_get", { key }),
    set: (key: string, value: string) => call<void>("setting_set", { key, value })
  },
};
