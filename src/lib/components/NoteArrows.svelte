<script lang="ts">
  // Panah tipis di belakang teks, dari teks yang dihubungkan ke catatan melayangnya. Ikut menyesuaikan
  // saat catatan digeser atau teksnya bergeser.
  import { arrowShape, roughen, seedOf, smoothPath, type Pt } from "$lib/editor/arrows";
  import type { DocNote } from "$lib/workspace/docNotes";

  let { notes, stage }: { notes: DocNote[]; stage: HTMLElement | undefined } = $props();

  interface Drawn {
    key: string;
    id: string;
    /** Dua goresan sedikit berbeda, seperti dicoret dua kali dengan tangan. */
    strokes: string[];
    head: string;
    from: Pt;
    to: Pt;
    dash?: string;
  }

  const SVG = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(SVG, "path");

  /** Titik-titik di sepanjang bentuk dasar panah, rapat cukup untuk digoyang halus. */
  function sample(d: string): Pt[] {
    probe.setAttribute("d", d);
    const total = probe.getTotalLength();
    const steps = Math.max(8, Math.min(60, Math.round(total / 14)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const p = probe.getPointAtLength((total * i) / steps);
      return { x: p.x, y: p.y };
    });
  }

  /** Kepala panah: dua goresan pendek yang tidak persis simetris. */
  function head(tip: Pt, from: Pt, seed: number): string {
    const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    const wob = (k: number) => (Math.sin(seed * 31 + k) * 0.12);
    const arm = (side: number, k: number, size: number) =>
      `M ${(tip.x - size * Math.cos(ang + side * (0.5 + wob(k)))).toFixed(1)} ${(tip.y - size * Math.sin(ang + side * (0.5 + wob(k)))).toFixed(1)} L ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`;
    return `${arm(-1, 1, 12)} ${arm(1, 2, 10 + wob(3) * 10)}`;
  }
  let drawn = $state<Drawn[]>([]);
  let rev = $state(0);

  // Teks bisa bergeser karena diedit, diubah ukurannya, atau jendela berubah lebar.
  $effect(() => {
    if (!stage) return;
    const page = stage.querySelector(".page");
    const bump = () => rev++;
    const mo = new MutationObserver(bump);
    if (page) mo.observe(page, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "data-note-link"] });
    const ro = new ResizeObserver(bump);
    ro.observe(stage);
    window.addEventListener("resize", bump);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", bump);
    };
  });

  /** Titik di tepi catatan yang paling dekat ke titik `from`, digeser sedikit keluar. */
  function edge(box: DOMRect, from: Pt): Pt {
    const c = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const dx = from.x - c.x;
    const dy = from.y - c.y;
    const t = Math.min(box.width / 2 / (Math.abs(dx) || 1e-6), box.height / 2 / (Math.abs(dy) || 1e-6));
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + dx * t + (dx / len) * 6, y: c.y + dy * t + (dy / len) * 6 };
  }

  $effect(() => {
    void notes;
    void rev;
    if (!stage) return void (drawn = []);
    const origin = stage.getBoundingClientRect();
    const groups = new Map<string, { noteId: string; arrow: number; rect: DOMRect }>();
    for (const el of stage.querySelectorAll<HTMLElement>("[data-note-link]")) {
      const id = el.dataset.linkId || el.dataset.noteLink!;
      const r = el.getBoundingClientRect();
      const g = groups.get(id);
      if (!g) groups.set(id, { noteId: el.dataset.noteLink!, arrow: Number(el.dataset.arrow) || 0, rect: r });
      else {
        const l = Math.min(g.rect.left, r.left), t = Math.min(g.rect.top, r.top);
        g.rect = new DOMRect(l, t, Math.max(g.rect.right, r.right) - l, Math.max(g.rect.bottom, r.bottom) - t);
      }
    }
    const out: Drawn[] = [];
    for (const [key, g] of groups) {
      const noteEl = stage.querySelector<HTMLElement>(`[data-note-id="${g.noteId}"]`);
      if (!noteEl) continue;
      const nb = noteEl.getBoundingClientRect();
      const tc = { x: g.rect.left + g.rect.width / 2, y: g.rect.top + g.rect.height / 2 };
      // Mulai dari sisi teks yang menghadap catatan.
      const noteLeft = nb.left + nb.width / 2 < tc.x;
      const start = { x: noteLeft ? g.rect.left : g.rect.right, y: tc.y };
      const end = edge(nb, start);
      const s = { x: start.x - origin.left, y: start.y - origin.top };
      const e = { x: end.x - origin.left, y: end.y - origin.top };
      const shape = arrowShape(g.arrow, s, e);
      const seed = seedOf(key);
      const base = sample(shape.d);
      const main = roughen(base, seed, 2.4);
      const second = roughen(base, seed + 0.37, 2.4);
      out.push({
        key,
        id: `arrow-${key.replace(/[^a-z0-9]/gi, "")}`,
        strokes: [smoothPath(main), smoothPath(second)],
        head: head(e, main[main.length - 2] ?? s, seed),
        from: s,
        to: e,
        dash: shape.dash,
      });
    }
    drawn = out;
  });
</script>

<svg class="arrows" aria-hidden="true">
  <defs>
    {#each drawn as a (a.key)}
      <!-- Samar di dekat teks, makin jelas mendekati catatan. -->
      <linearGradient id={a.id} gradientUnits="userSpaceOnUse" x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y}>
        <stop offset="0" stop-color="var(--text)" stop-opacity="0.1" />
        <stop offset="1" stop-color="var(--text)" stop-opacity="0.6" />
      </linearGradient>
    {/each}
  </defs>
  {#each drawn as a (a.key)}
    <g stroke="url(#{a.id})">
      <path d={a.strokes[0]} stroke-dasharray={a.dash} />
      <path class="again" d={a.strokes[1]} stroke-dasharray={a.dash} />
      <path d={a.head} />
    </g>
  {/each}
</svg>

<style>
  .arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    z-index: 0;
  }
  path {
    fill: none;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .again {
    stroke-width: 1.2;
    opacity: 0.7;
  }
</style>
