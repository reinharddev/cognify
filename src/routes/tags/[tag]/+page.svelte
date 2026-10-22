<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { page } from "$app/state";
  import { Hash } from "@lucide/svelte";
  import { kindIcon } from "$lib/workspace/kinds";
  import { workspace } from "$lib/workspace/api";
  import type { PageNode } from "$lib/workspace/types";

  const tag = $derived(decodeURIComponent(page.params.tag ?? ""));
  let items = $state<PageNode[] | null>(null);

  $effect(() => {
    const t = tag;
    items = null;
    workspace.tags.pages(t).then((r) => {
      if (t === tag) items = r;
    }).catch(() => {
      if (t === tag) items = [];
    });
  });

  const icon = kindIcon;
</script>

<div class="wrap">
  <h1><Hash size={22} />{tag}</h1>
  {#if items === null}
    <p class="muted">{tr("Memuat…", "Loading…")}</p>
  {:else if !items.length}
    <p class="muted">{tr("Tidak ada halaman dengan tag ini.", "No pages with this tag.")}</p>
  {:else}
    <ul>
      {#each items as n, i (n.id)}
        {@const Icon = icon(n.kind)}
        <li style:--i={i}><a href="/p/{n.id}"><span class="k k-{n.kind}"><Icon size={16} /></span>{n.title || tr("Tanpa judul", "Untitled")}</a></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { display: flex; align-items: center; gap: 8px; font-size: 1.7em; margin-bottom: var(--space-4); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  li { animation: rise var(--dur-3) var(--ease-out) backwards; animation-delay: calc(var(--i, 0) * 40ms); }
  a { display: flex; align-items: center; gap: 10px; padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); text-decoration: none; }
  a:hover { border-color: var(--accent-strong); transform: translateY(-2px); }
  .k { display: inline-flex; }
  .k-doc { color: var(--kind-doc); }
  .k-board { color: var(--kind-board); }
  .k-table { color: var(--kind-table); }
  .k-folder { color: var(--kind-folder); }
</style>
