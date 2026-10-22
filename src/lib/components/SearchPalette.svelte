<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { backOut } from "svelte/easing";
  import { fade, fly, scale } from "svelte/transition";
  import { motionOff } from "$lib/motion";
  import { kindIcon } from "$lib/workspace/kinds";
  import { workspace } from "$lib/workspace/api";
  import type { SearchHit } from "$lib/workspace/types";

  let { open = $bindable(false) }: { open: boolean } = $props();

  // Masuk dan keluar dengan gerak; 0 bila animasi dimatikan.
  const dur = (ms: number) => (motionOff() ? 0 : ms);

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
  <div class="backdrop" role="presentation" transition:fade={{ duration: dur(150) }} onclick={() => (open = false)}>
    <div class="box" role="dialog" aria-label={tr("Cari halaman", "Search pages")} tabindex="-1" transition:scale={{ start: 0.93, duration: dur(220), easing: backOut }} onclick={(e) => e.stopPropagation()} {onkeydown}>
      <input bind:this={input} bind:value={query} oninput={onInput} placeholder={tr("Cari judul atau isi halaman", "Search page titles or contents")} aria-label={tr("Cari", "Search")} />
      {#if query.trim() && done && !hits.length}
        <p class="none">{tr("Tidak ada halaman yang cocok.", "No matching pages.")}</p>
      {/if}
      <ul>
        {#each hits as hit, i (hit.id)}
          {@const KindIcon = kindIcon(hit.kind)}
          <li in:fly={{ y: 8, duration: dur(200), delay: dur(Math.min(i, 8) * 28) }}>
            <button class:on={i === index} onmouseenter={() => (index = i)} onclick={() => choose(hit)}>
              <KindIcon size={15} />
              <span class="t">{hit.title || tr("Tanpa judul", "Untitled")}</span>
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
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .box {
    width: min(560px, 92vw);
    background: var(--surface);
    border: var(--edge-w) solid var(--edge);
    border-radius: var(--radius-lg);
    box-shadow: var(--lift-lg);
    overflow: hidden;
  }
  input {
    border: none;
    border-bottom: var(--edge-w) solid var(--edge);
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
