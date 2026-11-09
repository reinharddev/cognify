// Jelajah app di situs Cognify: salinan app tiruan yang bisa dipakai pengunjung, dengan penjelasan
// dan langkah "coba sendiri" di sisi kanan. Semua data karangan dan semuanya berjalan di halaman ini.
(() => {
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const tr = (id, en) => (root.dataset.lang === 'en' ? en : id);
  const ic = (n, s = 16) => `<i data-lucide="${n}" style="width:${s}px;height:${s}px"></i>`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const isMac = /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';

  let view = $('#xView');
  const side = $('#xSide'), guide = $('#xGuide'), toasts = $('#xToasts');
  if (!side) return;
  $('#xKbd').textContent = `${mod} K`;

  const done = {}; // key -> Set langkah selesai
  let cur = null;
  let draw = () => {};

  function toast(text, icon = 'check') {
    const t = document.createElement('div');
    t.className = 'x-toast';
    t.innerHTML = `${ic(icon, 15)}<span>${esc(text)}</span>`;
    toasts.append(t);
    refreshIcons();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
  }
  const refreshIcons = () => window.lucide && window.lucide.createIcons();

  function tick(i) {
    const s = (done[cur.k] ||= new Set());
    if (s.has(i)) return;
    s.add(i);
    renderGuide();
    markSide();
  }

  // ---------- Fitur ----------
  const F = [
    {
      k: 'doc', g: 'ws', icon: 'file-text', c: '--doc',
      n: ['Dokumen', 'Documents'],
      t: ['Tulis seperti di Word, rapi seperti buku.', 'Write like in Word, tidy like a book.'],
      d: ['Editor dokumen dengan judul, jenis dan ukuran huruf, warna, penanda, daftar centang, tabel, dan kutipan. Ketik / untuk menyisipkan blok. Ada enam templat: Daftar PR, Ringkasan bab, catatan Cornell, dan lainnya. Tersimpan sendiri di komputermu.', 'A document editor with headings, font type and size, colors, highlight, checklists, tables, and quotes. Type / to insert a block. Six templates: Homework list, Chapter summary, Cornell notes, and more. It saves by itself on your computer.'],
      s: [['Blok satu kata di dokumen, lalu tekan B, I, atau penanda.', 'Select a word in the document, then press B, I, or highlight.'], ['Klik di akhir teks, ketik / lalu pilih blok.', 'Click at the end of the text, type / and pick a block.'], ['Tekan tombol Cornell untuk memakai templatnya.', 'Press the Cornell button to use the template.']],
      r: viewDoc,
    },
    {
      k: 'board', g: 'ws', icon: 'pen-tool', c: '--board',
      n: ['Papan gambar', 'Whiteboard'],
      t: ['Papan bebas untuk peta konsep.', 'A free board for mind maps.'],
      d: ['Gambar diagram, peta konsep, atau coretan rumus di kanvas tanpa batas (memakai Excalidraw). Teks di papan ikut bisa dicari, dan papan bisa diekspor jadi gambar PNG.', 'Draw diagrams, concept maps, or formula scribbles on an endless canvas (powered by Excalidraw). Text on a board is searchable, and a board can be exported as a PNG image.'],
      s: [['Gambar apa saja di kanvas dengan mouse atau jari.', 'Draw anything on the canvas with your mouse or finger.'], ['Pilih warna lain, lalu gambar lagi.', 'Pick another color and draw again.'], ['Tekan Ekspor PNG.', 'Press Export PNG.']],
      r: viewBoard,
    },
    {
      k: 'table', g: 'ws', icon: 'table-2', c: '--table',
      n: ['Tabel dan papan', 'Tables'],
      t: ['Satu data, dua tampilan.', 'One table, two views.'],
      d: ['Simpan PR, jadwal, atau anggaran di tabel, lalu ganti ke papan yang mengelompokkan kartu berdasarkan kolom pilihan. Kolom bisa berupa teks, angka, tanggal, kotak centang, atau pilihan berwarna.', 'Keep homework, schedules, or budgets in a table, then switch to a board that groups cards by a choice column. Columns can be text, numbers, dates, checkboxes, or colored choices.'],
      s: [['Tekan Papan untuk melihat kartu per status.', 'Press Board to see cards grouped by status.'], ['Klik sebuah kartu atau status untuk memindahkannya.', 'Click a card or a status to move it along.'], ['Tambah baris baru.', 'Add a new row.']],
      r: viewTable,
    },
    {
      k: 'search', g: 'ws', icon: 'search', c: '--doc',
      n: ['Cari dan tag', 'Search & tags'],
      t: ['Temukan isi catatan dalam sekejap.', 'Find anything in your notes instantly.'],
      d: ['Pencarian kata kunci ke seluruh isi halaman, dokumen, teks di papan, dan tabel (FTS5, tanpa AI). Beri tag di bawah judul untuk mengelompokkan. Tekan Ctrl K (⌘ K di Mac) dari mana saja.', 'Keyword search across every page, document, whiteboard text, and table (FTS5, no AI). Add tags under a title to group things. Press Ctrl K (⌘ K on Mac) from anywhere.'],
      s: [['Ketik "foto" atau "pajak" di kolom cari.', 'Type "photo" or "tax" in the search box.'], ['Klik sebuah tag untuk menyaring.', 'Click a tag to filter.'], ['Klik hasil untuk membukanya.', 'Click a result to open it.']],
      r: viewSearch,
    },
    {
      k: 'cal', g: 'plan', icon: 'calendar-days', c: '--cal',
      n: ['Kalender', 'Calendar'],
      t: ['Jadwalmu, lengkap dengan pengingat.', 'Your schedule, with reminders.'],
      d: ['Kalender bulanan untuk ujian, kuliah, dan tenggat. Acara bisa berulang harian, mingguan, bulanan, atau tahunan, dan pengingat muncul di desktop sebelum acara mulai. Tambahkan tautan kalender (ICS) dari Google atau Outlook untuk ikut membacanya.', 'A monthly calendar for exams, classes, and deadlines. Events can repeat daily, weekly, monthly, or yearly, and a desktop reminder pops up before they start. Add a calendar link (ICS) from Google or Outlook to follow it.'],
      s: [['Klik sebuah tanggal.', 'Click a date.'], ['Ketik nama acara lalu tekan Tambah.', 'Type an event name and press Add.'], ['Ulangi acara itu dengan pilihan Mingguan.', 'Add one with the Weekly repeat.']],
      r: viewCal,
    },
    {
      k: 'moodle', g: 'plan', icon: 'graduation-cap', c: '--table',
      n: ['Moodle', 'Moodle'],
      t: ['Tugas kampus masuk sendiri.', 'Campus tasks arrive by themselves.'],
      d: ['Opsional dan mati bawaan. Setelah kamu menyalakannya, tugas, tenggat, dan materi dari Moodle kampusmu muncul di Cognify, lengkap dengan Daftar PR dan Tabel PR otomatis. Kata sandi dipakai sekali untuk meminta token lalu dibuang; token disimpan di keychain sistem.', 'Optional and off by default. Once you turn it on, tasks, deadlines, and materials from your campus Moodle show up in Cognify, with a Homework list and table made for you. Your password is used once to request a token and then discarded; the token lives in the system keychain.'],
      s: [['Tekan Sinkronkan Moodle.', 'Press Sync Moodle.'], ['Tekan Materi untuk menyimpannya offline.', 'Press Material to keep it offline.'], ['Centang satu tugas yang sudah selesai.', 'Tick a finished task.']],
      r: viewMoodle,
    },
    {
      k: 'tools', g: 'more', icon: 'wrench', c: '--board',
      n: ['Alat', 'Tools'],
      t: ['14 alat, semuanya di komputermu.', '14 tools, all on your computer.'],
      d: ['Ubah, kecilkan, dan edit file tanpa mengunggahnya ke mana pun: konversi video, audio, dan gambar, kompres video, gambar, dan PDF, potong dan gabung video, gabung dan pisah PDF, dokumen ke PDF, rename massal, unduh media, format JSON, dan kode QR.', 'Convert, shrink, and edit files without uploading them anywhere: convert video, audio, and images; compress video, images, and PDFs; trim and join video; merge and split PDFs; documents to PDF; bulk rename; download media; JSON formatter; and QR codes.'],
      s: [['Pilih sebuah alat.', 'Pick a tool.'], ['Tekan Pakai berkas contoh dan tunggu hasilnya.', 'Press Use a sample file and wait for the result.'], ['Coba alat kedua.', 'Try a second tool.']],
      r: viewTools,
    },
    {
      k: 'sticky', g: 'more', icon: 'sticky-note', c: '--cal',
      n: ['Catatan melayang', 'Floating notes'],
      t: ['Sticky note yang selalu di atas.', 'A sticky note that stays on top.'],
      d: [`Tekan ${mod === 'Ctrl' ? 'Ctrl Alt N' : '⌘ ⌥ N'} dari app mana pun untuk memunculkan catatan kecil yang melayang di atas jendela lain. Cocok untuk mencatat sambil membaca PDF atau menonton kuliah. Isinya tersimpan sebagai halaman.`, `Press ${mod === 'Ctrl' ? 'Ctrl Alt N' : '⌘ ⌥ N'} from any app to bring up a small note floating above other windows. Great for jotting while reading a PDF or watching a lecture. It is saved as a page.`],
      s: [[`Tekan ${mod} ${alt} N, atau tombol Munculkan.`, `Press ${mod} ${alt} N, or the Show button.`], ['Seret catatannya dari judulnya.', 'Drag the note by its title bar.'], ['Ketik sesuatu di dalamnya.', 'Type something in it.']],
      r: viewSticky,
    },
    {
      k: 'cite', g: 'more', icon: 'quote', c: '--doc',
      n: ['Sitasi', 'Citations'],
      t: ['Kutip sumber dalam sekali klik.', 'Cite a source in one click.'],
      d: ['Halaman yang disimpan dari web atau PDF mengingat sumbernya: judul, penulis, tanggal, jurnal, dan DOI. Tombol Kutip menuliskannya dalam APA 7, MLA 9, Chicago, Harvard, IEEE, Vancouver, atau ISO 690, dan mengekspor BibTeX, RIS, atau CSL-JSON.', 'Pages saved from the web or a PDF remember their source: title, authors, date, journal, and DOI. The Cite button writes it in APA 7, MLA 9, Chicago, Harvard, IEEE, Vancouver, or ISO 690, and exports BibTeX, RIS, or CSL-JSON.'],
      s: [['Ganti gaya sitasi.', 'Switch the citation style.'], ['Tekan BibTeX untuk mengekspor.', 'Press BibTeX to export.'], ['Tekan Salin.', 'Press Copy.']],
      r: viewCite,
    },
    {
      k: 'mcp', g: 'more', icon: 'plug-zap', c: '--notch',
      n: ['AI lewat MCP', 'AI via MCP'],
      t: ['AI luar membaca, kamu yang memutuskan.', 'Outside AI reads, you decide.'],
      d: ['Tidak ada AI yang tertanam. Ada pengaturan opsional, mati bawaan, yang memungkinkan app AI yang sudah kamu pakai membaca halamanmu dan mengusulkan halaman baru lewat standar MCP. Usulannya menunggu sampai kamu menyetujuinya.', 'No AI is built in. An optional setting, off by default, lets an AI app you already use read your pages and suggest new ones through the MCP standard. Suggestions wait until you approve them.'],
      s: [['Nyalakan izinnya.', 'Turn the permission on.'], ['Tekan Tanya AI.', 'Press Ask the AI.'], ['Setujui atau tolak usulannya.', 'Approve or reject the proposal.']],
      r: viewMcp,
    },
  ];
  const groups = { ws: ['Ruang kerja', 'Workspace'], plan: ['Rencana', 'Plan'], more: ['Lainnya', 'More'] };
  const soft = { '--doc': '--doc-s', '--board': '--board-s', '--table': '--table-s', '--cal': '--cal-s', '--notch': '--notch-s' };

  // ---------- Sidebar dan panel penjelasan ----------
  function renderSide() {
    let g = '';
    side.innerHTML = F.map((f) => {
      let h = '';
      if (f.g !== g) { g = f.g; h = `<h6>${esc(tr(...groups[g]))}</h6>`; }
      return `${h}<button type="button" data-k="${f.k}" style="--c:var(${f.c});--s:var(${soft[f.c]})">${ic(f.icon)}<span>${esc(tr(...f.n))}</span>${ic('circle-check', 16).replace('<i ', '<i class="done-dot" ')}</button>`;
    }).join('') + `<span class="grow"></span><a href="https://reinharddev.github.io/cognify-notch/" style="--c:var(--notch)">${ic('panel-top')}<span>Cognify Notch</span>${ic('arrow-up-right', 14)}</a>`;
    refreshIcons();
    markSide();
  }
  function markSide() {
    $$('button[data-k]', side).forEach((b) => {
      const f = F.find((x) => x.k === b.dataset.k);
      b.setAttribute('aria-current', String(cur && cur.k === f.k));
      b.classList.toggle('all', (done[f.k] || new Set()).size >= f.s.length);
    });
  }
  function renderGuide() {
    const f = cur, s = done[f.k] || new Set();
    const left = f.s.length - s.size;
    const idx = F.indexOf(f);
    const nxt = F[(idx + 1) % F.length];
    guide.style.setProperty('--g', `var(${f.c})`);
    guide.style.setProperty('--g-s', `var(${soft[f.c]})`);
    guide.innerHTML = `<span class="x-badge">${ic(f.icon, 14)}${esc(tr(...f.n))}</span>
      <h3>${esc(tr(...f.t))}</h3>
      <p>${esc(tr(...f.d))}</p>
      <h4>${esc(tr('Coba sendiri', 'Try it yourself'))}</h4>
      <ol class="x-steps">${f.s.map((st, i) => `<li class="${s.has(i) ? 'on' : ''}"><i>${ic('check', 12)}</i><span>${esc(tr(...st))}</span></li>`).join('')}</ol>
      <button class="btn x-next ${left ? '' : 'primary'}" type="button" id="xNext">${esc(left ? tr('Lewati ke fitur berikutnya', 'Skip to the next feature') : tr('Selesai. Fitur berikutnya', 'Done. Next feature'))}${ic('arrow-right')}</button>
      ${left ? '' : ''}`;
    $('#xNext').addEventListener('click', () => open(nxt.k, true));
    refreshIcons();
  }

  function open(k, scroll) {
    cur = F.find((f) => f.k === k);
    const fresh = view.cloneNode(false); // pendengar peristiwa fitur lama ikut dibuang
    view.replaceWith(fresh); view = fresh;
    cur.r(view);
    renderGuide();
    markSide();
    refreshIcons();
    if (scroll && scrolly) { scrollTo({ top: spot(F.indexOf(cur)), behavior: 'instant' }); return; }
    if (scroll) {
      const r = $('#win').getBoundingClientRect();
      if (r.top < 0 || r.top > innerHeight * 0.5) $('#win').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  side.addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) open(b.dataset.k, true); });

  // ---------- Mode gulir: jendela menempel di layar, fitur berganti mengikuti gulir ----------
  const sec = $('#jelajah');
  const PER = 0.55; // tinggi gulir per fitur, dalam tinggi layar
  let scrolly = false;
  const spot = (i) => sec.getBoundingClientRect().top + scrollY + (i + 0.5) * PER * innerHeight;
  function mode() {
    scrolly = innerWidth > 1100 && innerHeight >= 700;
    sec.classList.toggle('scrolly', scrolly);
    sec.style.setProperty('--n', F.length);
    sec.style.setProperty('--per', PER);
  }
  function onScroll() {
    if (!scrolly) return;
    const r = sec.getBoundingClientRect();
    const total = sec.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / total));
    const f = F[Math.min(F.length - 1, Math.floor(p * F.length))];
    if (f.k !== cur.k) open(f.k);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { mode(); onScroll(); });

  // Ctrl/Cmd+K dan tombol Cari membuka pencarian
  const goSearch = () => { open('search', true); setTimeout(() => { const i = $('input', view); i && i.focus(); }, 60); };
  $('#xK').addEventListener('click', goSearch);
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.altKey) {
      const r = $('#win').getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) { e.preventDefault(); goSearch(); }
    }
    if (cur && cur.k === 'sticky' && e.altKey && (e.ctrlKey || e.metaKey) && e.code === 'KeyN') { e.preventDefault(); view.__sticky && view.__sticky(); }
  });

  // ================= Isi tiap fitur =================

  function viewDoc(v) {
    v.style.position = 'relative';
    v.innerHTML = `<div class="row">
        <button class="b" data-c="bold" title="${tr('Tebal', 'Bold')}"><b>B</b></button>
        <button class="b" data-c="italic"><i>I</i></button>
        <button class="b" data-c="hl">${ic('highlighter', 15)}</button>
        <button class="b" data-c="h">H</button>
        <button class="b" data-c="ul">${ic('list', 15)}</button>
        <span class="sp"></span>
        <button class="b" data-c="cornell">${ic('layout-template', 15)}Cornell</button>
      </div>
      <div class="x-doc" contenteditable="true" spellcheck="false">
        <h3>${esc(tr('Ringkasan Bab 4: Fotosintesis', 'Chapter 4 summary: Photosynthesis'))}</h3>
        <p>${esc(tr('Fotosintesis mengubah cahaya matahari, air, dan karbon dioksida menjadi glukosa dan oksigen. Reaksi terang terjadi di tilakoid, sedangkan siklus Calvin terjadi di stroma.', 'Photosynthesis turns sunlight, water, and carbon dioxide into glucose and oxygen. The light reactions happen in the thylakoids, while the Calvin cycle happens in the stroma.'))}</p>
        <p>${esc(tr('Hal yang perlu diingat sebelum ujian: ', 'Remember before the exam: '))}</p>
      </div>`;
    const doc = $('.x-doc', v);
    const exec = (c, a) => document.execCommand(c, false, a);
    $$('.row .b', v).forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const c = b.dataset.c;
        if (c === 'cornell') {
          doc.innerHTML = `<h3>${esc(tr('Catatan Cornell', 'Cornell notes'))}</h3><table><tr><th style="width:34%">${esc(tr('Pertanyaan', 'Questions'))}</th><th>${esc(tr('Catatan', 'Notes'))}</th></tr><tr><td>${esc(tr('Apa hasil fotosintesis?', 'What does photosynthesis produce?'))}</td><td>${esc(tr('Glukosa dan oksigen.', 'Glucose and oxygen.'))}</td></tr><tr><td>${esc(tr('Di mana siklus Calvin?', 'Where is the Calvin cycle?'))}</td><td>${esc(tr('Di stroma kloroplas.', 'In the chloroplast stroma.'))}</td></tr></table><p><b>${esc(tr('Ringkasan: ', 'Summary: '))}</b>${esc(tr('tulis intinya dengan kata sendiri.', 'write the gist in your own words.'))}</p>`;
          tick(2);
          return;
        }
        if (c === 'hl') exec('hiliteColor', '#ffe08a');
        else if (c === 'h') exec('formatBlock', 'H3');
        else if (c === 'ul') exec('insertUnorderedList');
        else exec(c);
        tick(0);
      });
    });
    const menu = document.createElement('div');
    menu.className = 'x-slash';
    menu.hidden = true;
    const blocks = [
      ['list-checks', tr('Daftar centang', 'Checklist'), '<ul><li>☐ &nbsp;</li><li>☐ &nbsp;</li></ul>'],
      ['table-2', tr('Tabel', 'Table'), '<table><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>'],
      ['minus', tr('Pembatas', 'Divider'), '<hr><p></p>'],
    ];
    menu.innerHTML = blocks.map((b, i) => `<button data-i="${i}">${ic(b[0], 15)}${esc(b[1])}</button>`).join('');
    v.append(menu);
    refreshIcons();
    const hide = () => { menu.hidden = true; };
    doc.addEventListener('input', (e) => {
      if (e.data === '/') {
        const sel = getSelection();
        if (!sel.rangeCount) return;
        const r = sel.getRangeAt(0).cloneRange();
        const rc = r.getBoundingClientRect(), vb = v.getBoundingClientRect();
        menu.style.left = Math.max(8, rc.left - vb.left) + 'px';
        menu.style.top = (rc.bottom - vb.top + 6) + 'px';
        menu.hidden = false;
      } else hide();
    });
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    doc.addEventListener('blur', () => setTimeout(hide, 150));
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      doc.focus();
      exec('delete'); // hapus karakter "/"
      exec('insertHTML', blocks[+b.dataset.i][2]);
      hide();
      tick(1);
    });
  }

  function viewBoard(v) {
    const cols = ['#141414', '#e26336', '#7e6cf0'];
    let color = cols[0], drew = false;
    v.innerHTML = `<div class="row">${cols.map((c, i) => `<button class="x-sw ${i ? '' : 'on'}" data-c="${c}" style="background:${c}" aria-label="${tr('Warna', 'Color')} ${i + 1}"></button>`).join('')}
      <span class="sp"></span>
      <button class="b" id="bClr">${ic('eraser', 15)}${esc(tr('Hapus coretan', 'Clear'))}</button>
      <button class="b" id="bExp">${ic('image-down', 15)}${esc(tr('Ekspor PNG', 'Export PNG'))}</button></div>
      <svg class="x-board" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${tr('Papan gambar', 'Whiteboard')}">
        <g font-family="inherit" font-size="15" font-weight="700" fill="#141414">
          <rect x="40" y="40" width="150" height="50" rx="14" fill="#ffe08a" stroke="#141414" stroke-width="2"/><text x="115" y="71" text-anchor="middle">${esc(tr('Sinar matahari', 'Sunlight'))}</text>
          <rect x="400" y="40" width="150" height="50" rx="14" fill="#b8ecd0" stroke="#141414" stroke-width="2"/><text x="475" y="71" text-anchor="middle">${esc(tr('Glukosa + O₂', 'Glucose + O₂'))}</text>
          <rect x="215" y="150" width="170" height="56" rx="28" fill="#c9c4ff" stroke="#141414" stroke-width="2"/><text x="300" y="184" text-anchor="middle">${esc(tr('Fotosintesis', 'Photosynthesis'))}</text>
          <path d="M190 70 C 230 80 250 110 270 148 M400 70 C 370 90 350 120 330 148" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>
        </g><g id="ink"></g></svg>`;
    const svg = $('svg', v), ink = $('#ink', v);
    $$('.x-sw', v).forEach((b) => b.addEventListener('click', () => {
      color = b.dataset.c;
      $$('.x-sw', v).forEach((x) => x.classList.toggle('on', x === b));
      if (drew) tick(1);
    }));
    let path = null, d = '';
    const pt = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return `${q.x.toFixed(1)} ${q.y.toFixed(1)}`; };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      d = 'M' + pt(e);
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '4');
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('d', d + ' L' + pt(e));
      ink.append(path);
    });
    svg.addEventListener('pointermove', (e) => { if (path) { d += ' L' + pt(e); path.setAttribute('d', d); } });
    const end = () => { if (path) { path = null; drew = true; tick(0); } };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    $('#bClr', v).addEventListener('click', () => { ink.innerHTML = ''; });
    $('#bExp', v).addEventListener('click', () => { toast(tr('Tersimpan: papan.png (contoh)', 'Saved: board.png (sample)'), 'image-down'); tick(2); });
  }

  function viewTable(v) {
    const S = [tr('Belum', 'To do'), tr('Dikerjakan', 'Doing'), tr('Selesai', 'Done')];
    const rows = [
      { t: tr('Laporan praktikum', 'Lab report'), d: tr('Jumat', 'Friday'), s: 1 },
      { t: tr('Soal latihan Bab 4', 'Chapter 4 exercises'), d: tr('Besok', 'Tomorrow'), s: 0 },
      { t: tr('Baca jurnal', 'Read the paper'), d: tr('Senin', 'Monday'), s: 0 },
      { t: tr('Presentasi kelompok', 'Group presentation'), d: tr('Kemarin', 'Yesterday'), s: 2 },
    ];
    let mode = 'table';
    const paint = () => {
      v.innerHTML = `<div class="row"><button class="b ${mode === 'table' ? 'on' : ''}" data-m="table">${ic('table-2', 15)}${esc(tr('Tabel', 'Table'))}</button><button class="b ${mode === 'board' ? 'on' : ''}" data-m="board">${ic('kanban', 15)}${esc(tr('Papan', 'Board'))}</button><span class="sp"></span><button class="b" id="bAdd">${ic('plus', 15)}${esc(tr('Baris', 'Row'))}</button></div>` +
        (mode === 'table'
          ? `<table class="x-tbl"><tr><th>${esc(tr('Tugas', 'Task'))}</th><th>${esc(tr('Tenggat', 'Due'))}</th><th>Status</th></tr>${rows.map((r, i) => `<tr><td>${esc(r.t)}</td><td>${esc(r.d)}</td><td><button class="x-chip" data-i="${i}" data-s="${r.s}">${esc(S[r.s])}</button></td></tr>`).join('')}</table>`
          : `<div class="x-kan">${S.map((s, si) => `<div class="x-col"><h5>${esc(s)}</h5>${rows.map((r, i) => r.s === si ? `<button class="x-card" data-i="${i}"><b>${esc(r.t)}</b><small>${esc(r.d)}</small></button>` : '').join('')}</div>`).join('')}</div>`);
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (m) { mode = m.dataset.m; paint(); if (mode === 'board') tick(0); return; }
      const c = e.target.closest('[data-i]');
      if (c) { const r = rows[+c.dataset.i]; r.s = (r.s + 1) % 3; paint(); tick(1); return; }
      if (e.target.closest('#bAdd')) { rows.push({ t: tr('Tugas baru', 'New task'), d: '—', s: 0 }); paint(); tick(2); }
    });
  }

  const PAGES = () => [
    { t: tr('Peta fotosintesis', 'Photosynthesis map'), k: 'pen-tool', c: '--board', tags: ['biologi'], b: tr('sinar matahari glukosa fotosintesis kloroplas', 'sunlight glucose photosynthesis chloroplast') },
    { t: tr('Ringkasan Bab 4', 'Chapter 4 summary'), k: 'file-text', c: '--doc', tags: ['biologi', 'ujian'], b: tr('fotosintesis tilakoid stroma siklus Calvin', 'photosynthesis thylakoid stroma Calvin cycle') },
    { t: tr('Daftar PR', 'Homework list'), k: 'table-2', c: '--table', tags: ['kuliah'], b: tr('laporan praktikum soal latihan baca jurnal', 'lab report exercises read the paper') },
    { t: tr('Catatan pajak penghasilan', 'Income tax notes'), k: 'file-text', c: '--doc', tags: ['ekonomi', 'ujian'], b: tr('pajak tarif progresif PPh kuliah ekonomi', 'tax progressive rate income economics') },
    { t: tr('Anggaran bulanan', 'Monthly budget'), k: 'table-2', c: '--table', tags: ['pribadi'], b: tr('uang saku kos makan pajak', 'allowance rent food tax') },
  ];
  function viewSearch(v) {
    let q = '', tag = '';
    const tags = ['biologi', 'ujian', 'kuliah', 'ekonomi', 'pribadi'];
    const hl = (t) => { if (!q) return esc(t); const i = norm(t).indexOf(norm(q)); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
    const list = () => {
      const res = PAGES().filter((p) => (!q || norm(p.t + ' ' + p.b).includes(norm(q))) && (!tag || p.tags.includes(tag)));
      $('.x-list', v).innerHTML = res.length ? res.map((p) => `<button class="x-res" style="--c:var(${p.c})">${ic(p.k, 18)}<span><b>${hl(p.t)}</b><small>${p.tags.map((t) => '#' + t).join(' ')} · ${esc(p.b)}</small></span></button>`).join('') : `<p class="x-note" style="margin:20px 0">${esc(tr('Tidak ada yang cocok.', 'Nothing matches.'))}</p>`;
      refreshIcons();
    };
    v.innerHTML = `<input type="text" id="q" placeholder="${esc(tr('Cari di semua catatan…', 'Search all notes…'))}" style="width:100%;font-size:16px;padding:11px 14px" autocomplete="off">
      <div class="row" style="margin:12px 0 0">${tags.map((t) => `<button class="x-tag" data-t="${t}">#${t}</button>`).join('')}</div><div class="x-list"></div>`;
    list();
    $('#q', v).addEventListener('input', (e) => { q = e.target.value.trim(); list(); if (q) tick(0); });
    v.addEventListener('click', (e) => {
      const t = e.target.closest('.x-tag');
      if (t) { tag = tag === t.dataset.t ? '' : t.dataset.t; $$('.x-tag', v).forEach((x) => x.classList.toggle('on', x.dataset.t === tag)); list(); if (tag) tick(1); return; }
      const r = e.target.closest('.x-res');
      if (r) { toast(tr('Dibuka: ', 'Opened: ') + r.querySelector('b').textContent, 'file-text'); tick(2); }
    });
  }

  function viewCal(v) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const names = [tr('Sen', 'Mon'), tr('Sel', 'Tue'), tr('Rab', 'Wed'), tr('Kam', 'Thu'), tr('Jum', 'Fri'), tr('Sab', 'Sat'), tr('Min', 'Sun')];
    const ev = {};
    const add = (d, t) => { (ev[d] ||= []).push(t); };
    add(Math.min(days, now.getDate() + 3), tr('Kuis Fisika', 'Physics quiz'));
    add(Math.min(days, now.getDate() + 8), tr('Ujian Matematika', 'Math exam'));
    let sel = null;
    const paint = () => {
      const label = new Date(y, m, 1).toLocaleDateString(root.dataset.lang === 'en' ? 'en-US' : 'id-ID', { month: 'long', year: 'numeric' });
      let cells = names.map((n) => `<div class="h">${n}</div>`).join('') + '<div class="d mute"></div>'.repeat(first);
      for (let d = 1; d <= days; d++) cells += `<button class="d ${d === now.getDate() ? 'today' : ''} ${d === sel ? 'sel' : ''}" data-d="${d}"><b>${d}</b>${(ev[d] || []).map((t) => `<span class="x-ev">${esc(t)}</span>`).join('')}</button>`;
      v.innerHTML = `<h3 style="text-transform:capitalize">${esc(label)}</h3><div class="x-cal">${cells}</div>` +
        `<div class="row" style="margin-top:12px"><input type="text" id="evn" placeholder="${esc(tr('Nama acara', 'Event name'))}" ${sel ? '' : 'disabled'} style="flex:1;min-width:140px"><select id="evr" ${sel ? '' : 'disabled'}><option value="0">${esc(tr('Tidak berulang', 'No repeat'))}</option><option value="1">${esc(tr('Mingguan', 'Weekly'))}</option></select><button class="b" id="evb" ${sel ? '' : 'disabled'}>${ic('plus', 15)}${esc(tr('Tambah', 'Add'))}</button></div>` +
        `<p class="x-note" style="margin:8px 0 0;text-align:left">${esc(sel ? tr(`Tanggal ${sel} dipilih.`, `Date ${sel} selected.`) : tr('Klik sebuah tanggal untuk menambah acara.', 'Click a date to add an event.'))}</p>`;
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      const d = e.target.closest('.d[data-d]');
      if (d) { sel = +d.dataset.d; paint(); tick(0); const i = $('#evn', v); i && i.focus(); return; }
      if (e.target.closest('#evb')) {
        const t = $('#evn', v).value.trim() || tr('Acara baru', 'New event');
        const weekly = $('#evr', v).value === '1';
        for (let d = sel; d <= days; d += weekly ? 7 : days) { add(d, t); if (!weekly) break; }
        paint(); tick(1); if (weekly) tick(2);
        toast(tr(`Pengingat: "${t}" mulai 15 menit lagi`, `Reminder: "${t}" starts in 15 minutes`), 'bell-ring');
      }
    });
    v.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'evn') $('#evb', v).click(); });
  }

  function viewMoodle(v) {
    let tasks = [
      { t: tr('Kuis 3: Termodinamika', 'Quiz 3: Thermodynamics'), c: tr('Fisika Dasar', 'Basic Physics'), due: 1, ok: false, off: false },
      { t: tr('Esai pengantar ekonomi', 'Intro economics essay'), c: tr('Ekonomi Mikro', 'Microeconomics'), due: 4, ok: false, off: false },
    ];
    let synced = false, busy = false;
    const paint = () => {
      v.innerHTML = `<div class="row"><button class="b" id="bSync" ${busy ? 'disabled' : ''}>${ic(busy ? 'loader' : 'refresh-cw', 15)}${esc(busy ? tr('Menyinkronkan…', 'Syncing…') : tr('Sinkronkan Moodle', 'Sync Moodle'))}</button><span class="sp"></span><span class="x-tag" style="cursor:default">${ic('shield-check', 13)} ${esc(tr('Token di keychain', 'Token in keychain'))}</span></div>` +
        `<div class="x-list" style="margin-top:0">${tasks.map((k, i) => `<div class="x-task ${k.ok ? 'ok' : ''}"><input type="checkbox" data-i="${i}" ${k.ok ? 'checked' : ''} aria-label="${esc(tr('Selesai', 'Done'))}"><span><b>${esc(k.t)}</b><br><small style="color:var(--muted)">${esc(k.c)}</small></span><span class="due ${k.due <= 1 ? 'soon' : ''}">${esc(tr(`${k.due} hari lagi`, `in ${k.due} days`))}</span><button class="b" data-m="${i}">${ic(k.off ? 'check' : 'download', 14)}${esc(k.off ? tr('Offline', 'Offline') : tr('Materi', 'Material'))}</button></div>`).join('')}</div>` +
        (synced ? `<p class="x-note" style="text-align:left;margin-top:14px">${esc(tr('Daftar PR dan Tabel PR otomatis diperbarui di ruang kerjamu.', 'The Homework list and table in your workspace were updated automatically.'))}</p>` : `<p class="x-note" style="text-align:left;margin-top:14px">${esc(tr('Belum disinkronkan.', 'Not synced yet.'))}</p>`);
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      if (e.target.closest('#bSync') && !busy) {
        busy = true; paint();
        setTimeout(() => {
          busy = false; synced = true;
          if (tasks.length < 4) tasks.push({ t: tr('Laporan praktikum 2', 'Lab report 2'), c: tr('Kimia Dasar', 'Basic Chemistry'), due: 6, ok: false, off: false }, { t: tr('Presentasi kelompok', 'Group presentation'), c: tr('Ekonomi Mikro', 'Microeconomics'), due: 9, ok: false, off: false });
          paint(); tick(0); toast(tr('2 tugas baru dari Moodle', '2 new tasks from Moodle'), 'graduation-cap');
        }, 1100);
        return;
      }
      const m = e.target.closest('[data-m]');
      if (m) { tasks[+m.dataset.m].off = true; paint(); tick(1); toast(tr('Materi tersimpan offline', 'Material saved offline'), 'download'); }
    });
    v.addEventListener('change', (e) => { const c = e.target.closest('input[data-i]'); if (c) { tasks[+c.dataset.i].ok = c.checked; paint(); if (c.checked) tick(2); } });
  }

  function viewTools(v) {
    const T = [
      ['film', ['Konversi video', 'Convert video'], '84 MB → 31 MB (MP4)'], ['music', ['Konversi audio', 'Convert audio'], 'WAV → MP3 (8,2 MB)'],
      ['image', ['Konversi gambar', 'Convert images'], 'HEIC → JPG (12 gambar)'], ['minimize-2', ['Kompres video', 'Compress video'], '210 MB → 48 MB'],
      ['scissors', ['Potong & gabung video', 'Trim & join video'], '00:12 → 01:05'], ['image-down', ['Kompres gambar', 'Compress images'], '9,4 MB → 1,1 MB'],
      ['copy', ['Gabung PDF', 'Merge PDF'], '3 berkas → 1 (42 hlm)'], ['split', ['Pisah PDF', 'Split PDF'], '42 hlm → 4 berkas'],
      ['file-down', ['Kompres PDF', 'Compress PDF'], '18 MB → 3,2 MB'], ['file-output', ['Dokumen ke PDF', 'Documents to PDF'], 'laporan.docx → laporan.pdf'],
      ['letter-text', ['Rename massal', 'Bulk rename'], '24 berkas diganti namanya'], ['download', ['Unduh media', 'Download media'], 'dari tautan yang kamu tempel'],
      ['braces', ['Format JSON', 'JSON formatter'], 'dirapikan, 214 baris'], ['qr-code', ['Kode QR', 'QR code'], 'kode.png (512 px)'],
    ];
    let pick = -1, used = new Set(), busy = false;
    const paint = () => {
      v.innerHTML = `<div class="x-tools">${T.map((t, i) => `<button class="x-tool ${i === pick ? 'on' : ''}" data-i="${i}">${ic(t[0], 20)}${esc(tr(...t[1]))}</button>`).join('')}</div>` +
        `<div class="x-run" id="run">${pick < 0 ? `<span>${esc(tr('Pilih alat di atas.', 'Pick a tool above.'))}</span>` : `<b>${esc(tr(...T[pick][1]))}</b><div><button class="b" id="bGo" ${busy ? 'disabled' : ''}>${ic('file-up', 15)}${esc(tr('Pakai berkas contoh', 'Use a sample file'))}</button></div><div class="x-prog" hidden><i></i></div><span id="res"></span>`}</div>`;
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      const t = e.target.closest('.x-tool');
      if (t) { pick = +t.dataset.i; busy = false; paint(); tick(0); return; }
      if (e.target.closest('#bGo') && !busy) {
        busy = true;
        const p = $('.x-prog', v), bar = $('i', p), res = $('#res', v);
        p.hidden = false; $('#bGo', v).disabled = true;
        let n = 0;
        const iv = setInterval(() => {
          n += 6 + Math.random() * 10; bar.style.width = Math.min(n, 100) + '%';
          if (n >= 100) {
            clearInterval(iv); busy = false; used.add(pick);
            res.innerHTML = `${ic('circle-check', 16)} <b>${esc(tr('Selesai.', 'Done.'))}</b> ${esc(T[pick][2])}. ${esc(tr('Diproses di komputermu, tidak ada yang diunggah.', 'Processed on your computer, nothing was uploaded.'))}`;
            $('#bGo', v).disabled = false; refreshIcons();
            tick(1); if (used.size >= 2) tick(2);
          }
        }, 110);
      }
    });
  }

  function viewSticky(v) {
    v.innerHTML = `<div class="row"><button class="b" id="bShow">${ic('sticky-note', 15)}${esc(tr('Munculkan', 'Show'))}</button><span class="x-note" style="margin:0;text-align:left">${esc(tr('atau tekan', 'or press'))} <span class="kbd">${mod} ${alt} N</span></span></div>
      <div class="x-desk" id="desk"><b>${esc(tr('Kuliah-Termodinamika.pdf', 'Lecture-Thermodynamics.pdf'))}</b>${'<div class="ln"></div>'.repeat(9)}</div>`;
    const desk = $('#desk', v);
    let n = 0;
    const make = () => {
      const el = document.createElement('div');
      el.className = 'x-note-s';
      el.style.left = (24 + (n % 4) * 34 + (desk.clientWidth > 520 ? 160 : 0)) + 'px';
      el.style.top = (50 + (n % 4) * 28) + 'px';
      n++;
      el.innerHTML = `<header><span>${ic('grip', 12)} ${esc(tr('Catatan', 'Note'))}</span><button class="x" style="all:unset;cursor:pointer" aria-label="${esc(tr('Tutup', 'Close'))}">${ic('x', 13)}</button></header><div contenteditable="true" spellcheck="false">${esc(tr('Tanya dosen soal entropi…', 'Ask the lecturer about entropy…'))}</div>`;
      desk.append(el);
      refreshIcons();
      tick(0);
      const h = $('header', el);
      let ox = 0, oy = 0, drag = false;
      h.addEventListener('pointerdown', (e) => { if (e.target.closest('.x')) return; drag = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop; h.setPointerCapture(e.pointerId); });
      h.addEventListener('pointermove', (e) => { if (drag) { el.style.left = Math.max(0, Math.min(desk.clientWidth - el.offsetWidth, e.clientX - ox)) + 'px'; el.style.top = Math.max(0, Math.min(desk.clientHeight - el.offsetHeight, e.clientY - oy)) + 'px'; } });
      h.addEventListener('pointerup', () => { if (drag) { drag = false; tick(1); } });
      $('.x', el).addEventListener('click', () => el.remove());
      $('[contenteditable]', el).addEventListener('input', () => tick(2));
    };
    v.__sticky = make;
    $('#bShow', v).addEventListener('click', make);
  }

  function viewCite(v) {
    const styles = {
      APA: 'Rahman, A., & Putri, S. (2023). Efisiensi fotosintesis pada tanaman C4. Jurnal Biologi Indonesia, 12(3), 45–58. https://doi.org/10.1234/jbi.2023.045',
      MLA: 'Rahman, Andi, and Sari Putri. “Efisiensi Fotosintesis pada Tanaman C4.” Jurnal Biologi Indonesia, vol. 12, no. 3, 2023, pp. 45–58.',
      Chicago: 'Rahman, Andi, and Sari Putri. 2023. “Efisiensi Fotosintesis pada Tanaman C4.” Jurnal Biologi Indonesia 12 (3): 45–58.',
      Harvard: 'Rahman, A. and Putri, S. (2023) ‘Efisiensi fotosintesis pada tanaman C4’, Jurnal Biologi Indonesia, 12(3), pp. 45–58.',
      IEEE: '[1] A. Rahman and S. Putri, “Efisiensi fotosintesis pada tanaman C4,” Jurnal Biologi Indonesia, vol. 12, no. 3, pp. 45–58, 2023.',
      Vancouver: 'Rahman A, Putri S. Efisiensi fotosintesis pada tanaman C4. Jurnal Biologi Indonesia. 2023;12(3):45-58.',
    };
    const exp = {
      BibTeX: '@article{rahman2023,\n  author  = {Rahman, Andi and Putri, Sari},\n  title   = {Efisiensi fotosintesis pada tanaman C4},\n  journal = {Jurnal Biologi Indonesia},\n  year    = {2023},\n  volume  = {12},\n  number  = {3},\n  pages   = {45--58},\n  doi     = {10.1234/jbi.2023.045}\n}',
      RIS: 'TY  - JOUR\nAU  - Rahman, Andi\nAU  - Putri, Sari\nTI  - Efisiensi fotosintesis pada tanaman C4\nJO  - Jurnal Biologi Indonesia\nPY  - 2023\nVL  - 12\nIS  - 3\nSP  - 45\nEP  - 58\nDO  - 10.1234/jbi.2023.045\nER  -',
    };
    let cur2 = 'APA';
    const paint = () => {
      v.innerHTML = `<div class="x-res" style="cursor:default;background:var(--paper)">${ic('file-text', 18)}<span><b>Efisiensi fotosintesis pada tanaman C4</b><small>Rahman, A., Putri, S. · Jurnal Biologi Indonesia · 2023 · DOI 10.1234/jbi.2023.045</small></span></div>
        <div class="row" style="margin-top:14px">${Object.keys(styles).map((s) => `<button class="b ${s === cur2 ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
        <div class="x-quote">${esc(styles[cur2] || exp[cur2])}</div>
        <div class="row"><button class="b" id="bCopy">${ic('copy', 15)}${esc(tr('Salin', 'Copy'))}</button><span class="sp"></span><button class="b ${cur2 === 'BibTeX' ? 'on' : ''}" data-s="BibTeX">BibTeX</button><button class="b ${cur2 === 'RIS' ? 'on' : ''}" data-s="RIS">RIS</button></div>`;
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      const s = e.target.closest('[data-s]');
      if (s) { cur2 = s.dataset.s; paint(); tick(exp[cur2] ? 1 : 0); return; }
      if (e.target.closest('#bCopy')) {
        try { navigator.clipboard.writeText(styles[cur2] || exp[cur2]); } catch (err) { /* tidak apa-apa */ }
        toast(tr('Tersalin ke papan klip', 'Copied to the clipboard'), 'copy'); tick(2);
      }
    });
  }

  function viewMcp(v) {
    let on = false, ran = false, state = '';
    const paint = () => {
      v.innerHTML = `<div class="row" style="justify-content:space-between"><span style="display:flex;gap:10px;align-items:center"><button class="x-sw-t" id="sw" role="switch" aria-checked="${on}" aria-label="MCP"></button><b>${esc(tr('Izinkan AI luar membaca catatanku', 'Let an outside AI read my notes'))}</b></span><button class="b" id="bAsk" ${on ? '' : 'disabled'}>${ic('message-circle', 15)}${esc(tr('Tanya AI', 'Ask the AI'))}</button></div>
        <div class="x-chat">${ran ? `<div class="x-msg me">${esc(tr('Rangkum catatan biologiku minggu ini jadi satu halaman.', 'Summarize my biology notes this week into one page.'))}</div>
          <div class="x-msg ai">${ic('search', 14)} ${esc(tr('Membaca 3 halaman: Ringkasan Bab 4, Peta fotosintesis, Daftar PR', 'Reading 3 pages: Chapter 4 summary, Photosynthesis map, Homework list'))}</div>
          ${state === 'ok' ? `<div class="x-prop">${ic('circle-check', 16)} <b>${esc(tr('Halaman "Ringkasan Biologi" dibuat.', 'Page "Biology summary" was created.'))}</b></div>` : state === 'no' ? `<div class="x-prop">${ic('circle-x', 16)} <b>${esc(tr('Usulan ditolak. Tidak ada yang berubah.', 'Proposal rejected. Nothing changed.'))}</b></div>` : `<div class="x-prop"><b>${esc(tr('Usulan halaman baru: Ringkasan Biologi', 'Proposed new page: Biology summary'))}</b><p style="font-size:14px;margin:4px 0 10px;color:var(--muted)">${esc(tr('Menunggu persetujuanmu. AI tidak bisa mengubah halaman yang sudah ada.', 'Waiting for your approval. The AI cannot change existing pages.'))}</p><div class="row" style="margin:0"><button class="b on" id="bOk">${ic('check', 14)}${esc(tr('Setujui', 'Approve'))}</button><button class="b" id="bNo">${esc(tr('Tolak', 'Reject'))}</button></div></div>`}` : `<p class="x-note" style="text-align:left">${esc(on ? tr('Izin aktif. Tekan Tanya AI.', 'Permission on. Press Ask the AI.') : tr('Mati. AI luar tidak bisa melihat apa pun.', 'Off. No outside AI can see anything.'))}</p>`}</div>`;
      refreshIcons();
    };
    paint();
    v.addEventListener('click', (e) => {
      if (e.target.closest('#sw')) { on = !on; if (!on) { ran = false; state = ''; } paint(); if (on) tick(0); return; }
      if (e.target.closest('#bAsk') && on) { ran = true; state = ''; paint(); tick(1); return; }
      if (e.target.closest('#bOk')) { state = 'ok'; paint(); tick(2); }
      if (e.target.closest('#bNo')) { state = 'no'; paint(); tick(2); }
    });
  }

  // ---------- Mulai, dan ikut ganti bahasa ----------
  mode();
  renderSide();
  open('doc');
  new MutationObserver(() => {
    renderSide();
    const keep = cur.k;
    open(keep);
  }).observe(root, { attributes: true, attributeFilter: ['data-lang'] });
  // Tombol pertama berdenyut sebentar sebagai ajakan untuk mulai
  const kick = $$('button[data-k]', side)[1];
  if (kick) new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { kick.classList.add('x-hint'); io.disconnect(); } }, { threshold: 0.4 }).observe($('#win'));
  setTimeout(refreshIcons, 0);
})();
