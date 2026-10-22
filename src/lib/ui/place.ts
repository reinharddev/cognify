// Letak popover di bawah pemicunya, atau di atasnya bila di bawah tidak muat.
export function place(trigger: HTMLElement, pop: HTMLElement, minWidth = 0): { left: number; top: number } {
  const r = trigger.getBoundingClientRect();
  const w = Math.max(pop.offsetWidth, minWidth);
  const h = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 4;
  const top = below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : Math.max(8, Math.min(below, window.innerHeight - h - 8));
  return { left, top };
}
