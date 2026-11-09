// Dokumen (JSON Tiptap) menjadi Markdown. Hanya membaca JSON, tanpa editor, jadi bisa diuji dan dipakai di mana saja.
// Yang tidak punya padanan Markdown (komentar, blok kalender, papan, dan tugas Moodle) dilewati; gambar lokal jadi teks keterangan.

export interface JNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JNode[];
}

export function parseDoc(raw: string): JNode {
  try {
    const j = JSON.parse(raw) as JNode;
    if (j && typeof j === "object" && j.type === "doc") return j;
  } catch {
    /* teks biasa */
  }
  const text = raw.trim();
  return { type: "doc", content: text ? text.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) : [] };
}

const esc = (s: string) => s.replace(/([\\`*_{}\[\]<>|])/g, "\\$1");

function inline(nodes: JNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "pageLink") return `[[${String(n.attrs?.title ?? "")}]]`;
      if (n.type === "inlineMath") return `$${String(n.attrs?.latex ?? "")}$`;
      if (n.type === "image") return `*[gambar]*`;
      if (n.type !== "text") return inline(n.content);
      const marks = n.marks ?? [];
      const has = (t: string) => marks.find((m) => m.type === t);
      let t = has("code") ? "`" + (n.text ?? "").replace(/`/g, "'") + "`" : esc(n.text ?? "");
      const lead = /^\s*/.exec(t)![0];
      const trail = /\s*$/.exec(t)![0];
      let core = t.trim();
      if (!core) return t;
      if (has("bold")) core = `**${core}**`;
      if (has("italic")) core = `*${core}*`;
      if (has("strike")) core = `~~${core}~~`;
      if (has("highlight")) core = `==${core}==`;
      if (has("underline")) core = `<u>${core}</u>`;
      if (has("subscript")) core = `<sub>${core}</sub>`;
      if (has("superscript")) core = `<sup>${core}</sup>`;
      const link = has("link");
      if (link?.attrs?.href) core = `[${core}](${String(link.attrs.href)})`;
      t = lead + core + trail;
      return t;
    })
    .join("");
}

function indentLines(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : pad + l))
    .join("\n");
}

function table(node: JNode): string {
  const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((b) => inline(b.content)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

function block(n: JNode): string {
  switch (n.type) {
    case "paragraph":
      return inline(n.content);
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(n.attrs?.level) || 1)))} ${inline(n.content)}`;
    case "blockquote":
      return blocks(n.content).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    case "callout": {
      const label = { info: "Info", tip: "Tips", warn: "Peringatan" }[String(n.attrs?.kind)] ?? "Info";
      return `> **${label}**\n>\n` + blocks(n.content).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    }
    case "codeBlock":
      return "```" + String(n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    case "horizontalRule":
      return "---";
    case "bulletList":
      return (n.content ?? []).map((li) => `- ${indentLines(blocks(li.content, "\n"), "  ")}`).join("\n");
    case "orderedList": {
      const start = Number(n.attrs?.start) || 1;
      return (n.content ?? []).map((li, i) => {
        const mark = `${start + i}. `;
        return `${mark}${indentLines(blocks(li.content, "\n"), " ".repeat(mark.length))}`;
      }).join("\n");
    }
    case "taskList":
      return (n.content ?? []).map((li) => `- [${li.attrs?.checked ? "x" : " "}] ${indentLines(blocks(li.content, "\n"), "  ")}`).join("\n");
    case "table":
      return table(n);
    case "details": {
      const parts = n.content ?? [];
      const summary = inline(parts.find((p) => p.type === "detailsSummary")?.content);
      const body = blocks(parts.find((p) => p.type === "detailsContent")?.content);
      return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
    }
    case "blockMath":
      return `$$\n${String(n.attrs?.latex ?? "")}\n$$`;
    case "image":
      return "*[gambar]*";
    default:
      return ""; // blok kalender, papan, tugas Moodle, dan lainnya
  }
}

function blocks(nodes: JNode[] | undefined, sep = "\n\n"): string {
  return (nodes ?? []).map(block).filter((s) => s !== "").join(sep);
}

/** Dokumen Markdown lengkap, dimulai dengan judul halaman bila ada. */
export function toMarkdown(raw: string, title = ""): string {
  const body = blocks(parseDoc(raw).content);
  return (title.trim() ? `# ${title.trim()}\n\n` : "") + body + "\n";
}
