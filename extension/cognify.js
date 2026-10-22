// Komunikasi dengan app Cognify di komputer yang sama (127.0.0.1). Tidak ada server di internet.
// Kunci akses didapat sekali lewat kode 6 angka dari Cognify → Pengaturan → Data.

export const BRIDGE = "http://127.0.0.1:47615";
const HEADER = "X-Cognify-Extension";
const MAX_MARKDOWN = 2_000_000;

export const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

/** Pilihan tujuan terakhir, dipakai juga oleh menu klik kanan dan pintasan keyboard. */
export async function getPrefs() {
  const { prefs } = await chrome.storage.local.get("prefs");
  return { kind: "new", pageId: "", tags: "", ...prefs };
}

export const setPrefs = (prefs) => chrome.storage.local.set({ prefs });

function targetOf(prefs, forceSticky) {
  if (forceSticky || prefs.kind === "sticky") return { kind: "sticky" };
  if (prefs.kind === "append" && prefs.pageId) return { kind: "append", pageId: prefs.pageId };
  return { kind: "new" };
}

const tagsOf = (prefs) => prefs.tags.split(",").map((s) => s.trim()).filter(Boolean);

/** Pesan galat dalam bahasa browser; kode yang tak dikenal memakai pesan dari app. */
export function explain(err) {
  if (err instanceof BridgeError) {
    const own = err.code && chrome.i18n.getMessage(`err_${err.code}`);
    return own || err.message || t("failed", [err.code || "?"]);
  }
  return err?.message || String(err);
}

async function call(path, { method = "GET", body, token } = {}) {
  let resp;
  try {
    resp = await fetch(BRIDGE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { [HEADER]: token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BridgeError("offline", t("notConnected"));
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const code = data?.error?.code || "";
    if (resp.status === 401 && path !== "/bridge/pair") await chrome.storage.local.remove("token");
    throw new BridgeError(code, data?.error?.message || t("failed", [String(resp.status)]));
  }
  return data;
}

async function authed() {
  const token = await getToken();
  if (!token) throw new BridgeError("unauthorized", t("notPaired"));
  return token;
}

export async function pair(code) {
  const { token } = await call("/bridge/pair", { method: "POST", body: { code } });
  await chrome.storage.local.set({ token });
}

export async function unpair() {
  await chrome.storage.local.remove("token");
}

export async function status() {
  const token = await getToken();
  if (!token) return "unpaired";
  try {
    await call("/bridge/status", { token });
    return "ok";
  } catch {
    return (await getToken()) ? "offline" : "unpaired";
  }
}

export async function targets() {
  const { pages } = await call("/bridge/targets", { token: await authed() });
  return pages;
}

async function send(body, prefs, forceSticky) {
  const token = await authed();
  const p = prefs ?? (await getPrefs());
  const data = await call("/bridge/clip", { method: "POST", token, body: { ...body, tags: tagsOf(p), target: targetOf(p, forceSticky) } });
  return { ...data, sticky: targetOf(p, forceSticky).kind === "sticky", append: targetOf(p, forceSticky).kind === "append" };
}

export const isWeb = (tab) => /^https?:/.test(tab?.url || "");

const MAX_PDF = 20 * 1024 * 1024;
const looksPdf = (tab) => /\.pdf($|[?#])/i.test(tab?.url || "");
const today = () => new Date().toISOString().slice(0, 10);

function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/**
 * PDF yang dibuka di browser: berkasnya diambil dengan cookie browser (jadi yang butuh login ikut bisa) lalu dikirim hanya
 * ke app Cognify di komputer ini, yang membaca metadata, DOI, dan nomor halaman teks yang disorot. null bila bukan PDF,
 * terlalu besar (>20 MB), atau tidak bisa dibaca; simpanan tetap jalan tanpa data PDF.
 */
async function pdfMeta(tab, selection) {
  const origin = (() => {
    try {
      return `${new URL(tab.url).origin}/*`;
    } catch {
      return "";
    }
  })();
  const grab = async () => {
    const resp = await fetch(tab.url, { credentials: "include" });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    if (Number(resp.headers.get("content-length") || 0) > MAX_PDF) return { error: "terlalu besar" };
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length > MAX_PDF) return { error: "terlalu besar" };
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF") return { error: "bukan PDF" };
    return { bytes };
  };
  try {
    let got;
    try {
      got = await grab();
    } catch {
      // Diblokir browser (belum punya izin ke situs ini): minta izin untuk situs ini saja, lalu coba lagi. Butuh klik pengguna,
      // yang ada karena simpan dimulai dari klik kanan, pintasan, atau tombol di popup.
      if (!origin || !(await chrome.permissions.request({ origins: [origin] }).catch(() => false))) return { error: "izin ke situs ditolak" };
      got = await grab();
    }
    if (!got.bytes) return got;
    const info = await call("/bridge/pdf-info", {
      method: "POST",
      token: await authed(),
      body: { data: toBase64(got.bytes), selection: selection || "", url: tab.url, tabTitle: tab.title || "" },
    });
    return info?.source ? { info } : { error: "tidak terbaca" };
  } catch (e) {
    return { error: e?.message || "gagal" };
  }
}

export async function saveSelection(tab, text, { prefs, sticky } = {}) {
  if (!text.trim()) throw new BridgeError("invalid", t("noSelection"));
  let meta = looksPdf(tab) ? {} : await pageMeta(tab, true);
  let pdfError = "";
  // Penampil PDF bisa saja "berhasil" dibaca tapi isinya bukan metadata sumber: jenis dokumennya yang menentukan.
  if (looksPdf(tab) || meta.failed || /pdf/i.test(meta.contentType || "") || /\.pdf$/i.test(tab.title || "")) {
    const pdf = await pdfMeta(tab, text);
    if (pdf.info) meta = { source: pdf.info.source, page: pdf.info.page || undefined, accessed: today() };
    else pdfError = pdf.error;
  }
  const { failed, contentType, ...rest } = meta;
  // Judul dokumen = judul yang dikutip: judul sumber yang sudah dibersihkan, bukan judul tab.
  const done = await send({ mode: "selection", url: tab.url, title: rest.source?.title || tab.title || "", text, ...rest }, prefs, sticky);
  return pdfError ? { ...done, pdfError } : done;
}

export function saveLink(url, title, { prefs } = {}) {
  return send({ mode: "link", url, title: title || "" }, prefs);
}

/** Metadata sumber (CSL-JSON) dan judul bagian terdekat; kegagalan membaca halaman tidak menggagalkan simpanan. */
async function pageMeta(tab, withSection) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractMeta, args: [withSection] });
    return result ? { source: result.source, section: result.section || "", accessed: result.accessed, contentType: result.contentType } : { failed: true };
  } catch {
    return { failed: true }; // mis. penampil PDF: halamannya tidak boleh dibaca
  }
}

