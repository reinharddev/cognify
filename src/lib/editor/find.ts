// Cari di dalam dokumen: semua kemunculan disorot, satu yang aktif. Teks yang terpotong oleh format (sebagian tebal,
// sebagian miring) tetap ketemu karena pencarian dilakukan per paragraf, bukan per potongan teks.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  matchCase: boolean;
  matches: FindMatch[];
  index: number;
}

export const findKey = new PluginKey<FindState>("find");

const EMPTY: FindState = { query: "", matchCase: false, matches: [], index: 0 };

/** Semua kemunculan `query` di dokumen. Simpul non-teks (gambar, rumus) dihitung satu karakter yang tidak pernah cocok. */
export function findMatches(doc: PMNode, query: string, matchCase: boolean): FindMatch[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = []; // posisi dokumen untuk tiap karakter teks
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          text += child.text![i];
          map.push(start + i);
        }
      } else {
        text += "￼";
        map.push(start);
      }
    });
    const hay = matchCase ? text : text.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      out.push({ from: map[at], to: map[at + needle.length - 1] + 1 });
      at = hay.indexOf(needle, at + needle.length);
    }
    return false;
  });
  return out;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    find: {
      setFind: (query: string, matchCase?: boolean) => ReturnType;
      findStep: (direction: 1 | -1) => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

export const Find = Extension.create({
  name: "find",
  addCommands() {
    return {
      setFind: (query, matchCase = false) => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(findKey, { query, matchCase, index: 0 }));
        return true;
      },
      findStep: (direction) => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        if (!s?.matches.length) return false;
        const index = (s.index + direction + s.matches.length) % s.matches.length;
        dispatch?.(tr.setMeta(findKey, { index }));
        return true;
      },
      clearFind: () => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(findKey, { query: "", matchCase: false, index: 0 }));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const matchCase = meta?.matchCase ?? prev.matchCase;
            const matches = findMatches(tr.doc, query, matchCase);
            const wanted = meta?.index ?? prev.index;
            return { query, matchCase, matches, index: matches.length ? Math.min(Math.max(wanted, 0), matches.length - 1) : 0 };
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "find-hit find-current" : "find-hit" })),
            );
          },
        },
      }),
    ];
  },
});
