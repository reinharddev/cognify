<script lang="ts">
  import { X } from "@lucide/svelte";

  let { tags, onchange }: { tags: string[]; onchange: (next: string[]) => void } = $props();

  const MAX_TAGS = 20;
  const MAX_LEN = 40;
  let draft = $state("");

  /** Warna tag tetap per nama (indeks var(--cat-N)), supaya tag yang sama selalu berwarna sama. */
  export function colorOf(tag: string): number {
    let h = 0;
    for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 8;
  }

  function add(raw: string) {
    const t = raw.trim().replace(/^#/, "").slice(0, MAX_LEN);
    draft = "";
    if (!t || tags.length >= MAX_TAGS || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    onchange([...tags, t]);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onchange(tags.slice(0, -1));
    }
  }
</script>

<div class="tags">
  {#each tags as t (t.toLowerCase())}
    <span class="tag" style:--c="var(--cat-{colorOf(t)})">
      <a href="/tags/{encodeURIComponent(t)}">#{t}</a>
      <button aria-label="Hapus tag {t}" onclick={() => onchange(tags.filter((x) => x !== t))}><X size={12} /></button>
    </span>
  {/each}
  <input placeholder={tags.length ? "Tag baru" : "Tambah tag"} aria-label="Tambah tag" bind:value={draft} {onkeydown} onblur={() => add(draft)} maxlength={MAX_LEN} />
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0 0 var(--space-3);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: color-mix(in srgb, var(--c) 22%, var(--surface));
    border-radius: 99px;
    padding: 1px 4px 1px 10px;
    font-size: 0.88em;
    animation: pop var(--dur-2) var(--ease-spring) both;
  }
  .tag a {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  .tag button {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: none;
    border-radius: 50%;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tag button:hover {
    background: color-mix(in srgb, var(--c) 40%, var(--surface));
    color: var(--text);
  }
  input {
    width: 8em;
    border: 0;
    background: none;
    padding: 3px 4px;
    color: var(--text);
  }
  input:focus-visible {
    outline: none;
    border-bottom: 2px solid var(--accent-strong);
  }
</style>