export async function selectedText(tab) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || "") });
  return result || "";
}

export async function savePage(tab, { prefs } = {}) {
  await authed();
  let pdfError = "";
  const asPdf = async () => {
    const pdf = await pdfMeta(tab, "");
    if (!pdf.info) {
      pdfError = pdf.error;
      return null;
    }
    return send({ mode: "pdf", url: tab.url, title: pdf.info.source.title || tab.title || "", source: pdf.info.source, accessed: today() }, prefs);
  };
  if (looksPdf(tab)) {
    const done = await asPdf();
    if (done) return done;
  }
  // Ubah halaman yang sudah dirender (termasuk yang butuh login) jadi Markdown di dalam halaman itu sendiri,
  // jadi hanya teks bersihnya yang dikirim ke Cognify.
  let result;
  try {
    [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage, args: [MAX_MARKDOWN] });
  } catch {
    const done = await asPdf(); // halaman yang tidak boleh dibaca bisa jadi PDF tanpa akhiran .pdf
    if (done) return done;
    throw new BridgeError("invalid", t("pageEmpty"));
  }
  if (!result?.markdown?.trim() || /\.pdf$/i.test(tab.title || "")) {
    const done = await asPdf();
    if (done) return done;
    throw new BridgeError("invalid", pdfError ? t("pdfFailed", [pdfError]) : t("pageEmpty"));
  }
  const meta = await pageMeta(tab, false);
  const { failed, contentType, ...rest } = meta;
  return send({ mode: "page", url: tab.url, title: rest.source?.title || tab.title || "", markdown: result.markdown, ...rest }, prefs);
}

