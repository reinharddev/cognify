// Salin font Excalidraw ke static/ supaya whiteboard tidak mengunduh font dari internet
// (default Excalidraw: esm.sh). Dijalankan otomatis sebelum `dev` dan `build`.
// Xiaolai (huruf Tionghoa/Jepang/Korea, 12 MB) sengaja tidak ikut: teks seperti itu memakai font sistem.
import { cpSync, existsSync, rmSync } from "node:fs";

const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const dst = "static/excalidraw/fonts";
const SKIP = new Set(["Xiaolai"]);

if (!existsSync(src)) {
  console.error(`[excalidraw-assets] ${src} tidak ada. Jalankan npm install dulu.`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true, filter: (p) => !SKIP.has(p.slice(src.length + 1).split("/")[0]) });
console.log(`[excalidraw-assets] font disalin ke ${dst}`);
