// Durasi untuk transisi Svelte yang mengikuti pengaturan animasi: 0 bila animasi dimatikan atau sistem
// meminta gerak dikurangi. Animasi CSS dimatikan sendiri oleh app.css.

export function motionOff(): boolean {
  if (typeof document === "undefined") return true;
  if (document.documentElement.dataset.motion === "off") return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Efek klik: satu elemen cincin dipakai ulang dan dianimasikan lewat Web Animations
 * (transform dan opacity saja). Hanya untuk target yang bisa diklik, dan mati bersama pengaturan animasi.
 */
export function startClickFx(): () => void {
  const ring = document.createElement("div");
  ring.className = "click-fx";
  ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring);
  let running: Animation | null = null;

  const onDown = (e: PointerEvent) => {
    if (motionOff() || e.button !== 0) return;
    const target = e.target as Element | null;
    if (!target?.closest("button, a, .btn, [role=button], [role=option], summary")) return;
    if ((target.closest("button") as HTMLButtonElement | null)?.disabled) return;
    running?.cancel();
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    running = ring.animate(
      [
        { transform: "scale(0.2)", opacity: 0.55 },
        { transform: "scale(1.3)", opacity: 0 },
      ],
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };
  addEventListener("pointerdown", onDown, { passive: true });
  return () => {
    removeEventListener("pointerdown", onDown);
    running?.cancel();
    ring.remove();
  };
}

/** Nama ikon Lucide -> gerak saat hover (didefinisikan di app.css). Yang tak terdaftar memakai "draw". Semua gerak sekali putar tiap kali kursor masuk. */
const ICON_MOTION: Record<string, string> = {
  house: "hop", home: "hop", inbox: "nudge-d", download: "nudge-d", "arrow-down": "nudge-d", "arrow-up": "nudge-u",
  "arrow-up-down": "nudge-d", "calendar-days": "cal", calendar: "cal", bell: "swing", search: "scan", wrench: "wrench",
  settings: "spin", "refresh-cw": "spin-fast", "rotate-ccw": "spin-rev", shapes: "shapes", plus: "plus", x: "plus",
  "trash-2": "trash", trash: "trash", "file-text": "doc", "table-2": "table", notch: "notch", star: "twinkle", sparkles: "twinkle", check: "pop", "chevron-right": "nudge-r",
  "chevron-left": "nudge-l", "external-link": "nudge-ne", hash: "wobble", menu: "squeeze", "more-horizontal": "dots",
  ellipsis: "dots", video: "pulse", music: "sway", image: "pulse", scissors: "snip", "minimize-2": "shrink",
  merge: "nudge-u", split: "nudge-d", presentation: "sway",
};

/**
 * Ikon bergerak sesuai maknanya saat hover (lihat app.css): pada hover pertama svg diberi data-anim dari peta
 * di atas; ikon tak terdaftar diberi "draw" (garis digambar ulang) dan pathLength=1 agar dash-nya pas.
 */
export function startIconFx(): () => void {
  const SHAPES = "path, line, polyline, polygon, circle, rect, ellipse";
  const onOver = (e: PointerEvent) => {
    const host = (e.target as Element | null)?.closest?.("button, a, summary, .btn, [role=button], [role=option]");
    for (const icon of host?.querySelectorAll<SVGElement>("svg.lucide-icon:not([data-anim])") ?? []) {
      const name = [...icon.classList].find((c) => c.startsWith("lucide-") && c !== "lucide-icon")?.slice(7) ?? "";
      const anim = ICON_MOTION[name] ?? "draw";
      icon.dataset.anim = anim;
      // pathLength=1 supaya dash selalu pas untuk gerak yang menggambar garis (draw, doc, table).
      if (anim === "draw" || anim === "doc" || anim === "table") for (const s of icon.querySelectorAll(SHAPES)) s.setAttribute("pathLength", "1");
      // Benda yang masuk ke tempat sampah.
      if (anim === "trash") icon.insertAdjacentHTML("beforeend", '<rect class="fx-obj" x="9.5" y="-1" width="5" height="6" rx="1.2"></rect>');
    }
  };
  addEventListener("pointerover", onOver, { passive: true });
  return () => removeEventListener("pointerover", onOver);
}

export const dur = (ms: number): number => (motionOff() ? 0 : ms);
