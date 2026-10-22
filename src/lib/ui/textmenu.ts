import { tr } from "$lib/i18n.svelte";
// Menu klik kanan untuk kolom teks, editor, dan teks terpilih. Menggantikan menu bawaan webview.
import { ClipboardPaste, Copy, Scissors, TextSelect } from "@lucide/svelte";
import type { MenuItem } from "$lib/stores/contextmenu.svelte";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const isField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "file", "color"].includes(el.type)));

export function editableOf(target: Element | null): Field | null {
  const el = target?.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") ?? null;
  if (!el) return null;
  if (isField(el)) return el;
  return el instanceof HTMLElement && el.isContentEditable ? el : null;
}

function selectedText(field: Field | null): string {
  if (field && isField(field)) return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  return window.getSelection()?.toString() ?? "";
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand("copy");
  }
}

export function textMenu(field: Field | null, readonly = false): MenuItem[] {
  const text = selectedText(field);
  const items: MenuItem[] = [];
  const back = () => field?.focus({ preventScroll: true });
  if (field && !readonly && !(field instanceof HTMLInputElement && field.readOnly)) {
    items.push({ label: tr("Potong", "Cut"), icon: Scissors, onclick: async () => {
      back();
      if (!text) return;
      await writeClipboard(text);
      document.execCommand("delete");
    } });
  }
  items.push({ label: tr("Salin", "Copy"), icon: Copy, onclick: async () => {
    if (text) await writeClipboard(text);
  } });
  if (field && !readonly) {
    items.push({
      label: tr("Tempel", "Paste"),
      icon: ClipboardPaste,
      onclick: async () => {
        back();
        try {
          const clip = await navigator.clipboard.readText();
          if (clip) document.execCommand("insertText", false, clip);
        } catch {
          document.execCommand("paste");
        }
      },
    });
  }
  items.push({
    label: tr("Pilih semua", "Select all"),
    icon: TextSelect,
    separator: true,
    onclick: () => {
      if (field && isField(field)) return (back(), field.select());
      back();
      document.execCommand("selectAll");
    },
  });
  return items;
}
