// Daftar font untuk editor dan font milik pengguna. Font sendiri bisa berupa nama font yang sudah
// terpasang di komputer, atau berkas font (.ttf .otf .woff .woff2) yang disimpan di IndexedDB lokal
// dan dimuat lewat FontFace. Tidak ada permintaan jaringan.

export interface FontChoice {
  value: string;
  label: string;
  group: string;
}

const q = (name: string) => `'${name.replace(/'/g, "")}'`;

const BUILTIN: { group: string; fonts: [string, string][] }[] = [
  {
    group: "Sans",
    fonts: [
      ["Arial", "Arial, Helvetica, sans-serif"],
      ["Helvetica", "Helvetica, Arial, sans-serif"],
      ["Verdana", "Verdana, Geneva, sans-serif"],
      ["Tahoma", "Tahoma, Geneva, sans-serif"],
      ["Trebuchet MS", "'Trebuchet MS', sans-serif"],
      ["Calibri", "Calibri, Carlito, sans-serif"],
      ["Segoe UI", "'Segoe UI', system-ui, sans-serif"],
      ["Avenir", "Avenir, 'Avenir Next', sans-serif"],
      ["Gill Sans", "'Gill Sans', 'Gill Sans MT', sans-serif"],
      ["Futura", "Futura, 'Trebuchet MS', sans-serif"],
      ["Optima", "Optima, Candara, sans-serif"],
      ["Impact", "Impact, 'Arial Narrow Bold', sans-serif"],
    ],
  },
  {
    group: "Serif",
    fonts: [
      ["Georgia", "Georgia, serif"],
      ["Times New Roman", "'Times New Roman', Times, serif"],
      ["Garamond", "Garamond, 'EB Garamond', serif"],
      ["Palatino", "Palatino, 'Palatino Linotype', 'Book Antiqua', serif"],
      ["Baskerville", "Baskerville, 'Baskerville Old Face', serif"],
      ["Cambria", "Cambria, Caladea, serif"],
      ["Didot", "Didot, 'Bodoni MT', serif"],
      ["Rockwell", "Rockwell, 'Courier New', serif"],
    ],
  },
  {
    group: "Mono",
    fonts: [
      ["Courier New", "'Courier New', Courier, monospace"],
      ["Menlo", "Menlo, Monaco, Consolas, monospace"],
      ["Consolas", "Consolas, 'Liberation Mono', monospace"],
    ],
  },
  {
    group: "Tulisan tangan",
    fonts: [
      ["Comic Sans", "'Comic Sans MS', 'Chalkboard SE', cursive"],
      ["Bradley Hand", "'Bradley Hand', 'Segoe Print', cursive"],
      ["Marker Felt", "'Marker Felt', 'Comic Sans MS', fantasy"],
      ["Brush Script", "'Brush Script MT', 'Brush Script Std', cursive"],
    ],
  },
];

export const BUILTIN_FONTS: FontChoice[] = [
  { value: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", label: "Sans (sistem)", group: "Sistem" },
  { value: "ui-serif, Georgia, 'Times New Roman', serif", label: "Serif (sistem)", group: "Sistem" },
  { value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", label: "Mono (sistem)", group: "Sistem" },
  ...BUILTIN.flatMap((g) => g.fonts.map(([label, value]) => ({ value, label, group: g.group }))),
];

interface Stored {
  name: string;
  /** Berkas font; tidak ada berarti nama font yang sudah terpasang di komputer. */
  data?: ArrayBuffer;
}

const DB = "cognify-fonts";
const STORE = "fonts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(): Promise<Stored[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Stored[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function put(item: Stored) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeCustomFont(name: string) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function register(item: Stored) {
  if (!item.data) return;
  const face = new FontFace(item.name, item.data);
  await face.load();
  document.fonts.add(face);
}

/** Muat semua font milik pengguna dan kembalikan sebagai pilihan. */
export async function loadCustomFonts(): Promise<FontChoice[]> {
  const items = await all();
  for (const it of items) {
    try {
      await register(it);
    } catch {
      /* berkas rusak: tetap dicantumkan supaya bisa dihapus */
    }
  }
  return items.map((it) => ({ value: `${q(it.name)}, sans-serif`, label: it.name, group: "Font saya" }));
}

/** Tambah font dengan nama yang sudah terpasang di komputer. */
export async function addInstalledFont(name: string): Promise<FontChoice | null> {
  const clean = name.trim();
  if (!clean) return null;
  await put({ name: clean });
  return { value: `${q(clean)}, sans-serif`, label: clean, group: "Font saya" };
}

/** Tambah font dari berkas. Namanya diambil dari nama berkas. */
export async function addFontFile(file: File): Promise<FontChoice> {
  const name = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, "").replace(/[-_]+/g, " ").trim() || "Font";
  const item: Stored = { name, data: await file.arrayBuffer() };
  await register(item);
  await put(item);
  return { value: `${q(name)}, sans-serif`, label: name, group: "Font saya" };
}

/** Pilih berkas font lewat dialog sistem. */
export function pickFontFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff,.woff2";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