/** Dijalankan DI DALAM halaman (harus berdiri sendiri, tidak boleh memakai apa pun dari berkas ini). */
function extractPage(limit) {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "NAV", "ASIDE", "FOOTER", "FORM", "BUTTON", "SELECT", "TEXTAREA", "TEMPLATE", "CANVAS", "VIDEO", "AUDIO", "DIALOG"]);
  const root = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
  const out = [];
  let size = 0;
  const push = (s) => {
    if (size < limit) {
      out.push(s);
      size += s.length;
    }
  };
  const squash = (s) => s.replace(/\s+/g, " ");
  const inline = (node) => {
    let s = "";
    for (const c of node.childNodes) {
      if (c.nodeType === 3) s += squash(c.textContent);
      else if (c.nodeType === 1 && c.tagName.toUpperCase() === "SUP" && /^\s*\[[^\]]{1,20}\]\s*$/.test(c.textContent)) continue; // penanda rujukan [2], [b]
      else if (c.nodeType === 1 && !SKIP.has(c.tagName.toUpperCase()) && c.getAttribute("aria-hidden") !== "true" && !c.hidden) {
        const inner = inline(c);
        const tag = c.tagName.toUpperCase();
        if (!inner.trim()) continue;
        if (tag === "STRONG" || tag === "B") s += `**${inner.trim()}**`;
        else if (tag === "EM" || tag === "I") s += `*${inner.trim()}*`;
        else if (tag === "CODE") s += `\`${inner.trim()}\``;
        else if (tag === "BR") s += " ";
        else s += inner;
      }
    }
    return s;
  };
  const walk = (node, depth) => {
    for (const el of node.children) {
      const tag = el.tagName.toUpperCase();
      if (SKIP.has(tag) || el.hidden || el.getAttribute("aria-hidden") === "true") continue;
      if (/^H[1-6]$/.test(tag)) {
        const text = inline(el).trim();
        if (text) push(`${"#".repeat(Math.min(Number(tag[1]), 3))} ${text}\n\n`);
      } else if (tag === "P") {
        const text = inline(el).trim();
        if (text) push(`${text}\n\n`);
      } else if (tag === "UL" || tag === "OL") {
        let n = 1;
        for (const li of el.children) {
          if (li.tagName.toUpperCase() !== "LI") continue;
          const text = inline(li).trim();
          if (text) push(`${tag === "OL" ? `${n++}.` : "-"} ${text}\n`);
        }
        push("\n");
      } else if (tag === "BLOCKQUOTE") {
        const text = inline(el).trim();
        if (text) push(`> ${text}\n\n`);
      } else if (tag === "PRE") {
        push("```\n" + el.innerText.replace(/\n+$/, "") + "\n```\n\n");
      } else if (tag === "TABLE") {
        for (const row of el.rows) {
          const text = [...row.cells].map((c) => inline(c).trim()).filter(Boolean).join(" | ");
          if (text) push(`${text}\n\n`);
        }
      } else if (depth < 40) {
        // Pembungkus biasa (div, section, span...): teks langsung di dalamnya tetap diambil.
        const hasBlocks = el.querySelector("p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, table");
        if (hasBlocks) walk(el, depth + 1);
        else {
          const text = inline(el).trim();
          if (text.length > 1) push(`${text}\n\n`);
        }
      }
    }
  };
  walk(root, 0);
  let markdown = out.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (markdown.length < 200 && root !== document.body) {
    out.length = 0;
    size = 0;
    walk(document.body, 0);
    markdown = out.join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  return { markdown: markdown.slice(0, limit) };
}

/**
 * Dijalankan DI DALAM halaman (harus berdiri sendiri). Membaca metadata sumber dari JSON-LD, tag Highwire/Google Scholar,
 * Dublin Core, Open Graph, dan meta biasa, lalu menyusunnya sebagai CSL-JSON. Yang tidak ada dibiarkan kosong, tidak ditebak.
 */
