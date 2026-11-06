// Gambar di dokumen. Berkas gambar disimpan di folder data app; dokumen hanya menyimpan "img:<nama>", yang dibentuk
// menjadi alamat asset saat ditampilkan. Di browser biasa (tanpa Tauri) gambar disematkan sebagai data URL.

import Image from "@tiptap/extension-image";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

const PREFIX = "img:";
let base = "";

export const imagesReady: Promise<void> = isTauri()
  ? invoke<string>("image_dir").then(
      (d) => void (base = d.replace(/\/+$/, "")),
      () => undefined,
    )
  : Promise.resolve();

const resolve = (src: string | null | undefined) => (src && src.startsWith(PREFIX) && base ? convertFileSrc(`${base}/${src.slice(PREFIX.length)}`) : (src ?? ""));

export const isImageFile = (f: { type: string; name?: string }) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name ?? "");

const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Simpan gambar dari File (tempel, pemilih berkas). Mengembalikan nilai `src` untuk dokumen. */
export async function saveImageFile(file: File): Promise<string> {
  if (!isTauri()) {
    return new Promise((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => fail(r.error);
      r.readAsDataURL(file);
    });
  }
  await imagesReady;
  const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
  const name = await invoke<string>("image_save", { data: toBase64(await file.arrayBuffer()), ext: ext === "jpeg" ? "jpg" : ext });
  return PREFIX + name;
}

/** Salin gambar dari jalur berkas (seret dari Finder). */
export async function importImagePath(path: string): Promise<string> {
  await imagesReady;
  return PREFIX + (await invoke<string>("image_import", { path }));
}

export const ImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Nilai yang tersimpan tetap "img:<nama>"; DOM berisi alamat asset, jadi dikembalikan saat membaca.
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-src") ?? el.getAttribute("src"),
        renderHTML: (attrs: { src?: string | null }) => ({ src: resolve(attrs.src), "data-src": attrs.src }),
      },
    };
  },
}).configure({ inline: false, allowBase64: true });
