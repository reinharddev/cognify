// Skrip situs Cognify: ganti bahasa, warna latar mengikuti bagian yang sedang dibaca, animasi masuk,
// dan ikon. Teks Indonesia ada langsung di index.html; teks Inggris ada di atribut data-en elemennya.
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const icons = () => window.lucide && window.lucide.createIcons();

  // ---------- Bahasa ----------
  const original = new Map();
  $$('[data-en]').forEach((el) => original.set(el, el.innerHTML));
  const meta = {
    id: {
      title: document.title,
      desc: document.querySelector('meta[name="description"]').content,
    },
    en: {
      title: 'Cognify: offline notes, whiteboards, tables, a calendar, and study tools',
      desc: 'Cognify is a local workspace for documents, whiteboards, tables, a calendar, floating notes, and 14 PDF, video, and image tools. Free, open source, no account, and no built-in AI.',
    },
  };

  function apply(lang) {
    root.lang = lang;
    root.dataset.lang = lang;
    $$('[data-en]').forEach((el) => { el.innerHTML = lang === 'en' ? el.dataset.en : original.get(el); });
    document.title = meta[lang].title;
    document.querySelector('meta[name="description"]').content = meta[lang].desc;
    const b = document.getElementById('langBtn');
    b.textContent = lang === 'en' ? 'ID' : 'EN';
    b.setAttribute('aria-label', lang === 'en' ? 'Ganti ke Bahasa Indonesia' : 'Switch to English');
    icons();
    splitTitle();
  }

  document.getElementById('langBtn').addEventListener('click', () => {
    const next = root.dataset.lang === 'en' ? 'id' : 'en';
    try { localStorage.setItem('lang', next); } catch (e) {}
    document.body.classList.add('lang-out');
    setTimeout(() => { apply(next); document.body.classList.remove('lang-out'); }, 160);
  });

  // ---------- Judul pembuka muncul per kata ----------
  function splitTitle() {
    if (!root.classList.contains('motion')) return;
    const h1 = document.querySelector('h1');
    if (!h1 || h1.dataset.split === root.lang) return;
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(part); return; }
            const w = document.createElement('span');
            w.className = 'w';
            w.style.setProperty('--i', i++);
            w.textContent = part;
            frag.append(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(h1);
    h1.dataset.split = root.lang;
  }

  // ---------- Warna latar mengikuti bagian yang berada di tengah layar ----------
  const tinted = $$('[data-bg]');
  const dark = new Set(['#2a2559']);
  let current = '';
  function paint() {
    const mid = innerHeight * 0.45;
    let color = tinted[0] ? tinted[0].dataset.bg : '#f4efe6';
    for (const el of tinted) {
      const r = el.getBoundingClientRect();
      if (r.top < mid && r.bottom > mid) color = el.dataset.bg;
    }
    if (color === current) return;
    current = color;
    document.body.style.setProperty('--bg', color);
    document.body.classList.toggle('dark', dark.has(color));
  }
  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { paint(); ticking = false; }); } }, { passive: true });
  addEventListener('resize', paint);

  // ---------- Bagian muncul saat digulir ----------
  if (root.classList.contains('motion') && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    $$('.rv').forEach((el) => io.observe(el));
  }

  // ---------- Mulai ----------
  apply(root.dataset.lang === 'en' ? 'en' : 'id');
  paint();
})();
