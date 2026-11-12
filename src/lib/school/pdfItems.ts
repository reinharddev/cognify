// Baca teks sebuah PDF beserta posisinya, untuk jadwal yang diunggah. Berjalan di perangkat ini: pdf.js dimuat saat
// dibutuhkan saja, dan tidak ada permintaan jaringan. Memakai build "legacy" supaya jalan di WebView lama juga.

import type { PdfItem } from "./timetable";

/** Maksimal halaman yang dibaca; jadwal biasanya satu halaman. */
const MAX_PAGES = 5;

export async function readPdfItems(data: ArrayBuffer): Promise<PdfItem[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false });
  const doc = await task.promise;
  const pages: PdfItem[][] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items.flatMap((i) => ("str" in i && i.str.trim() ? [{ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : [])),
      );
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
