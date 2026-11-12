// @ts-nocheck -- skrip ekstensi browser (bukan bagian app); diimpor tes hanya untuk fungsi murninya.
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

// ---- Tabel portal sekolah (nilai dan jadwal) ----
// Dua jenis halaman: "exam" (tugas, ujian, nilai) dan "schedule" (jadwal pelajaran). Tiap jenis punya wadah tabel,
// dropdown periode, dan fungsi pemuat sendiri di portal. Fungsi yang dijalankan di halaman harus berdiri sendiri
// (tidak boleh memakai apa pun dari luar), karena diserialisasi oleh executeScript.
const KINDS = {
  exam: { box: "#exam_table", selector: "#comboClassExam", loader: "change_exam", tab: "Assignment & Exam", name: "Nilai" },
  schedule: { box: "#schedule_table", selector: "", loader: "change_schedule_table", tab: "Schedule", name: "Jadwal" },
};

/** Dijalankan di halaman: dropdown periode, pilihan sekarang, dan periode yang sedang tampil di tabel. */
function pageInfo(cfg) {
  const YEARS = /\d{4}\s*-\s*\d{4}/;
  const hasYears = (x) => [...x.options].some((o) => YEARS.test(o.text));
  const text = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("script,style").forEach((n) => n.remove());
    c.querySelectorAll("br").forEach((b) => b.replaceWith(" | "));
    return c.textContent.replace(/\s+/g, " ").trim().slice(0, 500);
  };
  // Dropdown milik wadah ini: lewat id, lalu yang onchange-nya memanggil fungsi pemuat, lalu yang sewadah. Dropdown periode
  // lain di halaman yang sama tidak boleh terpilih.
  const box = document.querySelector(cfg.box);
  const sels = [...document.querySelectorAll("select")].filter(hasYears);
  const sel =
    (cfg.selector && sels.find((x) => x.matches(cfg.selector))) ||
    sels.find((x) => (x.getAttribute("onchange") || "").includes(cfg.loader)) ||
    (box?.parentElement && sels.find((x) => box.parentElement.contains(x))) ||
    null;
  const root = box || document.body;
  const h = root.querySelector("h3") ? text(root.querySelector("h3")) : "";
  const m = /Period:\s*(.+?)(?:\s*\|?\s*Homeroom|\s*\|?\s*$)/i.exec(text(root));
  return {
    hasSelect: !!sel,
    selectId: sel ? sel.id || sel.name || "" : "",
    options: sel ? [...sel.options].filter((o) => YEARS.test(o.text)).map((o) => ({ value: o.value, text: text(o) })) : [],
    current: sel ? sel.value : "",
    shown: h && m ? `${h} / ${m[1].trim()}` : "",
  };
}

/** Dijalankan di halaman: mengklik tab (mis. "Assignment & Exam") seperti pengguna; isinya baru dimuat portal saat tab dibuka. */
function openTab(label) {
  const norm = (x) => (x || "").replace(/\s+/g, " ").trim().toLowerCase();
  const el = [...document.querySelectorAll("a,button,[role=tab]")].find((x) => norm(x.textContent) === norm(label));
  if (!el) return false;
  el.click();
  return true;
}

/** Dijalankan di halaman: teks tab yang sedang aktif, untuk dikembalikan setelah selesai. */
function activeTab() {
  const el = document.querySelector(".nav-tabs li.active > a, .nav-tabs .nav-link.active, [role=tab][aria-selected=true]");
  return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
}

/**
 * Dijalankan di halaman (dunia MAIN): memilih satu periode. mode "loader": fungsi pemuat milik portal dipanggil langsung;
 * "event": event change native; "jquery": pemicu change milik jQuery halaman. Mengembalikan cara yang dipakai, untuk laporan.
 */
