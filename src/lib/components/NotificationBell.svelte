<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { goto } from "$app/navigation";
  import { Bell, BellOff, CalendarClock, CheckCheck, GraduationCap, Info, Trash2, X } from "@lucide/svelte";
  import { notifications, type AppNotification } from "$lib/stores/notifications.svelte";
  import { clock, longDate } from "$lib/calendar/dates";

  const ICONS = { event: CalendarClock, moodle: GraduationCap, info: Info } as const;
  let filter = $state<"all" | "unread">("all");

  const shown = $derived(filter === "unread" ? notifications.items.filter((n) => !n.read) : notifications.items);
  const fresh = $derived(shown.filter((n) => !n.read));
  const earlier = $derived(shown.filter((n) => n.read));

  function when(at: number): string {
    const diff = Date.now() - at;
    if (diff < 60_000) return tr("Baru saja", "Just now");
    if (diff < 3_600_000) return tr(`${Math.floor(diff / 60_000)} mnt`, `${Math.floor(diff / 60_000)}m`);
    if (diff < 86_400_000) return clock(at);
    return longDate(at);
  }

  async function openItem(n: AppNotification) {
    notifications.markRead(n.id);
    if (n.href) {
      notifications.open = false;
      await goto(n.href);
    }
  }
</script>

<svelte:window
  onclick={() => (notifications.open = false)}
  onkeydown={(e) => e.key === "Escape" && (notifications.open = false)}
/>

