<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { Check, Sparkles, X } from "@lucide/svelte";
  import { proposals } from "$lib/stores/proposals.svelte";
  import { ws } from "$lib/stores/workspace.svelte";

  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const parentTitle = (id: string | null) => (id ? (ws.nodes.find((n) => n.id === id)?.title || tr("Tanpa judul", "Untitled")) : null);

  async function approve(id: string) {
    busy = id;
    error = null;
    try {
      const page = await proposals.approve(id);
      await ws.refresh();
      await goto(`/p/${page.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : tr("Usulan tidak bisa disetujui.", "The proposal could not be approved.");
    } finally {
      busy = null;
    }
  }

  async function reject(id: string) {
    busy = id;
    error = null;
    try {
      await proposals.reject(id);
    } catch (e) {
      error = e instanceof Error ? e.message : tr("Usulan tidak bisa ditolak.", "The proposal could not be rejected.");
    } finally {
      busy = null;
    }
  }
</script>

<div class="wrap">
  <h1>{tr("Usulan", "Proposals")}</h1>
  <p class="hint">{tr("AI yang terhubung lewat MCP hanya bisa mengusulkan. Halaman baru dibuat setelah kamu menyetujuinya di sini.", "An AI connected through MCP can only propose. A new page is created after you approve it here.")}</p>

  {#if error}<p class="err" role="alert">{error}</p>{/if}

  {#if proposals.items.length === 0}
    <div class="empty"><Sparkles size={22} /><p>{tr("Belum ada usulan. Saat AI mengusulkan halaman atas permintaanmu, usulannya muncul di sini.", "No proposals yet. When an AI proposes a page at your request, it shows up here.")}</p></div>
  {:else}
    <ul>
      {#each proposals.items as p (p.id)}
        <li>
          <div class="head">
            <strong>{p.title}</strong>
            <small>{p.source || "klien MCP"}{parentTitle(p.parentId) ? ` · di dalam ${parentTitle(p.parentId)}` : ""}</small>
          </div>
          <pre>{p.body || "(tanpa isi)"}</pre>
          <div class="actions">
            <button class="primary" disabled={busy === p.id} onclick={() => approve(p.id)}><Check size={15} /> {tr("Setujui dan buat halaman", "Approve and create page")}</button>
            <button disabled={busy === p.id} onclick={() => reject(p.id)}><X size={15} /> {tr("Tolak", "Reject")}</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 1.9em; margin-bottom: var(--space-2); }
  .hint { color: var(--text-muted); margin: 0 0 var(--space-4); }
  .err { background: var(--danger-soft); color: var(--danger); padding: var(--space-3); border-radius: var(--radius-sm); }
  .empty { display: flex; gap: var(--space-3); align-items: flex-start; color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }
  .empty p { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); }
  li { animation: rise var(--dur-3) var(--ease-out) backwards; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }
  .head { display: flex; flex-direction: column; gap: 2px; margin-bottom: var(--space-3); }
  .head small { color: var(--text-muted); }
  pre { white-space: pre-wrap; word-break: break-word; font: inherit; background: var(--surface-2); border-radius: var(--radius-sm); padding: var(--space-3); margin: 0 0 var(--space-3); max-height: 280px; overflow: auto; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .actions button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); background: none; border-radius: 99px; padding: 7px 16px; cursor: pointer; }
  .actions button.primary { background: var(--accent); color: var(--accent-contrast); border-color: transparent; font-weight: 600; }
  .actions button:hover:not(:disabled) { background: var(--surface-2); }
  .actions button.primary:hover:not(:disabled) { background: var(--accent-hover); }
  .actions button:disabled { opacity: 0.6; cursor: default; }
  .actions button:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
</style>
