<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { Check, Download, ExternalLink, FolderOpen } from "@lucide/svelte";
  import type { MoodleFile, MoodleLink, MoodleModule } from "$lib/moodle/api";
  import { size, stem, tidy } from "$lib/moodle/format";

  let {
    modules,
    files,
    links,
    onsave,
    onopen,
    onurl,
  }: {
    modules: MoodleModule[];
    files: MoodleFile[];
    links: MoodleLink[];
    onsave: (ids: string[]) => void;
    onopen: (f: MoodleFile) => void;
    onurl: (url: string) => void;
  } = $props();

  /** Lencana jenis modul: [Indonesia, Inggris]. Jenis yang tidak dikenal memakai namanya sendiri. */
  const BADGE: Record<string, [string, string]> = {
    resource: ["BERKAS", "FILE"], folder: ["FOLDER", "FOLDER"], page: ["TEKS", "TEXT"], url: ["LINK", "LINK"], label: ["CATATAN", "NOTE"],
    quiz: ["KUIS", "QUIZ"], forum: ["FORUM", "FORUM"], assign: ["TUGAS", "TASK"], workshop: ["LOKAKARYA", "WORKSHOP"], choice: ["PILIHAN", "CHOICE"],
    feedback: ["UMPAN BALIK", "FEEDBACK"], lesson: ["PELAJARAN", "LESSON"], scorm: ["SCORM", "SCORM"], book: ["BUKU", "BOOK"], glossary: ["GLOSARIUM", "GLOSSARY"],
  };
  const badge = (k: string) => (BADGE[k] ? tr(BADGE[k][0], BADGE[k][1]) : k.toUpperCase().slice(0, 8));

  let openSec = $state<Record<string, boolean>>({});
  let openMod = $state<Record<string, boolean>>({});

  const groups = $derived.by(() => {
    const out: { id: string; name: string; summary: string; rows: MoodleModule[] }[] = [];
    for (const m of modules) {
      if (m.kind === "section") out.push({ id: m.id, name: m.name, summary: m.description, rows: [] });
      else {
        if (!out.length) out.push({ id: `top:${m.courseId}`, name: "", summary: "", rows: [] });
        out[out.length - 1].rows.push(m);
      }
    }
    return out;
  });

  const moduleId = (m: MoodleModule) => m.id.split(":")[1];
  const filesOf = (m: MoodleModule) => files.filter((f) => f.id.startsWith(`${m.courseId}:${moduleId(m)}:`));
  const bodyOf = (m: MoodleModule) => links.find((l) => l.kind === "page" && l.id === `page:${m.courseId}:${moduleId(m)}`)?.body ?? "";
  const linkOf = (m: MoodleModule) => links.find((l) => l.kind === "link" && l.id === `link:${m.courseId}:${moduleId(m)}`);
  const pct = (f: MoodleFile) => (f.size > 0 ? Math.min(100, Math.round((f.bytesDone / f.size) * 100)) : null);
  const isOpen = (id: string, index: number) => openSec[id] ?? index === 0;
</script>

