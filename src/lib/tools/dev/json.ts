// A strict RFC 8259 JSON parser that keeps the document as written.
//
// JSON.parse is not good enough for a formatter: it turns 12345678901234567890
// into 12345678901234567000, 1.0 into 1, drops duplicate keys, and (in WebKit)
// reports errors without a position. This parser keeps number and string
// tokens verbatim, keeps key order and duplicates, and reports line/column.

export type JsonNode =
	| { t: 'obj'; members: { key: string; keyRaw: string; value: JsonNode }[] }
	| { t: 'arr'; items: JsonNode[] }
	| { t: 'str'; raw: string }
	| { t: 'num'; raw: string }
	| { t: 'lit'; raw: 'true' | 'false' | 'null' };

export type JsonErrorCode =
	| 'empty'
	| 'unexpectedEnd'
	| 'unexpectedChar'
	| 'expectedValue'
	| 'expectedKey'
	| 'expectedColon'
	| 'expectedCommaOrEnd'
	| 'badString'
	| 'badEscape'
	| 'controlChar'
	| 'badNumber'
	| 'trailingData'
	| 'tooDeep';

export class JsonParseError extends Error {
	constructor(
		public code: JsonErrorCode,
		public offset: number,
		public line: number,
		public column: number,
		public found?: string
	) {
		super(`${code} at ${line}:${column}`);
	}
}

const MAX_DEPTH = 512;

function lineColumn(text: string, offset: number): [number, number] {
	let line = 1;
	let lineStart = 0;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return [line, offset - lineStart + 1];
}

class Parser {
	i = 0;
	constructor(readonly s: string) {}

	fail(code: JsonErrorCode, offset = this.i): never {
		const [line, column] = lineColumn(this.s, offset);
		const found = offset < this.s.length ? this.s[offset] : undefined;
		throw new JsonParseError(code, offset, line, column, found);
	}

	ws() {
		for (;;) {
			const c = this.s.charCodeAt(this.i);
			if (c === 32 || c === 9 || c === 10 || c === 13) this.i++;
			else return;
		}
	}

	parseDocument(): JsonNode {
		this.ws();
		if (this.i >= this.s.length) this.fail('empty');
		const node = this.value(0);
		this.ws();
		if (this.i < this.s.length) this.fail('trailingData');
		return node;
	}

	value(depth: number): JsonNode {
		if (depth > MAX_DEPTH) this.fail('tooDeep');
		const c = this.s[this.i];
		if (c === undefined) this.fail('unexpectedEnd');
		if (c === '{') return this.object(depth);
		if (c === '[') return this.array(depth);
		if (c === '"') return { t: 'str', raw: this.string() };
		if (c === '-' || (c >= '0' && c <= '9')) return { t: 'num', raw: this.number() };
		for (const word of ['true', 'false', 'null'] as const) {
			if (this.s.startsWith(word, this.i)) {
				this.i += word.length;
				return { t: 'lit', raw: word };
			}
		}
		return this.fail('expectedValue');
	}

	object(depth: number): JsonNode {
		this.i++; // {
		const members: { key: string; keyRaw: string; value: JsonNode }[] = [];
		this.ws();
		if (this.s[this.i] === '}') {
			this.i++;
			return { t: 'obj', members };
		}
		for (;;) {
			this.ws();
			if (this.i >= this.s.length) this.fail('unexpectedEnd');
			if (this.s[this.i] !== '"') this.fail('expectedKey');
			const keyRaw = this.string();
			this.ws();
			if (this.i >= this.s.length) this.fail('unexpectedEnd');
			if (this.s[this.i] !== ':') this.fail('expectedColon');
			this.i++;
			this.ws();
			const value = this.value(depth + 1);
			members.push({ key: JSON.parse(keyRaw) as string, keyRaw, value });
			this.ws();
			const c = this.s[this.i];
			if (c === ',') {
				this.i++;
				continue;
			}
			if (c === '}') {
				this.i++;
				return { t: 'obj', members };
			}
			this.fail(c === undefined ? 'unexpectedEnd' : 'expectedCommaOrEnd');
		}
	}

