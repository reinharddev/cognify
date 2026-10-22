<script lang="ts">
  import { onMount } from "svelte";
  import { Copy, X } from "@lucide/svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { workspace } from "$lib/workspace/api";
  import type { PageSource, SourceMark } from "$lib/workspace/types";
  import { formatCitation, guessedFields, htmlToText, missingFields, STYLES, urlFromMarks, type CiteResult, type CslName, type CslSource, type StyleId } from "$lib/cite/cite";
  import { toBibtex, toCslJson, toRis } from "$lib/cite/export";

  // Panel Kutip: daftar pustaka dan sitasi dalam teks dari data sumber halaman ini, dengan data yang bisa dilengkapi tangan.
  // Judul dokumen adalah judul yang dikutip; mengubahnya di sini sama dengan mengubah judul halaman.
  let { pageId, title, onTitle, onClose }: { pageId: string; title: string; onTitle: (title: string) => void; onClose: () => void } = $props();

  const TYPES: [string, string][] = [
    ["article-journal", "Artikel jurnal"],
    ["webpage", "Halaman web"],
    ["article-newspaper", "Berita"],
    ["post-weblog", "Blog"],
    ["entry-encyclopedia", "Ensiklopedia"],
    ["article", "Preprint"],
    ["report", "Laporan"],
    ["thesis", "Skripsi, tesis, atau disertasi"],
    ["book", "Buku"],
    ["document", "Dokumen (mis. PDF)"],
  ];

  const STYLE_KEY = "cognify.cite.style";
  let styleId = $state<StyleId>(((): StyleId => {
    try {
      const saved = localStorage.getItem(STYLE_KEY) as StyleId | null;
      return STYLES.some((s) => s.id === saved) ? (saved as StyleId) : "apa";
    } catch {
      return "apa";
    }
  })());

  let loaded = $state(false);
  let source = $state<CslSource>({});
  let marks = $state<SourceMark[]>([]);
  let original = $state("");
  let result = $state<CiteResult | null>(null);
  let error = $state("");
  let copied = $state("");
  let showFields = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    try {
      const data: PageSource | null = await workspace.pages.source(pageId);
      source = (data?.source ?? {}) as CslSource;
      marks = data?.marks ?? [];
      original = String(source.title ?? "");
      showFields = !data;
    } catch {
      /* mulai dari data kosong */
    }
    loaded = true;
  });

  // Hitung ulang bila gaya, bahasa, data, atau judul berubah; hasil yang basi dibuang.
  let run = 0;
  $effect(() => {
    if (!loaded) return;
    const snapshot = $state.snapshot(effective) as CslSource;
    const style = styleId;
    const lang = i18n.lang;
    const t = title;
    const m = $state.snapshot(marks) as SourceMark[];
    const mine = ++run;
    formatCitation(snapshot, style, lang, t, m)
      .then((r) => {
        if (mine === run) {
          result = r;
          error = "";
        }
      })
      .catch((e) => {
        if (mine === run) error = e instanceof Error ? e.message : String(e);
      });
  });

  $effect(() => {
    try {
      localStorage.setItem(STYLE_KEY, styleId);
    } catch {
      /* hanya kenyamanan */
    }
  });

  /** Simpan perubahan data sumber; kolom yang disentuh tidak lagi ditandai "periksa". */
  function edit(patch: Partial<CslSource>, touched: string[] = []) {
    const guess = (source._guess ?? []).filter((g) => !touched.includes(g));
    source = { ...source, ...patch, _guess: guess.length ? guess : undefined };
    for (const k of Object.keys(source)) if (source[k] === undefined || source[k] === "") delete source[k];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void workspace.pages.setSource(pageId, $state.snapshot(source) as Record<string, unknown>).catch(() => undefined), 500);
  }

  const authors = $derived<CslName[]>(source.author ?? []);
  function setAuthor(i: number, family: string, given: string) {
    const next = authors.map((a) => ({ ...a }));
    next[i] = given.trim() ? { family: family.trim(), given: given.trim() } : { literal: family.trim() };
    edit({ author: next }, ["author"]);
  }
  const addAuthor = () => edit({ author: [...authors, { family: "", given: "" }] }, ["author"]);
  const removeAuthor = (i: number) => edit({ author: authors.filter((_, j) => j !== i) }, ["author"]);

  const date = $derived(source.issued?.["date-parts"]?.[0] ?? []);
  function setDate(part: number, value: string) {
    const parts = [date[0], date[1], date[2]];
    parts[part] = value.trim() ? Number(value) : (undefined as unknown as number);
    const trimmed = parts.slice(0, parts.findLastIndex((p) => p !== undefined && !Number.isNaN(p)) + 1);
    edit({ issued: trimmed.length && !Number.isNaN(trimmed[0]) ? { "date-parts": [trimmed] } : undefined }, ["issued"]);
  }

  /** Data untuk sitasi: bila URL kosong, dipakai alamat halaman dari penunjuk sorotan. */
  const effective = $derived<CslSource>(source.URL || source.DOI ? source : { ...source, URL: urlFromMarks(marks) });
  const missing = $derived(missingFields(effective, title));
  const guessed = $derived(guessedFields(source));
  const lang = $derived(i18n.lang);

  async function copyRich(key: string, html: string) {
    const plain = htmlToText(html);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
      } catch {
        return;
      }
    }
    flash(key);
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      /* salin manual dari tampilan */
    }
  }

  function flash(key: string) {
    copied = key;
    setTimeout(() => (copied = copied === key ? "" : copied), 1500);
  }

  const lastAccessed = $derived(marks.map((m) => m.accessed).filter(Boolean).sort().at(-1));
  const exports = $derived([
    { key: "bib", label: "BibTeX", text: () => toBibtex($state.snapshot(effective) as CslSource, title, lastAccessed) },
    { key: "ris", label: "RIS", text: () => toRis($state.snapshot(effective) as CslSource, title, lastAccessed) },
    { key: "json", label: "CSL-JSON", text: () => toCslJson($state.snapshot(effective) as CslSource, title, lastAccessed) },
  ]);

  /** Petunjuk isi sorotan dari alamat bagiannya: kata-kata awal yang disorot. */
  function hint(mark: SourceMark): string {
    const m = mark.url.match(/#:~:text=([^,&]*)/);
    if (!m) return mark.page ? `hlm. ${mark.page}` : "Sorotan";
    try {
      return `“${decodeURIComponent(m[1])}…”`;
    } catch {
      return "Sorotan";
    }
  }
  const where = (m: SourceMark) => (m.page ? `hlm. ${m.page}` : m.section ? `bagian “${m.section}”` : "");

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
  const field = (e: Event) => (e.currentTarget as HTMLInputElement).value;
</script>

<svelte:window onkeydown={onKey} />

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Kutip">
    <header>
      <h2>Kutip</h2>
      <label class="style">
        <span>Gaya</span>
        <select bind:value={styleId}>
          {#each STYLES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
        </select>
      </label>
      <button class="x" aria-label="Tutup" onclick={onClose}><X size={16} /></button>
    </header>

    {#if !loaded}
      <p class="muted">Memuat…</p>
    {:else}
      {#if missing.length || guessed.length}
        <div class="status" role="note">
          {#if missing.length}<p><b>Belum ada:</b> {missing.join(", ")}. Sitasi tetap dibuat dengan aturan gaya untuk data yang kurang; lengkapi di bawah bila kamu tahu.</p>{/if}
          {#if guessed.length}<p><b>Periksa:</b> {guessed.join(", ")}. Ini disimpulkan otomatis, bukan dibaca langsung dari sumber.</p>{/if}
        </div>
      {/if}

      <section>
        <h3>Daftar pustaka</h3>
        {#if error}
          <p class="err">{error}</p>
        {:else if result}
          <div class="out">{@html result.bibliography}</div>
          <button class="copy" onclick={() => copyRich("bib", result!.bibliography)}><Copy size={13} />{copied === "bib" ? "Tersalin" : "Salin"}</button>
        {/if}
      </section>

      <section>
        <h3>Dalam teks</h3>
        {#if result}
          {#if marks.length}
            <ul class="intext">
              {#each marks as m, i (m.url + i)}
                <li>
                  <div class="what"><span class="hint">{hint(m)}</span>{#if where(m)}<small>{where(m)}</small>{/if}</div>
                  <div class="cite">{result.inText[i]}</div>
                  <button class="copy" onclick={() => copyText(`t${i}`, result!.inText[i])}><Copy size={13} />{copied === `t${i}` ? "Tersalin" : "Salin"}</button>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="intext one">
              <div class="cite">{result.inTextBase}</div>
              <button class="copy" onclick={() => copyText("t", result!.inTextBase)}><Copy size={13} />{copied === "t" ? "Tersalin" : "Salin"}</button>
            </div>
          {/if}
          <p class="note">Sorotan ke PDF memakai nomor halaman; ke halaman web memakai judul bagian terdekat bila ada. Gaya catatan kaki (Chicago) menghasilkan isi catatan kakinya.</p>
        {/if}
      </section>

      <section>
        <button class="toggle" aria-expanded={showFields} onclick={() => (showFields = !showFields)}>{showFields ? "Sembunyikan data sumber" : "Lengkapi atau ubah data sumber"}</button>
        {#if showFields}
          <div class="fields">
            <label class="wide">
              <span>Judul <small>(ikut judul halaman)</small></span>
              <input value={title} oninput={(e) => onTitle(field(e))} />
              {#if original && original !== title}
                <small class="orig">Judul sumber aslinya: “{original}” <button class="link" onclick={() => onTitle(original)}>Pakai judul asli</button></small>
              {/if}
            </label>
            <label>
              <span>Jenis sumber</span>
              <select value={source.type ?? "webpage"} onchange={(e) => edit({ type: field(e) }, ["type"])}>
                {#each TYPES as [v, label] (v)}<option value={v}>{label}</option>{/each}
              </select>
            </label>

            <div class="wide authors">
              <span>Penulis <small>(isi nama keluarga saja untuk lembaga)</small></span>
              {#each authors as a, i (i)}
                <div class="row">
                  <input placeholder="Nama keluarga" value={a.family ?? a.literal ?? ""} oninput={(e) => setAuthor(i, field(e), a.given ?? "")} />
                  <input placeholder="Nama depan" value={a.given ?? ""} oninput={(e) => setAuthor(i, a.family ?? a.literal ?? "", field(e))} />
                  <button class="x" aria-label="Hapus penulis" onclick={() => removeAuthor(i)}><X size={14} /></button>
                </div>
              {/each}
              <button class="link" onclick={addAuthor}>+ Tambah penulis</button>
            </div>

            <div class="wide date">
              <span>Tanggal terbit</span>
              <div class="row">
                <input inputmode="numeric" placeholder="Tahun" value={date[0] ?? ""} oninput={(e) => setDate(0, field(e))} />
                <input inputmode="numeric" placeholder="Bulan" value={date[1] ?? ""} oninput={(e) => setDate(1, field(e))} />
                <input inputmode="numeric" placeholder="Tanggal" value={date[2] ?? ""} oninput={(e) => setDate(2, field(e))} />
              </div>
            </div>

            <label class="wide"><span>{source.type === "article-journal" ? "Nama jurnal" : "Nama situs atau terbitan"}</span><input value={source["container-title"] ?? ""} oninput={(e) => edit({ "container-title": field(e) }, ["container-title"])} /></label>
            <label class="wide"><span>Penerbit</span><input value={source.publisher ?? ""} oninput={(e) => edit({ publisher: field(e) })} /></label>
            <label><span>Volume</span><input value={source.volume ?? ""} oninput={(e) => edit({ volume: field(e) })} /></label>
            <label><span>Nomor (issue)</span><input value={source.issue ?? ""} oninput={(e) => edit({ issue: field(e) })} /></label>
            <label><span>Halaman artikel</span><input placeholder="143-158" value={source.page ?? ""} oninput={(e) => edit({ page: field(e) })} /></label>
            <label><span>DOI</span><input value={source.DOI ?? ""} oninput={(e) => edit({ DOI: field(e) })} /></label>
            <label class="wide"><span>URL</span><input placeholder={urlFromMarks(marks) ?? ""} value={source.URL ?? ""} oninput={(e) => edit({ URL: field(e) })} /></label>
          </div>
        {/if}
      </section>

      <section class="exports">
        <h3>Ekspor</h3>
        <p class="note">Untuk Zotero, Mendeley, EndNote, atau LaTeX.</p>
        <div class="row">
          {#each exports as e (e.key)}
            <button class="copy" onclick={() => copyText(e.key, e.text())}><Copy size={13} />{copied === e.key ? "Tersalin" : e.label}</button>
          {/each}
        </div>
      </section>
      <p class="note lang">Istilah dalam sitasi mengikuti bahasa app ({lang === "id" ? "Indonesia" : "Inggris"}). Gaya ISO 690 hanya tersedia dalam versi bahasa Inggris dari CSL.</p>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: start center; padding: var(--space-6) var(--space-4); background: color-mix(in srgb, var(--text) 35%, transparent); overflow-y: auto; animation: fade var(--dur-2) ease; }
  .panel { width: min(680px, 100%); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-4) var(--space-3); box-shadow: 0 18px 50px var(--shadow-2); animation: rise var(--dur-3) var(--ease-out) backwards; }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  h2 { margin: 0; font-size: 1.2em; flex: 1; }
  h3 { margin: var(--space-4) 0 var(--space-2); font-size: 0.85em; font-weight: 600; color: var(--text-muted); }
  .style { display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); font-size: 0.9em; }
  select, input { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; min-width: 0; }
  select:focus-visible, input:focus-visible { outline: none; border-color: var(--accent-strong); box-shadow: 0 0 0 3px var(--accent-soft); }
  .x { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; background: none; border: 0; border-radius: 99px; color: var(--text-muted); cursor: pointer; }
  .x:hover { background: var(--surface-2); }
  .status { background: var(--warn-soft); border-radius: var(--radius); padding: var(--space-2) var(--space-3); font-size: 0.9em; }
  .status p { margin: 2px 0; }
  .out { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); line-height: 1.55; user-select: text; overflow-wrap: anywhere; }
  .copy { display: inline-flex; align-items: center; gap: 5px; margin-top: var(--space-2); padding: 5px 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: 99px; cursor: pointer; font: inherit; font-size: 0.9em; }
  .copy:hover { background: var(--accent-soft); }
  .intext { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .intext li, .intext.one { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1) var(--space-3); align-items: center; padding: var(--space-2) var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .what { grid-column: 1 / -1; color: var(--text-muted); font-size: 0.85em; display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .hint { overflow-wrap: anywhere; }
  .cite { user-select: text; overflow-wrap: anywhere; }
  .intext .copy { margin: 0; }
  .toggle { background: none; border: 0; padding: 0; color: var(--link); cursor: pointer; font: inherit; text-decoration: underline; margin-top: var(--space-3); }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-3); }
  .fields label, .fields .authors, .fields .date { display: grid; gap: 4px; align-content: start; }
  .fields .wide { grid-column: 1 / -1; }
  .fields span { color: var(--text-muted); font-size: 0.85em; }
  .row { display: flex; gap: var(--space-2); align-items: center; }
  .row input { flex: 1; }
  .orig { color: var(--text-muted); }
  .link { background: none; border: 0; padding: 0; color: var(--link); cursor: pointer; font: inherit; text-align: left; }
  .note { color: var(--text-muted); font-size: 0.85em; margin: var(--space-1) 0; }
  .lang { margin-top: var(--space-4); }
  .muted { color: var(--text-muted); }
  .err { color: var(--danger); }
  @media (max-width: 560px) { .fields { grid-template-columns: 1fr; } }
</style>
