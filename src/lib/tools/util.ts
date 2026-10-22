import { getContext } from 'svelte';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const extOf = (path: string) => fileName(path).split('.').pop()?.toLowerCase() ?? '';
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "90", "1:30", "1:02:03.5" or "1.5" -> seconds. null when it is not a time. */
export function parseTime(text: string): number | null {
	const parts = text.trim().split(':');
	if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
	return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** seconds -> "m:ss.s" (or "h:mm:ss.s"), the inverse of parseTime. */
export function formatClock(seconds: number): string {
	const total = Math.max(0, seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = (total % 60).toFixed(1).padStart(4, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDuration(seconds: number): string {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Listens for files dropped onto the window. Returns a cleanup function
 * (shaped for onMount's return value).
 */
/** Context key under which ToolPane tells a tool whether it is the visible one. */
export const ACTIVE_KEY = Symbol('tool-active');

export function listenFileDrop(
	onDrop: (paths: string[]) => void,
	onHover: (hovering: boolean) => void
): () => void {
	// Hidden (kept-alive) tools must not react to files dropped on the visible one.
	let isActive: (() => boolean) | undefined;
	try {
		isActive = getContext<() => boolean>(ACTIVE_KEY);
	} catch {
		isActive = undefined;
	}
	const unlisten = getCurrentWebview().onDragDropEvent((e) => {
		if (isActive && !isActive()) return;
		const type = e.payload.type;
		if (type === 'enter' || type === 'over') onHover(true);
		else if (type === 'leave') onHover(false);
		else if (type === 'drop') {
			onHover(false);
			onDrop(e.payload.paths);
		}
	});
	return () => {
		unlisten.then((fn) => fn());
	};
}
