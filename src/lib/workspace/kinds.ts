// Jenis halaman: ikon dan nama untuk sidebar, pencarian, sampah, tag, dan halaman itu sendiri.

import { FileText, Folder, Shapes, Table2 } from "@lucide/svelte";
import type { PageKind } from "./types";

export const KIND_ICON = { doc: FileText, board: Shapes, table: Table2, folder: Folder } as const;
export const KIND_LABEL: Record<PageKind, string> = { doc: "Dokumen", board: "Papan", table: "Tabel", folder: "Folder" };

export const kindIcon = (kind: string) => KIND_ICON[kind as PageKind] ?? FileText;
