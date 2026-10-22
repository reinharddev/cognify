<script lang="ts">
  import { goto } from "$app/navigation";
  import { slide } from "svelte/transition";
  import { dur } from "$lib/motion";
  import { ChevronRight, ExternalLink, FileText, FolderOpen, FolderPlus, NotepadText, Plus, Shapes, Star, Table2, Trash2 } from "@lucide/svelte";
  import { kindIcon } from "$lib/workspace/kinds";
  import { contextMenu } from "$lib/stores/contextmenu.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { workspace } from "$lib/workspace/api";
  import { startPointerDrag } from "$lib/pointerDrag";
  import { planMove, type DropZone, type TreeNode } from "$lib/workspace/tree";
  import TreeRow from "./TreeRow.svelte";

  let { node, depth, activeId }: { node: TreeNode; depth: number; activeId: string | null } = $props();

  const open = $derived(ws.expanded.has(node.id));
  // Folder yang terbuka tampil sebagai folder terbuka.
  const Icon = $derived(node.kind === "folder" && open ? FolderOpen : kindIcon(node.kind));

  const over = $derived(ws.drag?.over?.id === node.id ? ws.drag.over.zone : null);
  let expandTimer: ReturnType<typeof setTimeout> | undefined;

  function zoneAt(box: DOMRect, y: number): DropZone {
    const r = (y - box.top) / box.height;
    return r < 0.28 ? "before" : r > 0.72 ? "after" : "inside";
  }

  /** Seret berbasis pointer: sasaran dicari dari elemen di bawah kursor. */
  function onPointerDown(event: PointerEvent) {
    if ((event.target as Element).closest("button, input")) return;
    const row = event.currentTarget as HTMLElement;
    startPointerDrag(event, row, {
      onStart: () => (ws.drag = { id: node.id, over: null }),
      onMove: (x, y) => {
        const drag = ws.drag;
        if (!drag) return;
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-node]");
        const targetId = el?.dataset.node;
        if (!el || !targetId) {
          clearTimeout(expandTimer);
          drag.over = null;
          return;
        }
        const zone = zoneAt(el.getBoundingClientRect(), y);
        if (!planMove(ws.nodes, drag.id, targetId, zone)) {
          clearTimeout(expandTimer);
          drag.over = null; // sasaran tidak sah
          return;
        }
        if (drag.over?.id !== targetId || drag.over.zone !== zone) {
          drag.over = { id: targetId, zone };
          // Menahan di atas halaman bersusun membukanya, supaya bisa menjatuhkan ke dalamnya.
          clearTimeout(expandTimer);
          if (zone === "inside" && el.dataset.kids === "1" && el.dataset.open !== "1") expandTimer = setTimeout(() => ws.toggle(targetId, true), 600);
        }
      },
      onEnd: async (_x, _y, cancelled) => {
        clearTimeout(expandTimer);
        const over = ws.drag?.over;
        const id = node.id;
        ws.drag = null;
        if (cancelled || !over) return;
        try {
          await ws.dropOn(id, over.id, over.zone);
        } catch {
          await ws.refresh();
        }
      },
    });
  }

  async function addChild(event: MouseEvent) {
    event.stopPropagation();
    const page = await ws.create("doc", node.id);
    await goto(`/p/${page.id}`);
  }

  async function trash() {
    const wasActive = activeId === node.id;
    await ws.trash(node.id);
    if (wasActive) await goto("/");
  }

  function remove(event: MouseEvent) {
    event.stopPropagation();
    void trash();
  }

  function onContext(event: MouseEvent) {
    contextMenu.show(event, [
      { label: "Buka", icon: ExternalLink, onclick: () => goto(`/p/${node.id}`) },
      ...(node.kind === "folder"
        ? ([
            ["doc", "Dokumen baru di dalam", FileText],
            ["board", "Papan baru di dalam", Shapes],
            ["table", "Tabel baru di dalam", Table2],
            ["folder", "Folder baru di dalam", FolderPlus],
          ] as const).map(([kind, label, icon]) => ({ label, icon, onclick: async () => goto(`/p/${(await ws.create(kind, node.id)).id}`) }))
        : [{ label: "Tambah halaman di dalam", icon: Plus, onclick: async () => goto(`/p/${(await ws.create("doc", node.id)).id}`) }]),
      { label: node.favorite ? "Hapus dari favorit" : "Jadikan favorit", icon: Star, onclick: () => ws.setFavorite(node.id, !node.favorite) },
      ...(node.kind === "doc" ? [{ label: "Jadikan catatan melayang", icon: NotepadText, onclick: () => void workspace.sticky.open(node.id) }] : []),
      { label: "Buang ke sampah", icon: Trash2, danger: true, separator: true, onclick: trash },
    ]);
  }