<div class="struct">
  {#each groups as g, gi (g.id)}
    {@const open_ = isOpen(g.id, gi)}
    <div class="sec">
      <button class="head" aria-expanded={open_} onclick={() => (openSec[g.id] = !open_)}>
        <span class="chev" aria-hidden="true">{open_ ? "▾" : "▸"}</span>
        <span class="st" title={tidy(g.name)}>{tidy(g.name) || tr("Umum", "General")}</span>
        <span class="cnt">{g.rows.length}</span>
      </button>
    </div>
    {#if open_}
      {#if g.summary}<p class="summary">{g.summary}</p>{/if}
      <ul>
        {#each g.rows as m (m.id)}
          {@const fs = m.kind === "resource" || m.kind === "folder" ? filesOf(m) : []}
          {@const todo = fs.filter((f) => f.state === "remote" || f.state === "error")}
          {@const text = m.kind === "page" ? bodyOf(m) : ""}
          {@const lk = m.kind === "url" ? linkOf(m) : undefined}
          <li class:note={m.kind === "label"}>
            {#if m.kind === "label"}
              <p class="label">{m.description || m.name}</p>
            {:else}
              <span class="ext" aria-hidden="true">{badge(m.kind)}</span>
              <div class="main">
                <span class="fn" title={m.name}>{m.name || badge(m.kind)}</span>
                {#if m.kind === "resource" || m.kind === "folder"}
                  <small class="meta">{tr(`${fs.length || m.files} berkas`, `${fs.length || m.files} files`)}{#if fs.length}{" · "}{tr(`${fs.filter((f) => f.state === "done").length} tersimpan`, `${fs.filter((f) => f.state === "done").length} saved`)}{/if}</small>
                {:else if m.description}
                  <small class="meta clamp">{m.description}</small>
                {/if}
              </div>
              <div class="acts">
                {#if fs.length}
                  {#if todo.length}
                    <button class="ghost" onclick={() => onsave(todo.map((f) => f.id))}><Download size={14} />{tr("Simpan", "Save")}</button>
                  {:else}
                    <span class="ok" title={tr("Semua tersimpan", "All saved")}><Check size={15} /></span>
                  {/if}
                  <button class="ghost" onclick={() => (openMod[m.id] = !openMod[m.id])}>{openMod[m.id] ? tr("Tutup", "Close") : tr("Berkas", "Files")}</button>
                {:else if m.kind === "page" && text}
                  <button class="ghost" onclick={() => (openMod[m.id] = !openMod[m.id])}>{openMod[m.id] ? tr("Tutup", "Close") : tr("Baca", "Read")}</button>
                {:else if lk}
                  <button class="ghost icon" title={tr("Buka tautan", "Open link")} aria-label={tr("Buka tautan", "Open link")} onclick={() => onurl(lk.url)}><ExternalLink size={15} /></button>
                {:else if m.url}
                  <button class="ghost icon" title={tr("Buka di Moodle", "Open in Moodle")} aria-label={tr("Buka di Moodle", "Open in Moodle")} onclick={() => onurl(m.url)}><ExternalLink size={15} /></button>
                {/if}
              </div>
              {#if openMod[m.id]}
                <div class="expand">
                  {#if text}
                    <pre class="text">{text}</pre>
                  {:else}
                    <ul class="files">
                      {#each fs as f (f.id)}
                        <li class="file">
                          <span class="fn" title={f.filename}>{stem(f.filename)}</span>
                          <small class="meta">
                            {#if f.state === "downloading"}{pct(f) !== null ? `${pct(f)}%` : size(f.bytesDone)}
                            {:else if f.state === "queued"}{tr("Mengantre", "Queued")}
                            {:else}{size(f.size)}{/if}
                          </small>
                          {#if f.state === "done"}
                            <button class="ghost icon" title={tr("Buka", "Open")} aria-label={tr("Buka", "Open")} onclick={() => onopen(f)}><FolderOpen size={15} /></button>
                          {:else if f.state !== "queued" && f.state !== "downloading"}
                            <button class="ghost icon" title={tr("Simpan", "Save")} aria-label={tr("Simpan", "Save")} onclick={() => onsave([f.id])}><Download size={15} /></button>
                          {:else}<span></span>{/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="empty">{tr("Moodle tidak mengembalikan struktur apa pun untuk mata pelajaran ini.", "Moodle returned no structure for this course.")}</p>
  {/each}
</div>

<style>
  .sec { display: flex; align-items: center; margin-top: var(--space-4); border-bottom: 1px solid var(--border); }
  .head { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); background: none; border: 0; padding: var(--space-3) var(--space-0); cursor: pointer; text-align: left; font: inherit; color: var(--text); }
  .head:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; border-radius: var(--radius-sm); }
  .chev { color: var(--text-muted); width: var(--space-4); flex: none; font-size: 1.25em; line-height: 1; }
  .st { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cnt { flex: none; color: var(--text-muted); font-size: 0.85em; background: var(--surface-2); border-radius: var(--radius-pill); padding: 1px var(--space-2); font-variant-numeric: tabular-nums; }
  .summary { color: var(--text-muted); white-space: pre-wrap; overflow-wrap: anywhere; margin: var(--space-2) 0 0; }
  .empty { color: var(--text-muted); padding: var(--space-4) 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-2); border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
  li:hover { background: var(--surface-2); }
  li.note { display: block; }
  li.note:hover { background: none; }
  .label { margin: 0; color: var(--text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
  .ext { min-width: var(--space-6); text-align: center; font-size: 0.66em; font-weight: 600; letter-spacing: 0.04em; color: var(--text-muted); background: var(--surface-2); border-radius: var(--radius-2); padding: var(--space-1) var(--space-2); }
  .main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .meta.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; overflow-wrap: anywhere; }
  .acts { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-0); }
  .ok { color: var(--accent-strong); display: inline-flex; margin-right: var(--space-0); }
  .expand { grid-column: 1 / -1; padding: 0 0 var(--space-2); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: var(--space-3); background: var(--surface-2); border-radius: var(--radius-sm); font: inherit; overflow-y: auto; }
  .files li.file { grid-template-columns: minmax(0, 1fr) auto auto; padding: var(--space-2); }
  .ghost { display: inline-flex; align-items: center; gap: var(--space-1); background: none; border: 1px solid transparent; border-radius: var(--radius-pill); padding: var(--space-1) var(--space-3); cursor: pointer; color: var(--text); font: inherit; }
  .ghost:hover { background: var(--surface-2); border-color: var(--border); }
  .ghost.icon { padding: var(--space-2); border-radius: var(--radius-sm); }
  @media (max-width: 760px) { li { grid-template-columns: auto minmax(0, 1fr) auto; } }
</style>