{#snippet row(n: AppNotification)}
  {@const Icon = ICONS[n.kind]}
  {@const missed = n.body.startsWith("Terlewat")}
  <li class="item" class:unread={!n.read}>
    <button class="open" onclick={() => openItem(n)}>
      <span class="tile k-{n.kind}"><Icon size={16} /></span>
      <span class="txt">
        <span class="top">
          <b>{n.title}</b>
          <time>{when(n.at)}</time>
        </span>
        {#if n.body}<span class="body">{#if missed}<span class="late">{tr("Terlewat", "Missed")}</span>{n.body.replace(/^Terlewat · /, "")}{:else}{n.body}{/if}</span>{/if}
      </span>
      {#if !n.read}<span class="dot" role="img" aria-label={tr("Belum dibaca", "Unread")}></span>{/if}
    </button>
    <button class="x" aria-label={tr("Hapus", "Remove")} title={tr("Hapus", "Remove")} onclick={() => notifications.remove(n.id)}><X size={13} /></button>
  </li>
{/snippet}

<div class="wrap">
  <button
    class="bell"
    class:has={notifications.unread > 0}
    aria-label={notifications.unread
      ? tr(`Notifikasi, ${notifications.unread} belum dibaca`, `Notifications, ${notifications.unread} unread`)
      : tr("Notifikasi", "Notifications")}
    aria-expanded={notifications.open}
    title={tr("Notifikasi", "Notifications")}
    onclick={(e) => {
      e.stopPropagation();
      notifications.open = !notifications.open;
    }}
  >
    <Bell size={16} />
    {#if notifications.unread > 0}<span class="count">{notifications.unread > 99 ? "99+" : notifications.unread}</span>{/if}
  </button>

  {#if notifications.open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="panel" role="dialog" tabindex="-1" aria-label={tr("Notifikasi", "Notifications")} onclick={(e) => e.stopPropagation()}>
      <header>
        <strong>{tr("Notifikasi", "Notifications")}</strong>
        <span class="acts">
          <button aria-label={tr("Tandai semua dibaca", "Mark all as read")} title={tr("Tandai semua dibaca", "Mark all as read")} disabled={!notifications.unread} onclick={() => notifications.markAllRead()}><CheckCheck size={15} /></button>
          <button aria-label={tr("Hapus semua", "Clear all")} title={tr("Hapus semua", "Clear all")} disabled={!notifications.items.length} onclick={() => notifications.clear()}><Trash2 size={15} /></button>
        </span>
      </header>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={filter === "all"} class:on={filter === "all"} onclick={() => (filter = "all")}>{tr("Semua", "All")}</button>
        <button role="tab" aria-selected={filter === "unread"} class:on={filter === "unread"} onclick={() => (filter = "unread")}>{tr("Belum dibaca", "Unread")}{#if notifications.unread}<i>{notifications.unread}</i>{/if}</button>
      </div>
      {#if shown.length === 0}
        <div class="empty">
          <span class="bubble"><BellOff size={20} /></span>
          <b>{filter === "unread" ? tr("Semua sudah dibaca", "All caught up") : tr("Belum ada notifikasi", "No notifications yet")}</b>
          <small>{tr("Pengingat acara dan tenggat tugas muncul di sini.", "Event reminders and assignment deadlines show up here.")}</small>
        </div>
      {:else}
        <div class="scroll">
          {#if fresh.length}
            <h3>{tr("Baru", "New")}</h3>
            <ul>{#each fresh as n (n.id)}{@render row(n)}{/each}</ul>
          {/if}
          {#if earlier.length}
            <h3>{tr("Sebelumnya", "Earlier")}</h3>
            <ul>{#each earlier as n (n.id)}{@render row(n)}{/each}</ul>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  button { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; }
  .wrap { position: relative; margin-left: auto; }
  .bell {
    position: relative;
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .bell.has { color: var(--text); }
  @media (hover: hover) {
    .bell:hover { background: var(--surface-2); color: var(--text); }
  }
  .count {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 1.45em;
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--danger);
    color: var(--surface);
    border: 2px solid var(--bg);
    font-size: 0.68em;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
    transform: translate(35%, -25%);
  }
  .panel {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    z-index: 50;
    width: min(380px, calc(100vw - var(--space-4) * 2));
    max-height: min(540px, 76vh);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-4);
    box-shadow: 0 var(--space-3) var(--space-5) color-mix(in srgb, var(--text) 16%, transparent);
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-3) var(--space-2) var(--space-4);
  }
  header strong { font-size: 1.1em; }
  .acts { display: flex; gap: var(--space-1); }
  .acts button {
    display: grid;
    place-items: center;
    width: 2em;
    height: 2em;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .acts button:disabled { opacity: 0.4; cursor: not-allowed; }
  @media (hover: hover) {
    .acts button:not(:disabled):hover { background: var(--surface-2); color: var(--text); }
  }
  .tabs { display: flex; gap: var(--space-1); padding: 0 var(--space-4) var(--space-2); }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-weight: 600;
  }
  .tabs button.on { background: var(--accent-soft); color: var(--link); }
  .tabs i {
    font-style: normal;
    font-size: 0.8em;
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--link);
    color: var(--surface);
  }
  .scroll { overflow-y: auto; padding: 0 var(--space-2) var(--space-3); }
  h3 {
    margin: var(--space-2) var(--space-2) var(--space-1);
    font-size: 0.78em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-0); }
  .item { position: relative; border-radius: var(--radius-3); }
  .open {
    width: 100%;
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    padding: var(--space-3);
    text-align: left;
    border-radius: var(--radius-3);
  }
  .item.unread .open { background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface)); }
  @media (hover: hover) {
    .open:hover { background: var(--surface-2); }
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.4em;
    height: 2.4em;
    border-radius: var(--radius-3);
    background: var(--surface-2);
  }
  .k-event { background: var(--kind-calendar-soft); color: var(--kind-calendar); }
  .k-moodle { background: var(--info-soft); color: var(--info); }
  .k-info { background: var(--accent-soft); color: var(--link); }
  .txt { flex: 1; min-width: 0; display: grid; gap: var(--space-0); }
  .top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
  .top b {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    line-height: 1.3;
  }
  time { flex: none; font-size: 0.8em; color: var(--text-muted); }
  .body { font-size: 0.9em; color: var(--text-muted); overflow-wrap: anywhere; }
  .late {
    margin-right: var(--space-1);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 0.85em;
    font-weight: 700;
  }
  .dot {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--accent-strong);
  }
  .x {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--dur-1) ease;
  }
  .item:hover .x, .x:focus-visible { opacity: 1; }
  .item:hover time { visibility: hidden; }
  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    padding: var(--space-5) var(--space-4) var(--space-6);
    text-align: center;
  }
  .empty small { color: var(--text-muted); }
  .bubble {
    display: grid;
    place-items: center;
    width: 3.2em;
    height: 3.2em;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-muted);
  }
  @keyframes pop { from { opacity: 0; transform: translateY(calc(var(--space-1) * -1)) scale(0.98); } }
</style>
