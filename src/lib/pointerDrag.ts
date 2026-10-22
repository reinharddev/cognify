// Seret berbasis pointer. Seret HTML5 tidak sampai ke halaman di jendela Tauri karena webview
// mencegatnya untuk menjatuhkan berkas (dragDropEnabled), jadi daftar halaman dan papan memakai ini.

export interface PointerDrag {
  /** Dipanggil sekali setelah pointer bergeser melewati ambang. */
  onStart?: () => void;
  /** Dipanggil setiap pointer bergerak selama menyeret. */
  onMove: (x: number, y: number) => void;
  /** Dipanggil saat dilepas (cancelled = true bila dibatalkan dengan Esc atau pointercancel). */
  onEnd: (x: number, y: number, cancelled: boolean) => void;
}

const THRESHOLD = 5;

/** Mulai menyeret `source` dari `event`. Tidak melakukan apa pun sampai pointer benar-benar bergeser. */
export function startPointerDrag(event: PointerEvent, source: HTMLElement, drag: PointerDrag): void {
  if (event.button !== 0 || !event.isPrimary) return;
  const sx = event.clientX;
  const sy = event.clientY;
  const box = source.getBoundingClientRect();
  let active = false;
  let ghost: HTMLElement | null = null;

  const place = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${x - sx + box.left}px, ${y - sy + box.top}px)`;
  };

  const finish = (x: number, y: number, cancelled: boolean) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
    ghost?.remove();
    document.documentElement.classList.remove("ptr-drag");
    if (!active) return;
    // Lepasan tidak boleh dianggap klik pada kartu atau baris yang disorot.
    const swallow = (e: Event) => e.stopPropagation();
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, true), 0);
    drag.onEnd(x, y, cancelled);
  };

  const move = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < THRESHOLD) return;
      active = true;
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      ghost.style.width = `${box.width}px`;
      ghost.style.height = `${box.height}px`;
      document.body.appendChild(ghost);
      document.documentElement.classList.add("ptr-drag");
      drag.onStart?.();
    }
    place(e.clientX, e.clientY);
    drag.onMove(e.clientX, e.clientY);
  };
  const up = (e: PointerEvent) => finish(e.clientX, e.clientY, false);
  const cancel = (e: PointerEvent) => finish(e.clientX, e.clientY, true);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(sx, sy, true);
  };

  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key, true);
}
