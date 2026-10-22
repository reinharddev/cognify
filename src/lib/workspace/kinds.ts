import { i18n } from "$lib/i18n.svelte";
// Jenis halaman: ikon dan nama untuk sidebar, pencarian, sampah, tag, dan halaman itu sendiri.

import { FileText, Folder, Shapes, Table2 } from "@lucide/svelte";
import type { PageKind } from "./types";

export const KIND_ICON = { doc: FileText, board: Shapes, table: Table2, folder: Folder } as const;
const KIND_EN: Record<PageKind, string> = { doc: "Document", board: "Board", table: "Table", folder: "Folder" };
const KIND_ID: Record<PageKind, string> = { doc: "Dokumen", board: "Papan", table: "Tabel", folder: "Folder" };
export const kindLabel = (kind: PageKind) => (i18n.lang === "en" ? KIND_EN[kind] : KIND_ID[kind]);

export const kindIcon = (kind: string) => KIND_ICON[kind as PageKind] ?? FileText;
