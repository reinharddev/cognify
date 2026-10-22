import type { Component } from 'svelte';

export type Category =
	| 'video'
	| 'audio'
	| 'image'
	| 'pdf'
	| 'document'
	| 'download'
	| 'developer';

export type Localized = { id: string; en: string };

/**
 * Every tool is described by one manifest. The sidebar, home grid and command
 * palette are all generated from the registry, so adding a tool means adding
 * a manifest and (optionally) a component, nothing else.
 */
export interface ToolManifest {
	id: string;
	category: Category;
	icon: Component<any>;
	name: Localized;
	description: Localized;
	/** Extra search terms, in both languages, e.g. "kecilkan", "shrink". */
	keywords: string[];
	status: 'ready' | 'soon';
	/** Disembunyikan dari menu dan pencarian, dan tidak bisa dibuka lewat alamat langsung. */
	hidden?: boolean;
	load?: () => Promise<{ default: Component<any> }>;
	props?: Record<string, unknown>;
}
