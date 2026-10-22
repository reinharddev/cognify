<script lang="ts">
  import { goto } from "$app/navigation";
  import { kindIcon } from "$lib/workspace/kinds";
  import { workspace } from "$lib/workspace/api";
  import type { SearchHit } from "$lib/workspace/types";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let query = $state("");
  let hits = $state<SearchHit[]>([]);
  let index = $state(0);
  let done = $state(false);
  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  $effect(() => {
    if (open) {
      query = "";
      hits = [];
      index = 0;
      done = false;
      queueMicrotask(() => input?.focus());
    }
  });

  function onInput() {
    clearTimeout(timer);
    done = false;
    const mine = ++seq;
    timer = setTimeout(async () => {
      const found = query.trim() ? await workspace.pages.search(query, 12).catch(() => []) : [];
      if (mine === seq) {
        hits = found;
        index = 0;
        done = true;
      }
    }, 120);
  }

  async function choose(hit: SearchHit | undefined) {
    if (!hit) return;
    open = false;
    await goto(`/p/${hit.id}`);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") open = false;
    else if (event.key === "ArrowDown") (event.preventDefault(), (index = Math.min(index + 1, hits.length - 1)));
    else if (event.key === "ArrowUp") (event.preventDefault(), (index = Math.max(index - 1, 0)));
    else if (event.key === "Enter") void choose(hits[index]);
  }
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={() => (open = false)}>
    <div class="box" role="dialog" aria-label="Cari halaman" tabindex="-1" onclick={(e) => e.stopPropagation()} {onkeydown}>
      <input bind:this={input} bind:value={query} oninput={onInput} placeholder="Cari judul atau isi halaman" aria-label="Cari" />
      {#if query.trim() && done && !hits.length}
        <p class="none">Tidak ada halaman yang cocok.</p>
      {/if}
      <ul>
        {#each hits as hit, i (hit.id)}
          {@const KindIcon = kindIcon(hit.kind)}
          <li>
            <button class:on={i === index} onmouseenter={() => (index = i)} onclick={() => choose(hit)}>
              <KindIcon size={15} />
              <span class="t">{hit.title || "Tanpa judul"}</span>
              {#if hit.snippet}<span class="s">{hit.snippet}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    animation: fade var(--dur-2) ease both;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .box {
    width: min(560px, 92vw);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out) both;
  }
  input {
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    font-size: 1.1em;
  }
  input:focus {
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 50vh;
    overflow-y: auto;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: pointer;
  }
  li button.on {
    background: var(--surface-2);
  }
  .t {
    flex: none;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .s {
    color: var(--text-muted);
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--text-muted);
  }
</style>
