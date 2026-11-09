<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { CalendarClock, GraduationCap, Info, X } from "@lucide/svelte";
  import { notifications } from "$lib/stores/notifications.svelte";

  const ICONS = { event: CalendarClock, moodle: GraduationCap, info: Info } as const;
</script>

<div class="stack" aria-live="polite">
  {#each notifications.toasts as t (t.id)}
    {@const Icon = ICONS[t.kind]}
    <div class="toast">
      <button
        class="open"
        onclick={async () => {
          notifications.markRead(t.id);
          notifications.dismissToast(t.id);
          if (t.href) await goto(t.href);
        }}
      >
        <span class="tile k-{t.kind}"><Icon size={16} /></span>
        <span class="txt">
          <b>{t.title}</b>
          {#if t.body}<small>{t.body}</small>{/if}
        </span>
      </button>
      <button class="x" aria-label={tr("Tutup", "Dismiss")} title={tr("Tutup", "Dismiss")} onclick={() => notifications.dismissToast(t.id)}><X size={13} /></button>
    </div>
  {/each}
</div>

<style>
  button { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; }
  .stack {
    position: fixed;
    top: var(--space-4);
    right: var(--space-4);
    z-index: 60;
    display: grid;
    gap: var(--space-2);
    width: min(360px, calc(100vw - var(--space-4) * 2));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-4);
    box-shadow: 0 var(--space-3) var(--space-5) color-mix(in srgb, var(--text) 18%, transparent);
    animation: in var(--dur-3) var(--ease-spring);
  }
  .open {
    width: 100%;
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-5) var(--space-3) var(--space-3);
    text-align: left;
    border-radius: var(--radius-4);
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.6em;
    height: 2.6em;
    border-radius: var(--radius-3);
  }
  .k-event { background: var(--kind-calendar-soft); color: var(--kind-calendar); }
  .k-moodle { background: var(--info-soft); color: var(--info); }
  .k-info { background: var(--accent-soft); color: var(--link); }
  .txt { display: grid; gap: var(--space-0); min-width: 0; }
  .txt b {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    line-height: 1.3;
  }
  .txt small { color: var(--text-muted); overflow-wrap: anywhere; }
  .x {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  @media (hover: hover) {
    .x:hover { background: var(--surface-2); color: var(--text); }
  }
  @keyframes in { from { opacity: 0; transform: translateY(calc(var(--space-3) * -1)) scale(0.97); } }
</style>
