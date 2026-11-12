<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  import { openHref } from "$lib/openHref";
  import { ArrowDownToLine, Check, ChevronDown, RotateCw, X } from "@lucide/svelte";
  import { update, formatSize } from "$lib/stores/update.svelte";

  let showNotes = $state(false);
  /** Baris pertama catatan rilis yang berisi isi (tanpa judul markdown), untuk ringkasan singkat. */
  const summary = $derived(
    update.notes
      .split("\n")
      .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6),
  );
  const busy = $derived(update.stage === "downloading" || update.stage === "installing");
  const known = $derived(update.size > 0);
</script>

{#if update.cardVisible}
  <aside class="card" role="status" aria-live="polite">
    <div class="row">
      <span class="eyes" aria-hidden="true"><i></i><i></i></span>
      <div class="txt">
        <b>
          {#if update.stage === "ready"}
            {tr(`Cognify ${update.version} siap`, `Cognify ${update.version} is ready`)}
          {:else if update.stage === "installing"}
            {tr("Memasang…", "Installing…")}
          {:else}
            {tr(`Cognify ${update.version} tersedia`, `Cognify ${update.version} is available`)}
          {/if}
        </b>
        <small>
          {#if update.stage === "downloading"}
            {known ? `${formatSize(update.received)} / ${formatSize(update.size)} · ${update.percent}%` : tr("Mengunduh…", "Downloading…")}
          {:else if update.stage === "ready"}
            {update.autoOn ? tr("Terpasang saat Cognify ditutup.", "Installs when you close Cognify.") : tr("Pasang sekarang atau saat ditutup.", "Install now or when you close.")}
          {:else if update.stage === "installing"}
            {tr("Cognify akan mulai ulang sebentar lagi.", "Cognify will restart in a moment.")}
          {:else}
            {formatSize(update.size) || tr("Versi baru dari GitHub", "New version from GitHub")}
          {/if}
        </small>
      </div>
      {#if !busy}
        <button class="x" aria-label={tr("Tutup", "Dismiss")} title={tr("Tutup", "Dismiss")} onclick={() => (update.stage === "ready" ? (update.hideReady = true) : update.dismiss())}><X size={14} /></button>
      {/if}
    </div>

    {#if update.stage === "downloading" || update.stage === "installing"}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={update.stage === "installing" ? 100 : update.percent} aria-label={tr("Kemajuan unduhan", "Download progress")}>
        <i class:indet={update.stage === "downloading" && !known} style:width={update.stage === "installing" ? "100%" : known ? `${update.percent}%` : "40%"}></i>
      </div>
    {/if}

    {#if update.error}<p class="err">{update.error}</p>{/if}

    {#if summary.length && update.stage !== "installing"}
      <button class="notes-toggle" aria-expanded={showNotes} onclick={() => (showNotes = !showNotes)}>
        {tr("Apa yang baru", "What's new")}<ChevronDown size={13} class={showNotes ? "up" : ""} />
      </button>
      {#if showNotes}
        <ul class="notes">{#each summary as line}<li>{line}</li>{/each}</ul>
      {/if}
    {/if}

    {#if update.stage === "found"}
      <div class="actions">
        {#if update.selfUpdate}
          <button class="btn pri" onclick={() => update.installNow()}><ArrowDownToLine size={14} />{tr("Perbarui sekarang", "Update now")}</button>
          <button class="btn" onclick={() => update.download(true)}>{tr("Pasang saat ditutup", "On close")}</button>
        {:else}
          <button class="btn pri" onclick={() => openHref(update.url)}><ArrowDownToLine size={14} />{tr("Buka halaman unduhan", "Open download page")}</button>
        {/if}
        <button class="btn ghost" onclick={() => update.dismiss()}>{tr("Nanti", "Later")}</button>
      </div>
    {:else if update.stage === "ready"}
      <div class="actions">
        <button class="btn pri" onclick={() => update.installNow()}><RotateCw size={14} />{tr("Mulai ulang dan perbarui", "Restart and update")}</button>
        <span class="ok"><Check size={13} />{tr("Sudah diunduh", "Downloaded")}</span>
      </div>
    {/if}
  </aside>
{/if}

<style>
  /* Kartu bergaya Cognify Notch: hitam, pinggiran kaca, aksen pada mata dan bilah kemajuan. Sengaja gelap di tema terang dan gelap. */
  .card {
    --uc-bg: var(--notch-bg);
    --uc-text: var(--notch-text);
    --uc-dim: color-mix(in srgb, var(--notch-text) 62%, transparent);
    --uc-line: color-mix(in srgb, var(--notch-text) 12%, transparent);
    --uc-fill: color-mix(in srgb, var(--notch-text) 9%, transparent);
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 70;
    width: min(340px, calc(100vw - var(--space-4) * 2));
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--uc-bg);
    color: var(--uc-text);
    border-radius: var(--radius-4);
    box-shadow: 0 0 0 1px var(--uc-line), inset 0 1px 0 color-mix(in srgb, var(--notch-text) 16%, transparent), 0 var(--space-3) var(--space-5) color-mix(in srgb, var(--notch-bg) 60%, transparent);
    animation: in var(--dur-3) var(--ease-spring);
  }
  .row { display: flex; align-items: center; gap: var(--space-3); }
  .eyes { flex: none; display: flex; align-items: center; justify-content: center; gap: var(--space-1); width: var(--space-5); height: var(--space-5); border-radius: var(--radius-3); background: var(--uc-fill); }
  .eyes i { width: var(--space-1); height: var(--space-3); border-radius: var(--radius-2); background: var(--accent); animation: blink 4s infinite; }
  .txt { display: grid; gap: var(--space-0); min-width: 0; flex: 1; }
  b { font-weight: 600; font-size: 0.95em; }
  small { color: var(--uc-dim); font-size: 0.8em; font-variant-numeric: tabular-nums; }
  .x { background: none; border: 0; padding: var(--space-1); border-radius: var(--radius-2); color: var(--uc-dim); cursor: pointer; }
  .x:hover { background: var(--uc-fill); color: var(--uc-text); }
  .bar { height: var(--space-1); border-radius: var(--radius-2); background: var(--uc-fill); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: var(--radius-2); background: var(--accent); transition: width var(--dur-3) ease-out; }
  .bar i.indet { animation: slide 1.2s ease-in-out infinite alternate; }
  .err { margin: 0; color: var(--notch-warn); font-size: 0.8em; }
  .notes-toggle { display: inline-flex; align-items: center; gap: var(--space-1); background: none; border: 0; padding: 0; color: var(--uc-dim); font: inherit; font-size: 0.8em; cursor: pointer; justify-self: start; }
  .notes-toggle:hover { color: var(--uc-text); }
  .notes-toggle :global(.up) { transform: rotate(180deg); }
  .notes { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-0); color: var(--uc-dim); font-size: 0.8em; max-height: calc(var(--space-6) * 2); overflow: auto; }
  .actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: var(--space-1); border: 0; border-radius: var(--radius-pill); padding: var(--space-1) var(--space-3); background: var(--uc-fill); color: var(--uc-text); font: inherit; font-size: 0.85em; font-weight: 600; cursor: pointer; }
  .btn:hover { background: color-mix(in srgb, var(--notch-text) 16%, transparent); }
  .btn.pri { background: var(--accent); color: var(--accent-contrast); }
  .btn.pri:hover { background: var(--accent-hover); }
  .btn.ghost { background: none; color: var(--uc-dim); }
  .ok { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--uc-dim); font-size: 0.8em; }
  .card :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes in { from { opacity: 0; transform: translateY(var(--space-3)) scale(0.97); } to { opacity: 1; transform: none; } }
  @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
  @keyframes slide { from { margin-left: 0; } to { margin-left: 60%; } }
  @media (prefers-reduced-motion: reduce) { .card, .eyes i, .bar i, .bar i.indet { animation: none; transition: none; } }
</style>
