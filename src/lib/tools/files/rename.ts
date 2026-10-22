// How new file names are worked out for the bulk renamer. Pure, so it is
// testable; the Rust side (rename.rs) is what checks safety and does the renaming.

export interface Rules {
	find: string;
	replace: string;
	regex: boolean;
	matchCase: boolean;
	/** Search only the part before the extension, or the whole file name. */
	scope: 'stem' | 'full';
	/** Tokens: {name} the (replaced) name, {n} counter, {date} modified date. */
	template: string;
	start: number;
	step: number;
	/** Minimum digits of {n}, zero padded. */
	pad: number;
	spaces: '' | '_' | '-' | '.';
	stripSpecial: boolean;
	letterCase: 'keep' | 'lower' | 'upper' | 'title';
	extCase: 'keep' | 'lower' | 'upper';
}

export const defaultRules: Rules = {
	find: '',
	replace: '',
	regex: false,
	matchCase: false,
	scope: 'stem',
	template: '{name}',
	start: 1,
	step: 1,
	pad: 2,
	spaces: '',
	stripSpecial: false,
	letterCase: 'keep',
	extCase: 'keep'
};

export interface FileInfo {
	name: string;
	mtimeMs: number;
}

const DOUBLE_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'];

/** "photo.final.jpg" -> ["photo.final", ".jpg"]; ".gitignore" and "README" have no extension. */
export function splitName(name: string): { stem: string; ext: string } {
	const lower = name.toLowerCase();
	for (const d of DOUBLE_EXTENSIONS) {
		if (lower.endsWith(d) && name.length > d.length) return { stem: name.slice(0, -d.length), ext: name.slice(-d.length) };
	}
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
	return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dateOf(mtimeMs: number): string {
	if (!mtimeMs) return '0000-00-00';
	const d = new Date(mtimeMs);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function titleCase(s: string): string {
	return s.replace(/[^\s_.\-]+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export interface Computed {
	names: string[];
	/** The find pattern is not a valid regular expression. */
	regexError: boolean;
}

export function computeNames(files: FileInfo[], rules: Rules): Computed {
	let finder: RegExp | null = null;
	if (rules.find !== '') {
		try {
			const flags = 'g' + (rules.matchCase ? '' : 'i');
			finder = new RegExp(rules.regex ? rules.find : escapeRegExp(rules.find), flags);
		} catch {
			return { names: files.map((f) => f.name), regexError: true };
		}
	}
	// In plain mode "$&" and friends in the replacement must stay literal.
	const replacement = rules.regex ? rules.replace : rules.replace.replace(/\$/g, '$$$$');

	const names = files.map((file, index) => {
		let { stem, ext } = splitName(file.name);

		if (finder) {
			if (rules.scope === 'full') {
				({ stem, ext } = splitName(file.name.replace(finder, replacement)));
			} else {
				stem = stem.replace(finder, replacement);
			}
		}

		if (rules.template !== '{name}') {
			const n = String(Math.max(0, rules.start + index * rules.step)).padStart(Math.max(0, rules.pad), '0');
			stem = rules.template.replace(/\{(name|n|date)\}/g, (_, token: string) =>
				token === 'name' ? stem : token === 'n' ? n : dateOf(file.mtimeMs)
			);
		}

		if (rules.spaces) stem = stem.replace(/\s+/g, rules.spaces);
		if (rules.stripSpecial) stem = stem.replace(/[^\p{L}\p{N}._\- ]/gu, '').replace(/ {2,}/g, ' ');
		// Tidy the edges only when a rule is active: with default rules the result
		// must equal the input. A leading dot (".hidden") is never removed.
		if (finder || rules.template !== '{name}' || rules.spaces || rules.stripSpecial) {
			stem = stem.replace(/^\s+|[\s.]+$/g, '');
		}

		if (rules.letterCase === 'lower') stem = stem.toLowerCase();
		else if (rules.letterCase === 'upper') stem = stem.toUpperCase();
		else if (rules.letterCase === 'title') stem = titleCase(stem);

		if (rules.extCase === 'lower') ext = ext.toLowerCase();
		else if (rules.extCase === 'upper') ext = ext.toUpperCase();

		return stem + ext;
	});
	return { names, regexError: false };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** "img2" before "img10", the way a person sorts. */
export function naturalCompare(a: string, b: string): number {
	return collator.compare(a, b);
}
