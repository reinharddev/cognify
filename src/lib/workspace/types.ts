// Tipe penyimpanan lokal (src-tauri/src/store). Harus sinkron dengan struct Serde di `store/pages.rs`.

export type PageKind = "doc" | "board" | "table" | "folder";

export interface PageNode {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  /** Urutan di antara saudara; hanya dipakai server, klien cukup memakai urutan yang diterima. */
  position: number;
  favorite: boolean;
  updatedAt: string;
}

export interface Page extends PageNode {
  /** JSON milik editor (blok dokumen, adegan papan, definisi tabel); string kosong = belum ada isi. */
  content: string;
  tags: string[];
  createdAt: string;
  trashedAt: string | null;
}

export interface TrashItem extends PageNode {
  trashedAt: string;
  /** Jumlah halaman lain yang ikut terbuang bersamanya. */
  descendants: number;
}

export interface SearchHit {
  id: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  snippet: string;
}

export interface NewPage {
  parentId?: string | null;
  kind: PageKind;
  title?: string;
  content?: string;
  plainText?: string;
}

/** Bidang yang tidak dikirim tidak berubah. `icon: ""` menghapus ikon. */
export interface PageUpdate {
  title?: string;
  icon?: string;
  content?: string;
  plainText?: string;
  favorite?: boolean;
  tags?: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}


export interface WhiteboardScene {
  type: "excalidraw";
  version: number;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Usulan halaman dari klien MCP (AI); baru jadi halaman setelah pengguna menyetujuinya. */
export interface Proposal {
  id: string;
  kind: "page";
  title: string;
  /** Isi dalam Markdown. */
  body: string;
  parentId: string | null;
  /** Nama klien MCP yang mengusulkan, mis. "claude-code". */
  source: string;
  status: "pending" | "approved" | "rejected";
  pageId: string | null;
  createdAt: string;
}

export interface McpInfo {
  /** Program yang dijalankan klien MCP dengan argumen --mcp. */
  command: string;
  /** Build pengembangan: datanya terpisah dari app terpasang. */
  dev: boolean;
}

/** Keadaan jembatan ekstensi browser. `code` hanya ada selama kode pemasangan berlaku. */
export interface BridgeStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  paired: boolean;
  error: string | null;
  code: string | null;
  codeExpiresIn: number | null;
}

/** Penunjuk satu sorotan: alamat bagiannya, judul bagian terdekat, nomor halaman PDF, dan tanggal akses. */
export interface SourceMark {
  url: string;
  section?: string;
  page?: number | null;
  accessed?: string;
}

/** Data sumber sebuah halaman web atau PDF yang disimpan dari ekstensi, bahan sitasi. `source` berbentuk CSL-JSON. */
export interface PageSource {
  source: Record<string, unknown>;
  marks: SourceMark[];
}
