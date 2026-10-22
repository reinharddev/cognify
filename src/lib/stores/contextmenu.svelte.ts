// Menu klik kanan buatan sendiri, menggantikan menu bawaan webview ("Back", "Reload", "Inspect Element").

import type { Component } from "svelte";

export interface MenuItem {
  label: string;
  icon?: Component<any>;
  danger?: boolean;
  /** Baris pemisah di atas item ini. */
  separator?: boolean;
  onclick: () => void | Promise<void>;
}

class ContextMenuStore {
  items = $state<MenuItem[]>([]);
  x = $state(0);
  y = $state(0);
  open = $state(false);

  show(event: MouseEvent, items: MenuItem[]) {
    event.preventDefault();
    this.items = items;
    this.x = event.clientX;
    this.y = event.clientY;
    this.open = true;
  }

  close() {
    this.open = false;
  }
}

export const contextMenu = new ContextMenuStore();