</script>

<div
  class="row"
  class:active={activeId === node.id}
  class:dragging={ws.drag?.id === node.id}
  class:drop-before={over === "before"}
  class:drop-after={over === "after"}
  class:drop-inside={over === "inside"}
  style:padding-left="{6 + depth * 14}px"
  oncontextmenu={onContext}
  role="presentation"
  data-node={node.id}
  data-kids={node.children.length ? "1" : "0"}
  data-open={open ? "1" : "0"}
  onpointerdown={onPointerDown}
>
  <button
    class="chev"
    class:open
    class:hidden={!node.children.length}
    aria-label={open ? "Tutup isi halaman" : "Buka isi halaman"}
    onclick={() => ws.toggle(node.id)}
  >
    <ChevronRight size={14} />
  </button>
  <a class="label" href="/p/{node.id}" draggable="false" ondragstart={(e) => e.preventDefault()}>
    {#if node.icon}<span class="emoji">{node.icon}</span>{:else}<span class="kind k-{node.kind}"><Icon size={15} /></span>{/if}
    <span class="title" class:untitled={!node.title}>{node.title || "Tanpa judul"}</span>
  </a>
  <span class="actions">
    <button aria-label="Tambah halaman di dalam" title="Tambah halaman di dalam" onclick={addChild}><Plus size={14} /></button>
    <button aria-label="Buang ke sampah" title="Buang ke sampah" onclick={remove}><Trash2 size={14} /></button>
  </span>
</div>

{#if open}
  <div class="kids" transition:slide={{ duration: dur(200) }}>
    {#each node.children as child (child.id)}
      <TreeRow node={child} depth={depth + 1} {activeId} />
    {/each}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 1.9em;
    padding-right: 4px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .row {
    position: relative;
  }
  .row.dragging {
    opacity: 0.45;
  }
  .row.drop-before::before,
  .row.drop-after::after {
    content: "";
    position: absolute;
    left: 6px;
    right: 6px;
    height: 3px;
    border-radius: 99px;
    background: var(--accent-strong);
    animation: fade var(--dur-1) ease both;
  }
  .row.drop-before::before {
    top: -2px;
  }
  .row.drop-after::after {
    bottom: -2px;
  }
  .row.drop-inside {
    background: var(--accent-soft);
    outline: 2px solid var(--accent-strong);
    outline-offset: -2px;
  }
  .row:hover {
    background: var(--surface);
  }
  .row.active {
    background: var(--surface);
    font-weight: 600;
  }
  button {
    display: grid;
    place-items: center;
    width: 1.6em;
    height: 1.6em;
    padding: 0;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    flex: none;
  }
  button:hover {
    background: var(--border);
    color: var(--text);
  }
  .chev :global(svg) {
    transition: transform var(--dur-2) var(--ease-spring);
  }
  .chev.open :global(svg) {
    transform: rotate(90deg);
  }
  .chev.hidden {
    visibility: hidden;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    color: inherit;
    text-decoration: none;
    padding: 2px 0;
  }
  .kind {
    display: inline-flex;
    flex: none;
  }
  .k-doc {
    color: var(--kind-doc);
  }
  .k-board {
    color: var(--kind-board);
  }
  .k-table {
    color: var(--kind-table);
  }
  .k-folder {
    color: var(--kind-folder);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .untitled {
    color: var(--text-muted);
  }
  .actions {
    display: none;
    flex: none;
  }
  .row:hover .actions,
  .row:focus-within .actions {
    display: flex;
  }
</style>