function pickOption(value, cfg, mode = "loader") {
  const YEARS = /\d{4}\s*-\s*\d{4}/;
  const hasYears = (x) => [...x.options].some((o) => YEARS.test(o.text));
  const box = document.querySelector(cfg.box);
  const sels = [...document.querySelectorAll("select")].filter(hasYears);
  const sel =
    (cfg.selector && sels.find((x) => x.matches(cfg.selector))) ||
    sels.find((x) => (x.getAttribute("onchange") || "").includes(cfg.loader)) ||
    (box?.parentElement && sels.find((x) => box.parentElement.contains(x))) ||
    null;
  if (!sel) return { ok: false, via: "tanpa dropdown" };
  sel.value = value;
  const loaderType = typeof window[cfg.loader];
  if (mode === "loader" && loaderType === "function") {
    window[cfg.loader](value);
    return { ok: true, via: "loader" };
  }
  if (mode === "jquery" && window.jQuery) {
    window.jQuery(sel).trigger("change");
    return { ok: true, via: "jquery" };
  }
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, via: mode === "loader" ? `event (loader ${loaderType})` : "event" };
}

/**
 * Dijalankan di halaman: tabel yang sedang tampil beserta periodenya. Sel yang menyatu antar baris (rowspan, mis. hari di
 * jadwal) dan antar kolom (colspan) diratakan supaya setiap baris punya semua kolom, dan <br> di dalam sel jadi " | ".
 */
function readPage(cfg) {
  const text = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("script,style").forEach((n) => n.remove());
    c.querySelectorAll("br").forEach((b) => b.replaceWith(" | "));
    return c.textContent.replace(/\s+/g, " ").trim().slice(0, 500);
  };
  const root = document.querySelector(cfg.box) || document.body;
  const h = root.querySelector("h3") ? text(root.querySelector("h3")) : "";
  const m = /Period:\s*(.+?)(?:\s*\|?\s*Homeroom|\s*\|?\s*$)/i.exec(text(root));
  const tables = [];
  for (const table of root.querySelectorAll("table")) {
    const trs = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table && !tr.closest("thead, tfoot"));
    const carry = [];
    const rows = [];
    for (const tr of trs) {
      const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName));
      if (!cells.length) continue;
      const row = [];
      let ci = 0;
      const fill = () => {
        while (carry[ci] && carry[ci].left > 0) {
          row[ci] = carry[ci].text;
          carry[ci].left--;
          ci++;
        }
      };
      for (const cell of cells) {
        fill();
        const t = text(cell);
        const cs = Math.max(1, cell.colSpan || 1);
        const rs = Math.max(1, cell.rowSpan || 1);
        for (let k = 0; k < cs; k++) {
          row[ci] = t;
          carry[ci] = rs > 1 ? { text: t, left: rs - 1 } : null;
          ci++;
        }
      }
      fill();
      rows.push(row);
    }
    const head = table.querySelector("thead tr");
    const headers = head ? [...head.children].map(text) : rows.shift() || [];
    if (rows.length && tables.length < 8) tables.push({ headers: headers.slice(0, 30), rows: rows.slice(0, 1000).map((r) => r.slice(0, 30)) });
  }
  return { shown: h && m ? `${h} / ${m[1].trim()}` : "", tables };
}

const normPeriod = (x) => x.toLowerCase().replace(/kelas|class/g, "").replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
export const samePeriod = (a, b) => normPeriod(a) === normPeriod(b);

/**
 * Memilih tiap periode, menunggu sampai tabel yang tampil memang periode itu (menurut tulisan di atas tabel), membaca, dan
 * mengirim. `exec(func, args, world)` menjalankan fungsi di halaman, `post(period, tables)` mengirim ke Cognify; keduanya
 * disuntikkan supaya logika ini bisa diuji tanpa browser ekstensi. Mengembalikan null bila halaman tidak punya dropdown jenis ini.
 */
