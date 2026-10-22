<script lang="ts" generics="T">
  // Dropdown buatan sendiri, pengganti <select> bawaan webview.
  import { tick } from "svelte";
  import { Check, ChevronDown } from "@lucide/svelte";

  interface Option<V> {
    value: V;
    label: string;
    /** Judul kelompok; dipasang di atas opsi pertama kelompok itu. */
    group?: string;
  }

  let {
    value = $bindable(),
    options,
    disabled = false,
    id,
    label,
    onchange,
    class: cls = "",
  }: {
    value: T;
    options: Option<T>[];
    disabled?: boolean;
    id?: string;
    label?: string;
    onchange?: (value: T) => void;
    class?: string;
  } = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);
  let width = $state(0);
  let maxH = $state(260);
  let active = $state(-1);

  const current = $derived(options.find((o) => o.value === value));

  async function show() {
    if (disabled || !trigger) return;
    open = true;
    active = Math.max(0, options.findIndex((o) => o.value === value));
    place();
    await tick();
    place();
    list?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }

  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(list?.scrollHeight ?? 260, 320);
    const up = below < want && above > below;
    maxH = Math.max(120, Math.min(320, up ? above : below));
    width = Math.max(r.width, 140);
    left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    top = up ? Math.max(8, r.top - Math.min(want, maxH) - 4) : r.bottom + 4;
  }

  function close(focus = true) {
    open = false;
    if (focus) trigger?.focus();
  }

  function pick(o: Option<T>) {
    value = o.value;
    close();
    onchange?.(o.value);
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        void show();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return close();
    }
    if (event.key === "Tab") return close(false);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + options.length) % options.length;
      void tick().then(() => list?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      active = event.key === "Home" ? 0 : options.length - 1;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (options[active]) pick(options[active]);
    }
  }
</script>

<svelte:window onresize={() => open && place()} onblur={() => (open = false)} />

<button
  bind:this={trigger}
  {id}
  type="button"
  class="sel {cls}"
  class:open
  {disabled}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-label={label}
  onclick={() => (open ? close() : show())}
  {onkeydown}
>
  <span class="val">{current?.label ?? ""}</span>
  <ChevronDown size={15} />
</button>

{#if open}
  <div class="scrim" role="presentation" onpointerdown={() => close(false)} oncontextmenu={(e) => { e.preventDefault(); close(false); }}></div>
  <div
    class="pop"
    bind:this={list}
    role="listbox"
    style:left="{left}px"
    style:top="{top}px"
    style:min-width="{width}px"
    style:max-height="{maxH}px"
  >
    {#each options as o, i (i)}
      {#if o.group && o.group !== options[i - 1]?.group}<div class="grp">{o.group}</div>{/if}
      <button
        type="button"
        role="option"
        aria-selected={o.value === value}
        data-active={i === active}
        class:on={o.value === value}
        onpointermove={() => (active = i)}
        onclick={() => pick(o)}
      >
        <span class="txt">{o.label}</span>
        {#if o.value === value}<Check size={14} />{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .sel {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color var(--dur-1), box-shadow var(--dur-1);
  }
  .sel:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .sel.open {
    border-color: var(--accent-strong);
  }
  .sel:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .sel :global(svg) {
    flex: none;
    color: var(--text-muted);
    transition: transform var(--dur-1);
  }
  .sel.open :global(svg) {
    transform: rotate(180deg);
  }
  .val {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 190;
  }
  .pop {
    position: fixed;
    z-index: 191;
    overflow-y: auto;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 28px var(--shadow-4);
    animation: pop var(--dur-2) var(--ease-out) both;
  }
  .grp {
    padding: 8px 10px 4px;
    font-size: 0.78em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pop button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pop button[data-active="true"] {
    background: var(--surface-2);
  }
  .pop button.on {
    color: var(--accent-strong);
    font-weight: 600;
  }
  .txt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
