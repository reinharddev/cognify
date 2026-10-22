<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import NotchIcon from "./NotchIcon.svelte";
  import { CalendarDays, FileText, Folder, Hash, Home, Inbox, Plus, Search, Settings, Shapes, Star, Table2, Trash2, Wrench } from "@lucide/svelte";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { proposals } from "$lib/stores/proposals.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import type { PageKind } from "$lib/workspace/types";
  import TreeRow from "./TreeRow.svelte";

  let { onsearch }: { onsearch: () => void } = $props();

  let menu = $state(false);
  const activeId = $derived(page.route.id === "/p/[id]" ? (page.params.id ?? null) : null);
  const path = $derived(page.url.pathname);
  const is = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const KINDS = $derived<{ kind: PageKind; label: string; icon: typeof FileText }[]>([
    { kind: "doc", label: tr("Dokumen", "Document"), icon: FileText },
    { kind: "board", label: tr("Papan", "Board"), icon: Shapes },
    { kind: "table", label: tr("Tabel", "Table"), icon: Table2 },
    { kind: "folder", label: tr("Folder", "Folder"), icon: Folder },
  ]);

  async function create(kind: PageKind) {
    menu = false;
    const created = await ws.create(kind);
    await goto(`/p/${created.id}`);
  }
</script>

<svelte:window onclick={() => (menu = false)} />

<aside>
  <div class="ws">
    <span class="avatar">R</span>
    <strong>{tr("Ruang saya", "My space")}</strong>
  </div>

  <button class="search" onclick={onsearch}>
    <span><Search size={15} /> {tr("Cari", "Search")}</span>
    <kbd>Ctrl K</kbd>
  </button>

  <nav>
    <a href="/" class:on={is("/")}><Home size={16} />{tr("Beranda", "Home")}</a>
    <a href="/calendar" class="k-calendar" class:on={is("/calendar")}><CalendarDays size={16} />{tr("Kalender", "Calendar")}</a>
    <a href="/notch" class="k-notch" class:on={is("/notch")}><NotchIcon size={16} />Notch</a>
    <a href="/tools" class:on={is("/tools")}><Wrench size={16} />{tr("Alat", "Tools")}</a>
    {#if prefs.value.mcp.propose || proposals.count > 0}
      <a href="/proposals" class:on={is("/proposals")}><Inbox size={16} />{tr("Usulan", "Proposals")}{#if proposals.count > 0}<span class="badge" aria-label="{proposals.count} {tr("usulan menunggu", "proposals pending")}">{proposals.count}</span>{/if}</a>
    {/if}
  </nav>

  {#if ws.favorites.length}
    <div class="sec">{tr("Favorit", "Favorites")}</div>
    {#each ws.favorites as fav (fav.id)}
      <a class="fav" class:on={activeId === fav.id} href="/p/{fav.id}"><Star size={14} /><span>{fav.title || tr("Tanpa judul", "Untitled")}</span></a>
    {/each}
  {/if}

  <div class="sec head">
    <span>{tr("Halaman", "Pages")}</span>
    <span class="new">
      <button
        aria-label={tr("Halaman baru", "New page")}
        title={tr("Halaman baru", "New page")}
        onclick={(e) => {
          e.stopPropagation();
          menu = !menu;
        }}><Plus size={15} /></button
      >
      {#if menu}
        <div class="menu" role="menu">
          {#each KINDS as k (k.kind)}
            <button role="menuitem" onclick={() => create(k.kind)}><k.icon size={15} />{k.label}</button>
          {/each}
        </div>
      {/if}
    </span>
  </div>

  <div class="tree" data-stagger>
    {#if !ws.tree.length}
      <p class="empty">{tr("Belum ada halaman. Tekan + untuk membuat yang pertama.", "No pages yet. Press + to create the first one.")}</p>
    {/if}
    {#each ws.tree as node (node.id)}
      <TreeRow {node} depth={0} {activeId} />
    {/each}
  </div>

  {#if ws.tags.length}
    <div class="sec">Tag</div>
    <div class="tagcloud" data-stagger>
      {#each ws.tags.slice(0, 16) as t (t.tag.toLowerCase())}
        <a href="/tags/{encodeURIComponent(t.tag)}" class:on={path === `/tags/${encodeURIComponent(t.tag)}`}><Hash size={11} />{t.tag}<small>{t.count}</small></a>
      {/each}
    </div>
  {/if}

  <nav class="foot">
    <a href="/trash" class:on={is("/trash")}><Trash2 size={16} />{tr("Sampah", "Trash")}</a>
    <a href="/settings" class:on={is("/settings")}><Settings size={16} />{tr("Pengaturan", "Settings")}</a>
  </nav>
</aside>

<style>
  aside {
    width: var(--sidebar-w);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3) var(--space-2);
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .ws {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px 6px var(--space-2);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    border-radius: 7px;
    background: var(--accent);
    color: var(--accent-contrast);
    border: var(--edge-w) solid var(--edge);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 0.9em;
  }
  .search {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 8px;
    margin-bottom: 4px;
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .search span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .search:hover {
    box-shadow: var(--lift);
    transform: translate(var(--hop), var(--hop));
  }
  kbd {
    font: inherit;
    font-size: 0.8em;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  nav a,
  .fav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    text-decoration: none;
  }
  nav a :global(svg),
  .fav :global(svg) {
    color: var(--text-muted);
    flex: none;
  }
  nav a.k-calendar :global(svg) {
    color: var(--kind-calendar);
  }
  nav a.k-notch :global(svg) {
    color: var(--kind-notch);
  }
  .fav :global(svg) {
    color: var(--warn);
  }
  nav a:hover,
  .fav:hover {
    background: var(--surface);
  }
  .tagcloud { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 var(--space-2) var(--space-2); max-height: 110px; overflow: auto; }
  .tagcloud a { display: inline-flex; align-items: center; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 99px; padding: 1px 8px 1px 6px; font-size: 0.82em; color: var(--text); text-decoration: none; }
  .tagcloud a:hover, .tagcloud a.on { border-color: var(--accent-strong); background: var(--accent-soft); }
  .tagcloud small { color: var(--text-muted); margin-left: 3px; }
  .badge { animation: pop var(--dur-3) var(--ease-spring) both; margin-left: auto; background: var(--accent); color: var(--accent-contrast); border-radius: 99px; font-size: 0.75em; font-weight: 700; padding: 0 7px; line-height: 1.6; }
  nav a.on,
  .fav.on {
    background: var(--accent-soft);
    font-weight: 700;
    box-shadow: inset 0 0 0 var(--edge-w) var(--edge), var(--lift);
  }
  .fav span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sec {
    padding: 12px 8px 3px;
    font-size: 0.82em;
    color: var(--text-muted);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-right: 4px;
  }
  .new {
    position: relative;
  }
  .new > button {
    display: grid;
    place-items: center;
    width: 1.7em;
    height: 1.7em;
    padding: 0;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .new > button:hover {
    background: var(--border);
    color: var(--text);
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 20;
    min-width: 9.5em;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: none;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .tree {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .empty {
    margin: 4px 8px;
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .foot {
    margin-top: auto;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }
</style>
