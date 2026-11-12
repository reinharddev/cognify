// Dokumen (JSON Tiptap) menjadi berkas Word (.docx) lewat paket `docx`. Dimuat saat dibutuhkan saja (import dinamis),
// supaya tidak menambah berat awal app. Tanpa jaringan.

import { parseDoc, type JNode } from "./markdown";
import { exportableNotes, readNotes } from "../workspace/docNotes";

export interface DocxOptions {
  title?: string;
  /** Baca byte gambar dari `src` dokumen (mis. `img:nama.png`); null bila tidak bisa dibaca. */
  resolveImage?: (src: string) => Promise<{ data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number } | null>;
  /** Gambar papan (PNG) untuk blok papan; null bila papan kosong atau gagal digambar. */
  resolveBoard?: (pageId: string) => Promise<{ title: string; data: Uint8Array; width: number; height: number } | null>;
  /** Judul bagian catatan di akhir dokumen. */
  notesHeading?: string;
}

type D = typeof import("docx");

export async function buildDocx(raw: string, opts: DocxOptions = {}) {
  const d: D = await import("docx");
  const doc = parseDoc(raw);
  let ordered = 0;

  const runs = async (nodes: JNode[] | undefined, base: { bold?: boolean; italics?: boolean } = {}) => {
    const out: InstanceType<D["TextRun"] | D["ExternalHyperlink"]>[] = [];
    for (const n of nodes ?? []) {
      if (n.type === "hardBreak") out.push(new d.TextRun({ break: 1 }));
      else if (n.type === "pageLink") out.push(new d.TextRun({ text: `[${String(n.attrs?.title ?? "")}]`, ...base }));
      else if (n.type === "inlineMath") out.push(new d.TextRun({ text: String(n.attrs?.latex ?? ""), font: "Cambria Math", italics: true }));
      else if (n.type === "text") {
        const marks = n.marks ?? [];
        const has = (t: string) => marks.find((m) => m.type === t);
        const style = has("textStyle")?.attrs ?? {};
        const px = parseFloat(String(style.fontSize ?? ""));
        const color = /^#[0-9a-f]{6}$/i.test(String(style.color ?? "")) ? String(style.color).slice(1) : undefined;
        const font = style.fontFamily ? String(style.fontFamily).split(",")[0].replace(/["']/g, "").trim() : undefined;
        const run = new d.TextRun({
          text: n.text ?? "",
          bold: base.bold || !!has("bold"),
          italics: base.italics || !!has("italic"),
          strike: !!has("strike"),
          underline: has("underline") || has("link") ? {} : undefined,
          highlight: has("highlight") ? "yellow" : undefined,
          superScript: !!has("superscript"),
          subScript: !!has("subscript"),
          font: has("code") ? "Courier New" : font,
          color: has("link") ? "1B6590" : color,
          size: Number.isFinite(px) ? Math.round(px * 1.5) : undefined,
        });
        const href = has("link")?.attrs?.href;
        out.push(href && /^https?:\/\//.test(String(href)) ? new d.ExternalHyperlink({ link: String(href), children: [run] }) : run);
      }
    }
    return out;
  };

  const align = (n: JNode) => {
    const a = String(n.attrs?.textAlign ?? "");
    return a === "center" ? d.AlignmentType.CENTER : a === "right" ? d.AlignmentType.RIGHT : a === "justify" ? d.AlignmentType.JUSTIFIED : undefined;
  };
  const HEAD = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];

  type Out = InstanceType<D["Paragraph"] | D["Table"]>;
  const flow = async (nodes: JNode[] | undefined, ctx: { level?: number; list?: "bullet" | "ol"; instance?: number; quote?: boolean } = {}): Promise<Out[]> => {
    const out: Out[] = [];
    for (const n of nodes ?? []) {
      switch (n.type) {
        case "paragraph":
          out.push(
            new d.Paragraph({
              children: await runs(n.content, ctx.quote ? { italics: true } : {}),
              alignment: align(n),
              bullet: ctx.list === "bullet" ? { level: ctx.level ?? 0 } : undefined,
              numbering: ctx.list === "ol" ? { reference: "ol", level: ctx.level ?? 0, instance: ctx.instance ?? 1 } : undefined,
              indent: ctx.quote ? { left: 480 } : undefined,
            }),
          );
          ctx = { ...ctx, list: undefined }; // marka daftar hanya di paragraf pertama butir
          break;
        case "heading":
          out.push(new d.Paragraph({ heading: HEAD[Math.min(5, Math.max(0, (Number(n.attrs?.level) || 1) - 1))], children: await runs(n.content), alignment: align(n) }));
          break;
        case "blockquote":
          out.push(...(await flow(n.content, { ...ctx, quote: true })));
          break;
        case "callout": {
          const label = { info: "Info", tip: "Tips", warn: "Peringatan" }[String(n.attrs?.kind)] ?? "Info";
          out.push(new d.Paragraph({ children: [new d.TextRun({ text: label, bold: true })], indent: { left: 240 }, border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: "7A8FD6", space: 8 } } }));
          out.push(...(await flow(n.content, { ...ctx, quote: false })).map((p) => p));
          break;
        }
        case "codeBlock":
          for (const line of (n.content ?? []).map((c) => c.text ?? "").join("").split("\n"))
            out.push(new d.Paragraph({ children: [new d.TextRun({ text: line, font: "Courier New", size: 20 })], shading: { type: d.ShadingType.CLEAR, fill: "F1F1F1" } }));
          break;
        case "horizontalRule":
          out.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
          break;
        case "bulletList":
        case "orderedList":
        case "taskList": {
          const kind = n.type === "bulletList" ? "bullet" : n.type === "orderedList" ? "ol" : undefined;
          const instance = n.type === "orderedList" ? ++ordered : undefined;
          for (const li of n.content ?? []) {
            const level = (ctx.level ?? -1) + 1;
            if (!kind) {
              const mark = li.attrs?.checked ? "☑ " : "☐ ";
              const inner = await flow(li.content, { level, quote: ctx.quote });
              const first = li.content?.[0];
              // kotak centang di paragraf pertama butir
              if (first?.type === "paragraph") inner[0] = new d.Paragraph({ children: [new d.TextRun({ text: mark }), ...(await runs(first.content))], indent: { left: 360 * (level + 1) } });
              out.push(...inner);
            } else out.push(...(await flow(li.content, { level, list: kind, instance, quote: ctx.quote })));
          }
          break;
        }
        case "table": {
          const rows = await Promise.all(
            (n.content ?? []).map(async (r) =>
              new d.TableRow({
                children: await Promise.all(
                  (r.content ?? []).map(async (c) => {
                    const kids = (await flow(c.content)) as InstanceType<D["Paragraph"]>[];
                    return new d.TableCell({ children: kids.length ? kids : [new d.Paragraph("")], shading: c.type === "tableHeader" ? { type: d.ShadingType.CLEAR, fill: "EEEEEE" } : undefined });
                  }),
                ),
              }),
            ),
          );
          if (rows.length) out.push(new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }));
          break;
        }
        case "details": {
          const parts = n.content ?? [];
          out.push(new d.Paragraph({ children: await runs(parts.find((p) => p.type === "detailsSummary")?.content, { bold: true }) }));
          out.push(...(await flow(parts.find((p) => p.type === "detailsContent")?.content, ctx)));
          break;
        }
        case "blockMath":
          out.push(new d.Paragraph({ children: [new d.TextRun({ text: String(n.attrs?.latex ?? ""), font: "Cambria Math", italics: true })], alignment: d.AlignmentType.CENTER }));
          break;
        case "image": {
          const src = String(n.attrs?.src ?? "");
          const img = src && opts.resolveImage ? await opts.resolveImage(src).catch(() => null) : null;
          if (img) {
            const w = Math.min(img.width, 560);
            out.push(new d.Paragraph({ children: [new d.ImageRun({ data: img.data, type: img.type, transformation: { width: w, height: Math.round((img.height * w) / Math.max(img.width, 1)) } })] }));
          } else out.push(new d.Paragraph({ children: [new d.TextRun({ text: "[gambar]", italics: true })] }));
          break;
        }
        case "boardBlock": {
          const id = String(n.attrs?.pageId ?? "");
          if (!id) break;
          const img = opts.resolveBoard ? await opts.resolveBoard(id).catch(() => null) : null;
          if (img) {
            const w = Math.min(img.width, 560);
            out.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.ImageRun({ data: img.data, type: "png", transformation: { width: w, height: Math.round((img.height * w) / Math.max(img.width, 1)) } })] }));
            if (img.title) out.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: img.title, italics: true })] }));
          } else out.push(new d.Paragraph({ children: [new d.TextRun({ text: "[papan]", italics: true })] }));
          break;
        }
        default:
          break;
      }
    }
    return out;
  };

  const body = await flow(doc.content);
  // Catatan melayang jadi teks biasa di akhir dokumen.
  const notes = exportableNotes(readNotes(raw));
  if (notes.length) {
    body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun(opts.notesHeading ?? "Catatan")] }));
    for (const n of notes) {
      if (n.title) body.push(new d.Paragraph({ children: [new d.TextRun({ text: n.title, bold: true })] }));
      for (const para of n.text.split(/\n{2,}/).filter(Boolean)) {
        body.push(new d.Paragraph({ children: para.split("\n").map((line, i) => new d.TextRun({ text: line, break: i ? 1 : undefined })) }));
      }
    }
  }
  const levels = Array.from({ length: 6 }, (_, level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } }));
  return new d.Document({
    title: opts.title,
    numbering: { config: [{ reference: "ol", levels }] },
    sections: [{ children: [...(opts.title?.trim() ? [new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(opts.title.trim())] })] : []), ...body] }],
  });
}

export async function docxBlob(raw: string, opts: DocxOptions = {}): Promise<Blob> {
  const d: D = await import("docx");
  return d.Packer.toBlob(await buildDocx(raw, opts));
}
