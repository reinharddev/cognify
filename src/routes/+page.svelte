<script lang="ts">
  import { goto } from "$app/navigation";
  import { FileText, Shapes, Table2 } from "@lucide/svelte";
  import { kindIcon } from "$lib/workspace/kinds";
  import { notchLink as nl } from "$lib/stores/link.svelte";
  import { ws } from "$lib/stores/workspace.svelte";
  import { clock as clockOf, startOfDay, addDays } from "$lib/calendar/dates";
  import { dueLabel } from "$lib/link/format";
  import { calendar } from "$lib/stores/calendar.svelte";
  import { plainText as tablePlain, prTemplate, scheduleTemplate, serialize as tableJson, type TableData } from "$lib/table/model";
  import { blankTemplate, plainTextOf, templates, type Template } from "$lib/workspace/templates";

  async function fromTemplate(t: Template) {
    const page = await ws.create("doc", null, {
      title: t.title,
      content: JSON.stringify(t.doc),
      plainText: plainTextOf(t.doc),
    });
    await goto(`/p/${page.id}`);
  }

  const tableTemplates: { id: string; name: string; hint: string; title: string; make: () => TableData }[] = [
    { id: "pr-tabel", name: "Tabel PR", hint: "Papan Belum, Dikerjakan, Selesai", title: "Tabel PR", make: prTemplate },
    { id: "jadwal", name: "Jadwal pelajaran", hint: "Hari, jam, mapel, dan ruang", title: "Jadwal pelajaran", make: scheduleTemplate },
  ];

  async function fromTableTemplate(t: (typeof tableTemplates)[number]) {
    const data = t.make();
    const page = await ws.create("table", null, { title: t.title, content: tableJson(data), plainText: tablePlain(data) });
    await goto(`/p/${page.id}`);
  }

  async function blank(kind: "doc" | "board" | "table") {
    const page = kind === "doc"
      ? await ws.create("doc", null, { content: JSON.stringify(blankTemplate.doc) })
      : await ws.create(kind);
    await goto(`/p/${page.id}`);
  }

  const openTodos = $derived((nl.data?.todos ?? []).filter((t) => !t.done).slice(0, 3));
  // Acara hari ini yang belum selesai, dari semua sumber (Cognify, langganan, dan agenda Notch).
  const todayEvents = $derived.by(() => {
    const from = startOfDay(Date.now());
    const now = Date.now();
    return calendar
      .occurrences(from, addDays(from, 1) - 1)
      .filter((o) => o.allDay || (o.end ?? o.start) >= now)
      .slice(0, 4);
  });

  const greeting = () => {
    const h = new Date().getHours();
    return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
  };
</script>

<div class="home">
  {#if ws.loaded}
    <h1>{greeting()}</h1>

    <section>
      <h2>Mulai</h2>
      <div class="starts">
        <button onclick={() => blank("doc")}><span class="ic k-doc"><FileText size={18} /></span>Dokumen kosong</button>
        <button onclick={() => blank("board")}><span class="ic k-board"><Shapes size={18} /></span>Papan</button>
        <button onclick={() => blank("table")}><span class="ic k-table"><Table2 size={18} /></span>Tabel</button>
      </div>
    </section>

    {#if todayEvents.length || (nl.connected && openTodos.length)}
      <section>
        <h2>Hari ini</h2>
        <div class="fromnotch">
          {#each todayEvents as o (o.key)}
            <div><span class="when">{o.allDay ? "Seharian" : clockOf(o.start)}</span>{o.title}</div>
          {/each}
          {#if nl.connected}
            {#each openTodos as t (t.id)}
              <div><span class="when">{t.dueAt ? dueLabel(t.dueAt, nl.now) : "Tugas"}</span>{t.title}</div>
            {/each}
          {/if}
          <a href="/calendar">Buka kalender</a>
        </div>
      </section>
    {/if}
    {#if nl.loaded && !nl.connected}
      <p class="hint">Punya Cognify Notch? <a href="/notch">Hubungkan</a> untuk melihat tugas, catatan cepat, dan agendanya di sini.</p>
    {/if}

    <section>
      <h2>Templat</h2>
      <div class="grid">
        {#each templates as t, i (t.id)}
          <button class="card" style:--tint="var(--tint-{(i % 6) + 1})" style:--i={i} onclick={() => fromTemplate(t)}>
            <strong>{t.name}</strong>
            <span>{t.hint}</span>
          </button>
        {/each}
        {#each tableTemplates as t, j (t.id)}
          <button class="card" style:--tint="var(--tint-{((templates.length + j) % 6) + 1})" style:--i={templates.length + j} onclick={() => fromTableTemplate(t)}>
            <strong>{t.name}</strong>
            <span>{t.hint}</span>
          </button>
        {/each}
      </div>
    </section>

    {#if ws.recent.length}
      <section>
        <h2>Terakhir diubah</h2>
        <ul class="recent">
          {#each ws.recent as n (n.id)}
            {@const KindIcon = kindIcon(n.kind)}
            <li><a href="/p/{n.id}"><KindIcon size={15} />{n.title || "Tanpa judul"}</a></li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .home {
    max-width: 780px;
    margin: 0 auto;
  }
  h1 {
    font-size: 1.9em;
    margin-bottom: var(--space-4);
  }
  h2 {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: var(--space-3);
  }
  section {
    margin-bottom: var(--space-8);
  }
  .home > * {
    animation: rise var(--dur-3) var(--ease-out) backwards;
  }
  .home > :nth-child(2) { animation-delay: 60ms; }
  .home > :nth-child(3) { animation-delay: 120ms; }
  .home > :nth-child(4) { animation-delay: 180ms; }
  .home > :nth-child(n + 5) { animation-delay: 240ms; }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-4);
    background: var(--tint);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    text-align: left;
    cursor: pointer;
    animation: rise var(--dur-3) var(--ease-out) backwards;
    animation-delay: calc(240ms + var(--i, 0) * 50ms);
  }
  .card:hover {
    border-color: var(--accent-strong);
    transform: translateY(-3px);
  }
  .card span {
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .starts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .starts button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 99px;
    cursor: pointer;
  }
  .ic {
    display: inline-flex;
  }
  .k-doc {
    color: var(--kind-doc);
  }
  .k-board {
    color: var(--kind-board);
  }
  .k-table {
    color: var(--kind-table);
  }
  .starts button:hover {
    border-color: var(--accent-strong);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: var(--space-3);
  }
  .fromnotch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .when {
    display: inline-block;
    min-width: 7.5em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .fromnotch a {
    margin-top: 4px;
    color: var(--link);
    text-decoration: none;
  }
  .hint {
    color: var(--text-muted);
    margin: calc(-1 * var(--space-4)) 0 var(--space-6);
  }
  .hint a {
    color: var(--link);
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .recent a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    text-decoration: none;
  }
  .recent a:hover {
    background: var(--surface-2);
  }
  .recent :global(svg) {
    color: var(--text-muted);
  }
</style>
