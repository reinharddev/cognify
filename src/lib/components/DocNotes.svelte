<script lang="ts">
  import { tr } from "$lib/i18n.svelte";
  // Catatan kecil yang melayang di atas satu dokumen. Tersimpan bersama dokumennya, jadi hanya tampil di sana.
  import { Trash2 } from "@lucide/svelte";
  import type { DocNote } from "$lib/workspace/docNotes";
  import { NOTE_COLORS } from "$lib/workspace/docNotes";

  let { notes, locked = false, onchange }: { notes: DocNote[]; locked?: boolean; onchange: (notes: DocNote[]) => void } = $props();

  let layer: HTMLDivElement;
  let drag: { id: string; dx: number; dy: number } | null = null;

  function patch(id: string, p: Partial<DocNote>) {
    onchange(notes.map((n) => (n.id === id ? { ...n, ...p } : n)));
  }

  function start(e: PointerEvent, n: DocNote) {
    if (locked || (e.target as HTMLElement).closest("button, textarea, input")) return;
    drag = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Catatan yang disentuh naik ke paling depan.
    onchange([...notes.filter((x) => x.id !== n.id), n]);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const r = layer.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width - 200, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(r.height - 60, e.clientY - drag.dy));
    patch(drag.id, { x, y });
  }

  const end = () => (drag = null);
</script>

<div class="layer" bind:this={layer}>
  {#each notes as n (n.id)}
    <div
      class="note"
      class:locked
      role="group"
      aria-label={tr("Catatan melayang", "Floating notes")}
      data-note-id={n.id}
      style:left="{n.x}px"
      style:top="{n.y}px"
      style:--c="var({NOTE_COLORS[n.color]})"
      style:--rot="{n.rot}deg"
      onpointerdown={(e) => start(e, n)}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={end}
    >
      <div class="grip" aria-hidden="true"><i></i><i></i><i></i></div>
      <input class="t" value={n.title} placeholder={tr("Judul", "Title")} aria-label={tr("Judul catatan", "Note title")} oninput={(e) => patch(n.id, { title: e.currentTarget.value })} />
      <textarea rows="3" value={n.text} placeholder={tr("Tulis catatan…", "Write a note…")} aria-label={tr("Isi catatan", "Note text")} oninput={(e) => patch(n.id, { text: e.currentTarget.value })}></textarea>
      <div class="bar">
        {#each NOTE_COLORS as c, i (i)}
          <button type="button" class="dot" class:on={n.color === i} style:background="var({c})" aria-label="Warna {i + 1}" onclick={() => patch(n.id, { color: i })}></button>
        {/each}
        <button type="button" class="del" aria-label={tr("Hapus catatan", "Delete note")} title={tr("Hapus catatan", "Delete note")} onclick={() => onchange(notes.filter((x) => x.id !== n.id))}><Trash2 size={14} /></button>
      </div>
    </div>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
  }
  .note {
    position: absolute;
    width: 200px;
    padding: 0 12px 10px;
    background: var(--c);
    color: var(--text);
    border: var(--edge-w) solid var(--edge);
    border-radius: 10px 10px 18px 10px;
    box-shadow: var(--lift-lg);
    transform: rotate(var(--rot));
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }
  .note.locked,
  .note.locked .grip {
    cursor: default;
  }
  .note.locked .grip i {
    opacity: 0.12;
  }
  .note:active:not(.locked) {
    cursor: grabbing;
  }
  /* Pegangan geser: selebar catatan supaya mudah dipegang. */
  .grip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 26px;
    margin: 0 -12px 4px;
    cursor: grab;
  }
  .grip i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0.3;
  }
  .grip:hover i {
    opacity: 0.6;
  }
  .note:active .grip {
    cursor: grabbing;
  }
  .t,
  textarea {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    resize: none;
    cursor: text;
  }
  .t {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1em;
    margin-bottom: 4px;
  }
  textarea {
    font-size: 0.9em;
    line-height: 1.4;
  }
  .t:focus,
  textarea:focus {
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity var(--dur-1);
  }
  .note:hover .bar,
  .note:focus-within .bar {
    opacity: 1;
  }
  .dot {
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1.5px solid var(--edge);
    border-radius: 50%;
    cursor: pointer;
  }
  .dot.on {
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--edge);
  }
  .del {
    display: grid;
    place-items: center;
    margin-left: auto;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .del:hover {
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
</style>