export async function runAllPeriods({ exec, post, kind = "exam", sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 20000 }) {
  const cfg = KINDS[kind];
  let info = await exec(pageInfo, [cfg]);
  if (!info?.hasSelect && cfg.tab) {
    // Isi tab baru dimuat portal saat tabnya diklik: klik, lalu tunggu dropdown-nya muncul (paling lama 12 detik).
    await exec(openTab, [cfg.tab]);
    for (let waited = 0; waited < 12000 && !info?.hasSelect; waited += 500) {
      await sleep(500);
      info = await exec(pageInfo, [cfg]);
    }
  }
  if (!info?.hasSelect || !info.options.length) return null;
  const verify = info.shown !== ""; // halaman menyebut periodenya sendiri: label dan isi bisa dipastikan cocok
  let count = 0;
  const failed = [];
  const diag = [`${cfg.name}: dropdown ${info.selectId || "tanpa id"}, ${info.options.length} periode, tampil awal: ${info.shown || "kosong"}`];
  for (const opt of info.options) {
    // Bila tabel periode ini tidak muncul dalam 7 detik, coba cara pemilihan lain (event native, lalu jQuery) sebelum menyerah.
    const modes = ["loader", "event", "jquery"];
    let picked = await exec(pickOption, [opt.value, cfg, modes[0]], "MAIN");
    const via = [picked?.via ?? "?"];
    let data = null;
    let last = "";
    let seen = "";
    for (let waited = 0; waited < timeoutMs && !data; waited += 400) {
      await sleep(400);
      if (waited > 0 && waited % 7200 === 0 && modes.length > 1) {
        modes.shift();
        picked = await exec(pickOption, [opt.value, cfg, modes[0]], "MAIN");
        via.push(picked?.via ?? "?");
      }
      const cur = await exec(readPage, [cfg]);
      seen = cur?.shown || (cur?.tables?.length ? "?" : "kosong");
      if (!cur?.tables?.length) continue;
      const stamp = JSON.stringify(cur.tables);
      // Terverifikasi: tulisan periode cocok. Tanpa itu: isi tabel sama dua kali berturut-turut (sudah berhenti berubah).
      const ready = verify ? samePeriod(cur.shown, opt.text) : stamp === last;
      last = stamp;
      if (!ready) continue;
      await sleep(400);
      const again = await exec(readPage, [cfg]);
      if (again?.tables?.length && JSON.stringify(again.tables) === stamp) data = again;
    }
    if (!data) {
      failed.push(`${opt.text} (tampil: ${seen || "kosong"})`);
      diag.push(`  GAGAL ${opt.text}: tampil "${seen || "kosong"}", cara: ${via.join(" > ")}`);
      continue;
    }
    await post(verify ? data.shown : opt.text, data.tables);
    diag.push(`  OK ${opt.text}: ${data.tables.reduce((n, t) => n + t.rows.length, 0)} baris, cara: ${via.join(" > ")}`);
    count++;
  }
  if (info.current) await exec(pickOption, [info.current, cfg], "MAIN"); // kembalikan pilihan semula
  return { count, total: info.options.length, failed, diag };
}

/**
 * Nilai, jadwal, dan kehadiran, masing-masing dikerjakan terpisah supaya yang satu gagal tidak mematikan yang lain, dan tiap hasil
 * dilaporkan apa adanya (tidak ada "berhasil" bila tidak ada yang terkirim). `exec(func, args, world)` menjalankan fungsi di halaman;
 * `post(kind, period, tables)` mengirim satu tabel ke Cognify; keduanya disuntikkan supaya bisa diuji.
 */