	array(depth: number): JsonNode {
		this.i++; // [
		const items: JsonNode[] = [];
		this.ws();
		if (this.s[this.i] === ']') {
			this.i++;
			return { t: 'arr', items };
		}
		for (;;) {
			this.ws();
			items.push(this.value(depth + 1));
			this.ws();
			const c = this.s[this.i];
			if (c === ',') {
				this.i++;
				continue;
			}
			if (c === ']') {
				this.i++;
				return { t: 'arr', items };
			}
			this.fail(c === undefined ? 'unexpectedEnd' : 'expectedCommaOrEnd');
		}
	}

	string(): string {
		const start = this.i;
		this.i++; // opening quote
		for (;;) {
			if (this.i >= this.s.length) this.fail('badString', start);
			const c = this.s.charCodeAt(this.i);
			if (c === 34) {
				this.i++;
				return this.s.slice(start, this.i);
			}
			if (c < 0x20) this.fail('controlChar');
			if (c === 92) {
				const e = this.s[this.i + 1];
				if (e !== undefined && '"\\/bfnrt'.includes(e)) {
					this.i += 2;
				} else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(this.s.slice(this.i + 2, this.i + 6))) {
					this.i += 6;
				} else {
					this.fail('badEscape');
				}
			} else {
				this.i++;
			}
		}
	}

	number(): string {
		const start = this.i;
		const digits = () => {
			const from = this.i;
			while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++;
			return this.i - from;
		};
		if (this.s[this.i] === '-') this.i++;
		if (this.s[this.i] === '0') {
			this.i++;
			if (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.fail('badNumber', start); // 01
		} else if (digits() === 0) {
			this.fail('badNumber', start);
		}
		if (this.s[this.i] === '.') {
			this.i++;
			if (digits() === 0) this.fail('badNumber', start);
		}
		if (this.s[this.i] === 'e' || this.s[this.i] === 'E') {
			this.i++;
			if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++;
			if (digits() === 0) this.fail('badNumber', start);
		}
		return this.s.slice(start, this.i);
	}
}

export function parseJson(text: string): JsonNode {
	return new Parser(text).parseDocument();
}

export interface FormatOptions {
	/** Indent unit ("  ", "    ", "\t"), or "" to minify. */
	indent: string;
	sortKeys: boolean;
}

/** Compares by decoded key in UTF-16 code unit order, like Array.prototype.sort. */
function byKey(a: { key: string }, b: { key: string }): number {
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function stringifyJson(node: JsonNode, { indent, sortKeys }: FormatOptions): string {
	const pretty = indent !== '';
	const out: string[] = [];

	const emit = (n: JsonNode, level: number) => {
		switch (n.t) {
			case 'str':
			case 'num':
			case 'lit':
				out.push(n.raw);
				return;
			case 'arr': {
				if (n.items.length === 0) return void out.push('[]');
				out.push('[');
				n.items.forEach((item, i) => {
					if (i > 0) out.push(',');
					if (pretty) out.push('\n', indent.repeat(level + 1));
					emit(item, level + 1);
				});
				if (pretty) out.push('\n', indent.repeat(level));
				out.push(']');
				return;
			}
			case 'obj': {
				if (n.members.length === 0) return void out.push('{}');
				const members = sortKeys ? [...n.members].sort(byKey) : n.members;
				out.push('{');
				members.forEach((m, i) => {
					if (i > 0) out.push(',');
					if (pretty) out.push('\n', indent.repeat(level + 1));
					out.push(m.keyRaw, pretty ? ': ' : ':');
					emit(m.value, level + 1);
				});
				if (pretty) out.push('\n', indent.repeat(level));
				out.push('}');
				return;
			}
		}
	};

	emit(node, 0);
	return out.join('');
}

/** Parse + format in one go. Throws JsonParseError. */
export function formatJson(text: string, options: FormatOptions): string {
	return stringifyJson(parseJson(text.replace(/^﻿/, '')), options);
}

/** The offending line and a caret under the column, for showing an error. */
export function errorExcerpt(text: string, error: JsonParseError): { line: string; caret: string } {
	const line = text.split('\n')[error.line - 1] ?? '';
	const MAX = 120;
	const from = Math.max(0, error.column - 1 - MAX / 2);
	const shown = line.slice(from, from + MAX).replace(/\r$/, '');
	return { line: shown, caret: ' '.repeat(Math.max(0, error.column - 1 - from)) + '^' };
}