function extractMeta(withSection) {
  const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const metaAll = (...names) => {
    const out = [];
    // Tag Highwire/Google Scholar (`citation_*`) juga dicari dalam bentuk Digital Commons (`bepress_citation_*`).
    const all = names.flatMap((n) => (n.startsWith("citation_") ? [n, `bepress_${n}`] : [n]));
    for (const n of all) {
      for (const el of document.querySelectorAll(`meta[name="${n}" i], meta[property="${n}" i], meta[itemprop="${n}" i]`)) {
        const v = text(el.getAttribute("content"));
        if (v) out.push(v);
      }
    }
    return out;
  };
  const meta = (...names) => metaAll(...names)[0] || "";

  // JSON-LD: ratakan @graph lalu ambil objek bertipe artikel/halaman.
  const ld = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      ld.push(x);
      if (x["@graph"]) walk(x["@graph"]);
    }
  };
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(el.textContent));
    } catch {
      /* JSON-LD rusak: lewati */
    }
  }
  const typeOf = (o) => [].concat(o["@type"] || []).map(String);
  const art = ld.find((o) => typeOf(o).some((t) => /(News)?Article$|BlogPosting|ScholarlyArticle|Report|WebPage$/.test(t)));
  const ldNames = (v) => [].concat(v || []).map((a) => (typeof a === "string" ? a : a && (a.name || ""))).map(text).filter(Boolean);
  const ldPublisher = art && ldNames(art.publisher)[0];

  // Penulis: Highwire, Dublin Core, JSON-LD, meta author, penanda penulis di halaman.
  let authors = metaAll("citation_author");
  if (!authors.length) authors = metaAll("dc.creator", "dcterms.creator", "DC.Creator");
  if (!authors.length && art) authors = ldNames(art.author);
  if (!authors.length) authors = metaAll("author", "article:author", "parsely-author", "sailthru.author").filter((a) => !/^https?:/.test(a));
  if (!authors.length) {
    const el = document.querySelector('[rel="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"], .byline__name, .author-name, .byline');
    const v = el && text(el.textContent).replace(/^by\s+/i, "");
    if (v && v.length < 80) authors = [v];
  }
  // Satu string berisi beberapa nama ("A, B dan C") dibiarkan satu: lebih baik utuh daripada salah pisah.
  const parseName = (full) => {
    const n = text(full);
    const c = n.split(",").map((x) => x.trim());
    // "Keluarga, Depan": yang sebelum koma satu kata, atau yang sesudahnya hanya inisial; "A B, C D" justru dua nama utuh.
    if (c.length === 2 && c[1] && c[1].split(" ").length <= 3 && (c[0].split(" ").length === 1 || c[1].split(" ").every((w) => w.replace(/\.$/, "").length <= 1))) {
      return { family: c[0], given: c[1] };
    }
    const parts = n.split(" ");
    if (parts.length >= 2 && parts.length <= 4 && /^[A-Za-zÀ-ÿ.'’-]+$/.test(parts.join(""))) {
      return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" "), _guess: true };
    }
    return { literal: n };
  };

  const dateParts = (v) => {
    const m = text(v).match(/(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
    if (m) return { "date-parts": [[Number(m[1]), Number(m[2]), ...(m[3] ? [Number(m[3])] : [])]] };
    const y = text(v).match(/^(\d{4})$/);
    return y ? { "date-parts": [[Number(y[1])]] } : undefined;
  };
  let published = dateParts(meta("citation_publication_date", "citation_date", "citation_online_date", "article:published_time", "dc.date", "dcterms.date", "DC.Date.issued", "datePublished", "og:article:published_time", "pubdate") || (art && art.datePublished));
  const guess = []; // kolom yang disimpulkan, bukan dibaca langsung dari metadata; bisa ditandai "periksa" di app
  if (!published) {
    const t = document.querySelector("article time[datetime], time[itemprop='datePublished'][datetime], time[datetime]");
    published = (t && dateParts(t.getAttribute("datetime"))) || undefined;
  }
  if (!published) {
    // Banyak blog dan berita menaruh tanggal di alamat: /2024/05/02/judul.
    const m = location.pathname.match(/\/((?:19|20)\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
    if (m && Number(m[2]) <= 12 && Number(m[3]) <= 31) {
      published = { "date-parts": [[Number(m[1]), Number(m[2]), Number(m[3])]] };
      guess.push("issued");
    }
  }

  const host = location.hostname.replace(/^www\./, "");
  const isWiki = /(^|\.)wikipedia\.org$/.test(host);
  const doi = (meta("citation_doi", "dc.identifier", "DC.Identifier.DOI", "prism.doi") || "").replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, "");
  const journal = meta("citation_journal_title", "prism.publicationName");
  const canonical = (document.querySelector('link[rel="canonical"]') || {}).href || "";

  let type = "webpage";
  if (journal || /^10\.\d{4,9}\//.test(doi) || (art && typeOf(art).includes("ScholarlyArticle"))) type = "article-journal";
  else if (isWiki) type = "entry-encyclopedia";
  else if (art && typeOf(art).some((t) => /NewsArticle|Report/.test(t))) type = "article-newspaper";
  else if (art && typeOf(art).includes("BlogPosting")) type = "post-weblog";

  let title = meta("citation_title", "dc.title", "DC.Title") || (art && text(art.headline)) || meta("og:title", "twitter:title") || text(document.title);
  let url = canonical || location.href.split("#")[0];
  let issued = published;
  authors = authors.filter((a, i) => authors.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
  let author = authors.map(parseName);

  let siteName = meta("og:site_name", "application-name") || ldPublisher || "";
  let publisher = meta("citation_publisher", "dc.publisher", "DC.Publisher") || ldPublisher || "";

  if (isWiki) {
    title = text(document.title).replace(/\s*[-–—]\s*Wikipedia.*$/i, "") || title;
    author = [{ literal: "Wikipedia contributors" }];
    siteName = "Wikipedia";
    publisher = "Wikimedia Foundation";
    const perm = document.querySelector("#t-permalink a");
    if (perm && perm.href) url = perm.href; // tautan permanen revisi (oldid): sumber yang stabil untuk dikutip
    const last = text((document.querySelector("#footer-info-lastmod") || {}).textContent).match(/(\d{1,2}) ([A-Za-z]+) (\d{4})/);
    if (last) {
      const mi = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(last[2].toLowerCase());
      if (mi >= 0) issued = { "date-parts": [[Number(last[3]), mi + 1, Number(last[1])]] };
    }
  } else {
    // "Judul | Nama Situs": buang nama situs dari judul bila sama dengan nama situs yang diketahui.
    const m = title.match(/^(.*\S)\s+[|–—:-]\s+(.+)$/);
    if (m && siteName && m[2].toLowerCase() === siteName.toLowerCase()) title = m[1];
    else if (!siteName) {
      const bar = title.match(/^(.*\S)\s+\|\s+([^|]{2,40})$/); // hanya "|": tanda pisah judul-situs yang paling jarang dipakai di dalam judul
      if (bar) {
        title = bar[1];
        siteName = bar[2];
        guess.push("container-title");
      }
    }
  }

  if (author.some((a) => a._guess)) guess.push("author");

  const source = {
    type,
    title: text(title),
    "container-title": journal || (type === "article-journal" ? "" : siteName),
    publisher: type === "article-journal" ? publisher : siteName === publisher ? "" : publisher,
    author,
    issued,
    URL: url,
    DOI: doi || undefined,
    volume: meta("citation_volume", "prism.volume") || undefined,
    issue: meta("citation_issue", "prism.number") || undefined,
    page: meta("citation_firstpage", "prism.startingPage") ? [meta("citation_firstpage", "prism.startingPage"), meta("citation_lastpage", "prism.endingPage")].filter(Boolean).join("-") : undefined,
    ISSN: meta("citation_issn", "prism.issn") || undefined,
    _guess: guess.length ? guess : undefined,
    language: text(document.documentElement.lang || meta("citation_language", "dc.language", "og:locale")).slice(0, 12) || undefined,
  };
  for (const k of Object.keys(source)) {
    const v = source[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) delete source[k];
  }

  // Judul bagian terdekat di atas awal teks yang disorot (kutipan langsung di web memakai bagian, bukan halaman).
  let section = "";
  if (withSection) {
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const start = sel.getRangeAt(0).startContainer;
      let found = null;
      for (const h of document.querySelectorAll("h1, h2, h3, h4")) {
        if (h.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(start)) found = h;
        else break;
      }
      if (found) {
        const clone = found.cloneNode(true);
        clone.querySelectorAll(".mw-editsection, .anchor, sup, script, style, button").forEach((e) => e.remove());
        section = text(clone.textContent).replace(/\[(edit|sunting)\]$/i, "").trim();
        if (section.length > 120) section = "";
      }
    }
  }
  const now = new Date();
  const accessed = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { source, section, accessed, contentType: document.contentType };
}