export async function runEverything({ exec, post, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 20000 }) {
  const startTab = await exec(activeTab);
  const report = { parts: [], failed: [], attendanceDays: 0, lines: [] };
  let examOptions = [];
  for (const kind of ["exam", "schedule"]) {
    const name = KINDS[kind].name;
    try {
      const r = await runAllPeriods({ exec, kind, sleep, timeoutMs, post: (period, tables) => post(kind, period, tables) });
      if (!r) {
        report.failed.push(`${name}: tab "${KINDS[kind].tab}" tidak termuat di halaman ini`);
        report.lines.push(`${name}: tab "${KINDS[kind].tab}" tidak termuat`);
      }
      else {
        report.parts.push({ kind, name, count: r.count, total: r.total });
        report.lines.push(...r.diag);
        report.failed.push(...r.failed.map((f) => `${name} ${f}`));
        if (kind === "exam") examOptions = (await exec(pageInfo, [KINDS.exam]))?.options?.map((o) => o.text) ?? [];
      }
    } catch (e) {
      report.failed.push(`${name}: ${e?.message || e}`);
    }
  }
  try {
    report.attendanceDays = await sendAttendance({ exec, optionTexts: examOptions, post: (rows) => post("attendance", "", [{ headers: ["Date", "Status", "Check in", "Check out"], rows }]) });
  } catch (e) {
    report.failed.push(e?.message || String(e));
  }
  if (startTab) await exec(openTab, [startTab]).catch(() => {}); // kembalikan tab semula
  report.lines.push(`Kehadiran: ${report.attendanceDays} hari`, ...report.failed.filter((f) => !/\(tampil:/.test(f)).map((f) => `Catatan: ${f}`));
  // Laporan lengkap ikut dikirim ke Cognify supaya penyebab kegagalan bisa dibaca di sana, bukan hanya di popup yang cepat hilang.
  try {
    await post("report", "", [{ headers: ["Line"], rows: report.lines.map((l) => [l]) }]);
  } catch {
    /* laporan hanya tambahan */
  }
  report.sent = report.parts.reduce((n, p) => n + p.count, 0) + (report.attendanceDays ? 1 : 0);
  report.summary = [
    ...report.parts.map((p) => `${p.name} ${p.count}/${p.total} periode`),
    report.attendanceDays ? `Kehadiran ${report.attendanceDays} hari` : "",
  ].filter(Boolean).join(", ");
  return report;
}

// ---- Portal CIS (Sekolah Ciputra Kasih) ----
// Murid sering memakai tombol kirim dari halaman mana saja di portal. Di situs ini ekstensi lebih dulu membawa tab ke halaman
// Academic (tempat nilai, jadwal, dan kehadiran), mengirimnya, lalu pindah ke halaman Self Development Challenge (SDC) dan
// membaca tabel progres mingguannya. Tab berakhir di halaman awal SDC, tempat murid mengisi progres sendiri.

export const CIS = { origin: "https://student.citrakasih.sch.id", academic: "/student_info/academic", sdc: "/index.php/school_self_development/my_commitment" };

export function isCis(url) {
  try {
    return new URL(url).origin === CIS.origin;
  } catch {
    return false;
  }
}

/** Izin akses ke situs portal (hanya bila belum ada), supaya ekstensi tetap bisa membaca halaman sesudah tab berpindah. Panggil dari klik pengguna. */
export async function ensureSiteAccess(origin = CIS.origin) {
  const origins = [`${origin}/*`];
  try {
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

/** Dijalankan di halaman daftar SDC: periode dan tiap baris tantangan dengan tautan view dan Progress-nya. */
function readSdcList() {
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const period = (/\d+\.\d+\s*\/\s*\w+\s*\/\s*\d{4}\s*-\s*\d{4}/.exec(document.body.innerText) || [""])[0];
  const rows = [];
  for (const tr of document.querySelectorAll("table tr")) {
    const links = [...tr.querySelectorAll("a[href]")];
    const progress = links.find((a) => /my_commitment\/view_progress\//.test(a.href));
    const view = links.find((a) => /my_commitment\/view\//.test(a.href));
    if (!progress && !view) continue;
    rows.push({ name: text(tr.children[0]).replace(/\s*Theme:.*$/i, ""), view: view ? view.href : "", progress: progress ? progress.href : "" });
  }
  return { period, rows };
}

/**
 * Dijalankan di halaman Progress SDC: tabel mingguan. Tiap baris: [judul dengan target per minggu, uraian cara, menit minggu 1, 2, ...].
 * Isian menit dibaca dari nilai kolom isian (bukan dari teks sel, yang kosong). Baris terakhir "@closes" memuat kapan tiap minggu
 * ditutup (keterangan "Closed at 2026-11-16 13:09:00" di tiap kotak minggu); minggu CIS berjalan Senin sampai Senin.
 */
function readSdcProgress() {
  const table = [...document.querySelectorAll("table")].find((x) => /Week\s*-\s*1/i.test(x.innerText));
  if (!table) return { headers: [], rows: [] };
  const headers = [...table.querySelectorAll("th")].map((h) => h.innerText.replace(/\s+/g, " ").trim());
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD");
    if (cells.length < 2) continue;
    const lines = cells[0].innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    rows.push([lines[0] || "", lines.slice(1).join(" ").slice(0, 400), ...cells.slice(1).map((c) => {
      const field = c.querySelector("input,textarea,select");
      return (field ? String(field.value) : c.innerText).trim().slice(0, 20);
    })]);
  }
  const first = [...table.querySelectorAll("tr")].find((tr) => [...tr.children].filter((c) => c.tagName === "TD").length > 1);
  if (first) {
    const closes = [...first.children].filter((c) => c.tagName === "TD").slice(1).map((c) => (/Closed at\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/.exec(c.getAttribute("title") || "") || [])[1] || "");
    if (closes.some(Boolean)) rows.push(["@closes", "", ...closes]);
  }
  return { headers, rows };
}

/**
 * Membaca progres SDC: halaman daftar SDC, tautan Progress tantangan yang bukan "Revision", lalu tabel mingguannya; mengirimnya
 * sebagai kind "sdc"; dan berakhir di halaman daftar SDC. `nav(url)` memindahkan tab dan menunggu halaman termuat.
 */
export async function runSdc({ exec, post, nav }) {
  const listUrl = CIS.origin + CIS.sdc;
  await nav(listUrl);
  const list = await exec(readSdcList);
  const rows = (list?.rows ?? []).filter((r) => r.progress);
  const pick = rows.find((r) => !/revision|revisi/i.test(r.name)) ?? rows[0];
  if (!pick) throw new BridgeError("sdc_none", "SDC: tidak ada tantangan dengan halaman Progress");
  await nav(pick.progress);
  const prog = await exec(readSdcProgress);
  if (!prog?.rows?.length) throw new BridgeError("sdc_empty", "SDC: tabel progres tidak terbaca");
  await post("sdc", list.period || "", [{ headers: prog.headers.slice(0, 30), rows: prog.rows.slice(0, 50).map((r) => r.slice(0, 30)) }]);
  await nav(listUrl);
  return { period: list.period || "", challenges: prog.rows.length };
}

/**
 * Alur satu tombol di portal CIS: ke halaman Academic bila tab belum di sana, kirim nilai, jadwal, dan kehadiran, lalu SDC.
 * Bagian yang gagal dilaporkan, tidak menghentikan bagian lain.
 */
export async function runCis({ tabUrl, nav, exec, post, sleep }) {
  let onAcademic = false;
  try {
    onAcademic = new URL(tabUrl).pathname.startsWith(CIS.academic);
  } catch {
    /* anggap belum di Academic */
  }
  if (!onAcademic) await nav(CIS.origin + CIS.academic);
  const report = await runEverything({ exec, post, sleep });
  try {
    const sdc = await runSdc({ exec, post, nav });
    report.sdc = sdc;
    report.sent += 1;
    report.summary = [report.summary, `SDC ${sdc.challenges} tantangan`].filter(Boolean).join(", ");
  } catch (e) {
    report.failed.push(e?.message || String(e));
  }
  return report;
}

/** Tunggu tab selesai dimuat (paling lama `timeoutMs`), lalu beri jeda singkat untuk isi yang dimuat skrip halaman. */
function waitForLoad(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      setTimeout(resolve, 900);
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && finish();
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** Semua yang bisa diambil dari portal dikirim ke app Cognify di komputer ini. */
export async function sendAllPeriods(tab) {
  const token = await authed();
  const exec = async (func, args = [], world = "ISOLATED") => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args, world }))[0]?.result;
  const post = (kind, period, tables) =>
    call("/bridge/table", { method: "POST", token, body: { url: tab.url, title: tab.title, period: period.slice(0, 120), kind, tables } });
  let report;
  if (isCis(tab.url)) {
    const nav = async (url) => {
      const loaded = waitForLoad(tab.id);
      await chrome.tabs.update(tab.id, { url });
      await loaded;
    };
    report = await runCis({ tabUrl: tab.url, nav, exec, post });
  } else {
    report = await runEverything({ exec, post });
  }
  if (!report.sent) throw new BridgeError("no_tables", report.failed.join("; ") || t("noTables"));
  return report;
}

// ---- Kehadiran ----
// Data kehadiran bukan tabel di halaman, melainkan JSON kalender yang diminta halaman portal sendiri
// (.../load_my_attendance/1/0/<id siswa>?start=...&end=...). Permintaan itu dikirim dari dalam halaman portal,
// jadi login yang sudah ada dipakai browser otomatis; ekstensi tidak membaca cookie dan tidak ada token yang dikirim ke Cognify.

/** Dijalankan di halaman: mengambil kehadiran untuk tiap rentang tanggal. Tidak ada yang dikirim ke luar situs portal. */
async function readAttendance(ranges) {
  const html = document.documentElement.innerHTML;
  // Alamat dasar: utamanya yang tertulis di skrip halaman; bila tidak ada, dibangun dari id siswa yang tampak di halaman.
  const found = /https?:\/\/[^"'\s<>]*load_my_attendance\/[^"'\s?<>]+/.exec(html);
  let base = found ? found[0] : "";
  if (!base) {
    const reg = (/[?&]reg=([0-9a-f-]{36})/i.exec(html) || /['"]reg['"]\s*:\s*['"]([0-9a-f-]{36})['"]/i.exec(html) || [])[1];
    if (!reg) return { error: "no_reg" };
    base = `${location.origin}/index.php/school_dashboard/load_my_attendance/1/0/${reg}`;
  }
  const events = [];
  for (const [start, end] of ranges) {
    const url = `${base}${base.includes("?") ? "&" : "?"}start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    let resp;
    try {
      resp = await fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
    } catch {
      return { error: "network" };
    }
    if (!resp.ok) return { error: `http_${resp.status}` };
    let part;
    try {
      part = await resp.json();
    } catch {
      return { error: "not_json" };
    }
    if (Array.isArray(part)) events.push(...part);
  }
  return { events };
}

/** Acara kalender kehadiran → satu baris per hari: [tanggal, status, jam masuk, jam pulang]. Acara jam ("07:03:23 - 15:14:07") dipasangkan ke harinya. */
export function eventsToRows(events) {
  const by = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    const date = String(e?.start ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = by.get(date) ?? { date, status: "", inT: "", outT: "" };
    const title = String(e.title ?? "").trim();
    const time = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(title);
    if (time) {
      day.inT = time[1];
      day.outT = time[2] ?? "";
    } else if (!String(e.id ?? "").endsWith("_time") && title) day.status = title;
    by.set(date, day);
  }
  return [...by.values()].filter((d) => d.status).sort((a, b) => a.date.localeCompare(b.date)).map((d) => [d.date, d.status, d.inT, d.outT]);
}

/** Rentang minta per setengah tahun dari awal tahun ajaran tertua di dropdown sampai sebulan ke depan: [[start, end], ...] dalam ISO dengan zona waktu setempat. */
export function attendanceRanges(optionTexts, now = new Date()) {
  const years = optionTexts.map((x) => /(\d{4})\s*-\s*\d{4}/.exec(x)?.[1]).filter(Boolean).map(Number);
  const first = years.length ? Math.min(...years) : now.getFullYear() - 1;
  const off = -now.getTimezoneOffset();
  const tz = `${off >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00${tz}`;
  const stop = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const ranges = [];
  for (let start = new Date(first, 6, 1); start < stop; ) {
    const next = new Date(start.getFullYear(), start.getMonth() + 6, 1);
    ranges.push([iso(start), iso(next < stop ? next : stop)]);
    start = next;
  }
  return ranges;
}

/** Kehadiran semua tahun ajaran yang ada di dropdown portal, dikirim ke app Cognify di komputer ini. Mengembalikan jumlah hari. */
export async function sendAttendance({ exec, post, optionTexts }) {
  const out = await exec(readAttendance, [attendanceRanges(optionTexts)]);
  if (out?.error) throw new BridgeError("attendance_failed", `Kehadiran: ${out.error}`);
  const rows = eventsToRows(out?.events);
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 800) await post(rows.slice(i, i + 800));
  return rows.length;
}
