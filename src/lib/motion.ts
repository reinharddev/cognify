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

export const dur = (ms: number): number => (motionOff() ? 0 : ms);
