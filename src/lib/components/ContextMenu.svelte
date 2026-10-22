<script lang="ts">
  import { tick } from "svelte";
  import { contextMenu as cm } from "$lib/stores/contextmenu.svelte";

  let el = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);

  // Geser bila menu hampir keluar dari jendela.
  $effect(() => {
    if (!cm.open) return;
    left = cm.x;
    top = cm.y;
    void tick().then(() => {
      if (!el) return;
      // Ukuran asli (offset*), bukan getBoundingClientRect: animasi masuk mengecilkan kotaknya sesaat.
      left = Math.max(4, Math.min(cm.x, window.innerWidth - el.offsetWidth - 8));
      top = Math.max(4, Math.min(cm.y, window.innerHeight - el.offsetHeight - 8));
      el.querySelector<HTMLButtonElement>("button")?.focus();
    });
  });

  async function pick(onclick: () => void | Promise<void>) {
    cm.close();
    await onclick();
  }

  function onkeydown(event: KeyboardEvent) {
    if (!cm.open) return;
    if (event.key === "Escape") return void cm.close();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(el?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }
</script>

<svelte:window {onkeydown} onblur={() => cm.close()} onresize={() => cm.close()} />

{#if cm.open}
  <div class="backdrop" role="presentation" onpointerdown={() => cm.close()} oncontextmenu={(e) => { e.preventDefault(); cm.close(); }}></div>
  <div class="menu" role="menu" bind:this={el} style:left="{left}px" style:top="{top}px">
    {#each cm.items as item (item.label)}
      {#if item.separator}<hr />{/if}
      <button role="menuitem" class:danger={item.danger} onclick={() => pick(item.onclick)}>
        {#if item.icon}<item.icon size={15} />{:else}<span class="gap"></span>{/if}
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
  }
  .menu {
    position: fixed;
    z-index: 91;
    min-width: 12em;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    transform-origin: top left;
    animation: pop var(--dur-2) var(--ease-out) both;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--surface-2);
    outline: none;
  }
  button.danger {
    color: var(--danger);
  }
  button :global(svg) {
    color: var(--text-muted);
    flex: none;
  }
  button.danger :global(svg) {
    color: inherit;
  }
  .gap {
    width: 15px;
    flex: none;
  }
  hr {
    margin: 4px 6px;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
