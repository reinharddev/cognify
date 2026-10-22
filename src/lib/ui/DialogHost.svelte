<script lang="ts">
  import { tick } from "svelte";
  import { dialog } from "$lib/stores/dialog.svelte";

  let input = $state<HTMLInputElement>();
  let okBtn = $state<HTMLButtonElement>();

  $effect(() => {
    if (!dialog.current) return;
    void tick().then(() => (dialog.current?.kind === "prompt" ? (input?.focus(), input?.select()) : okBtn?.focus()));
  });

  function onkeydown(e: KeyboardEvent) {
    if (!dialog.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dialog.answer(false);
    } else if (e.key === "Enter" && dialog.current.kind === "prompt") {
      e.preventDefault();
      dialog.answer(true);
    }
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if dialog.current}
  {@const d = dialog.current}
  <div class="scrim" role="presentation" onpointerdown={() => dialog.answer(false)} oncontextmenu={(e) => e.preventDefault()}>
    <div class="box" role="alertdialog" aria-modal="true" aria-label={d.message} tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
      <p class="msg">{d.message}</p>
      {#if d.detail}<p class="detail">{d.detail}</p>{/if}
      {#if d.kind === "prompt"}<input bind:this={input} bind:value={d.value} aria-label={d.message} spellcheck="false" />{/if}
      <div class="actions">
        <button type="button" class="btn" onclick={() => dialog.answer(false)}>{d.cancelLabel}</button>
        <button type="button" bind:this={okBtn} class="btn" class:btn-primary={!d.danger} class:danger={d.danger} onclick={() => dialog.answer(true)}>{d.okLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, var(--text) 38%, transparent);
    animation: fade var(--dur-2) both;
  }
  .box {
    width: min(420px, 100%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 16px 48px var(--shadow-4);
    animation: pop var(--dur-2) var(--ease-out) both;
    outline: none;
  }
  .msg { margin: 0; font-weight: 600; line-height: 1.4; }
  .detail { margin: 0; color: var(--text-muted); line-height: 1.45; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .btn { justify-content: center; cursor: pointer; }
  .danger { background: var(--danger); border-color: var(--danger); color: var(--surface); font-weight: 600; }
</style>
