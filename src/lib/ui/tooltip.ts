// Tooltip buatan sendiri. Atribut `title` bawaan memunculkan balon sistem, jadi dipindah ke `data-tip`
// begitu penunjuk menyentuh elemennya, lalu ditampilkan dengan balon sendiri.
export function installTooltips(): () => void {
  const tip = document.createElement("div");
  tip.className = "cog-tip";
  tip.setAttribute("role", "tooltip");
  Object.assign(tip.style, {
    position: "fixed", zIndex: "400", pointerEvents: "none", opacity: "0", maxWidth: "260px",
    padding: "5px 9px", borderRadius: "8px", background: "var(--text)", color: "var(--surface)",
    fontSize: "12.5px", lineHeight: "1.35", transition: "opacity 0.12s", boxShadow: "0 4px 14px var(--shadow-4)",
  });
  document.body.append(tip);

  let timer = 0;
  let owner: Element | null = null;

  const hide = () => {
    clearTimeout(timer);
    tip.style.opacity = "0";
    owner = null;
  };

  const show = (el: Element) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    owner = el;
    tip.textContent = text;
    const r = el.getBoundingClientRect();
    tip.style.left = "0px";
    tip.style.top = "0px";
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const above = r.top - h - 8 >= 6;
    tip.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6))}px`;
    tip.style.top = `${above ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 6)}px`;
    tip.style.opacity = "1";
  };

  const over = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.("[title], [data-tip]");
    if (!el || el === owner) return;
    hide();
    const t = el.getAttribute("title");
    if (t !== null) {
      el.removeAttribute("title");
      if (t) el.setAttribute("data-tip", t);
    }
    if (!el.getAttribute("data-tip")) return;
    timer = window.setTimeout(() => show(el), 450);
  };
  const out = (e: PointerEvent) => {
    if (owner || timer) {
      const to = e.relatedTarget as Node | null;
      if (!owner || !to || !owner.contains(to)) hide();
    }
  };

  document.addEventListener("pointerover", over);
  document.addEventListener("pointerout", out);
  document.addEventListener("pointerdown", hide, true);
  window.addEventListener("blur", hide);
  document.addEventListener("scroll", hide, true);
  return () => {
    hide();
    tip.remove();
    document.removeEventListener("pointerover", over);
    document.removeEventListener("pointerout", out);
    document.removeEventListener("pointerdown", hide, true);
    window.removeEventListener("blur", hide);
    document.removeEventListener("scroll", hide, true);
  };
}
