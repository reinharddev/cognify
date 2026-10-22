<script lang="ts">
  import { goto } from "$app/navigation";
  import { Plus } from "@lucide/svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { KIND_LABEL, kindIcon } from "$lib/workspace/kinds";
  import type { PageKind } from "$lib/workspace/types";

  // Isi sebuah folder: halaman di dalamnya (urutan sama dengan sidebar) dan tombol untuk menambah yang baru.
  let { id }: { id: string } = $props();

  const items = $derived(ws.nodes.filter((n) => n.parentId === id));
  const ADD: PageKind[] = ["doc", "board", "table", "folder"];

  async function add(kind: PageKind) {
    ws.toggle(id, true);
    const page = await ws.create(kind, id);
    await goto(`/p/${page.id}`);
  }

  const count = (nodeId: string) => ws.nodes.filter((n) => n.parentId === nodeId).length;
</script>

<div class="add" role="group" aria-label="Tambah ke folder">
  {#each ADD as kind (kind)}
    {@const Icon = kindIcon(kind)}
    <button onclick={() => add(kind)}><Plus size={13} /><Icon size={14} />{KIND_LABEL[kind]}</button>
  {/each}
</div>

{#if !items.length}
  <p class="empty">Folder ini masih kosong. Tambahkan dokumen, papan, tabel, atau folder lain dengan tombol di atas, atau seret halaman dari sidebar ke sini.</p>
{:else}
  <ul>
    {#each items as n, i (n.id)}
      {@const Icon = kindIcon(n.kind)}
      <li style:--i={i}>
        <a href="/p/{n.id}">
          <span class="k k-{n.kind}"><Icon size={16} /></span>
          <span class="t" class:untitled={!n.title}>{n.title || "Tanpa judul"}</span>
          {#if n.kind === "folder" && count(n.id)}<small>{count(n.id)} isi</small>{/if}
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .add { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0 var(--space-4); }
  .add button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 99px; cursor: pointer; }
  .add button:hover { border-color: var(--accent-strong); background: var(--accent-soft); }
  .empty { color: var(--text-muted); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  li { animation: rise var(--dur-3) var(--ease-out) backwards; animation-delay: calc(var(--i, 0) * 40ms); }
  a { display: flex; align-items: center; gap: 10px; padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); text-decoration: none; }
  a:hover { border-color: var(--accent-strong); transform: translateY(-2px); }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .untitled, small { color: var(--text-muted); }
  .k { display: inline-flex; }
  .k-doc { color: var(--kind-doc); }
  .k-board { color: var(--kind-board); }
  .k-table { color: var(--kind-table); }
  .k-folder { color: var(--kind-folder); }
</style>
