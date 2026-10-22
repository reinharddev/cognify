import { describe, expect, it } from 'vitest';
import { JsonParseError, errorExcerpt, formatJson, parseJson } from './json';

const pretty2 = { indent: '  ', sortKeys: false };
const minify = { indent: '', sortKeys: false };

function errorOf(text: string): JsonParseError {
	try {
		parseJson(text);
	} catch (e) {
		if (e instanceof JsonParseError) return e;
		throw e;
	}
	throw new Error(`expected a parse error for ${JSON.stringify(text)}`);
}

describe('formatting keeps the document as written', () => {
	it('does not touch number literals JSON.parse would mangle', () => {
		const text = '{"big":12345678901234567890,"float":1.0,"exp":1E+2,"neg":-0.50}';
		expect(formatJson(text, minify)).toBe(text);
		// the reason this parser exists:
		expect(JSON.stringify(JSON.parse(text))).not.toBe(text);
	});

	it('keeps duplicate keys, key order and string escapes', () => {
		const text = '{"b":1,"a":2,"b":3,"é":"\\u00e9\\n\\"q\\""}';
		expect(formatJson(text, minify)).toBe(text);
	});

	it('pretty prints with the chosen indent, keeping empty containers compact', () => {
		const text = '{"a":[1,{"b":null}],"e":{},"f":[]}';
		expect(formatJson(text, pretty2)).toBe(
			'{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "e": {},\n  "f": []\n}'
		);
		expect(formatJson('[1]', { indent: '\t', sortKeys: false })).toBe('[\n\t1\n]');
	});

	it('round-trips: minify(pretty(x)) equals minify(x)', () => {
		const text = ' { "k" : [ true , false , null , "s" , 0 , -1.5e3 ] , "n" : { "m" : [ ] } } ';
		const compact = formatJson(text, minify);
		expect(formatJson(formatJson(text, pretty2), minify)).toBe(compact);
		expect(JSON.parse(compact)).toEqual(JSON.parse(text));
	});

	it('sorts keys at every level, by decoded key, stably for duplicates', () => {
		const out = formatJson('{"b":{"z":1,"a":2},"a":[{"d":1,"c":2}],"\\u0061a":0,"b":9}', { indent: '', sortKeys: true });
		// ordered by the decoded key ("aa" is "aa"), but written exactly as given
		expect(out).toBe('{"a":[{"c":2,"d":1}],"\\u0061a":0,"b":{"a":2,"z":1},"b":9}');
	});

	it('ignores a byte order mark', () => {
		expect(formatJson('﻿{"a":1}', minify)).toBe('{"a":1}');
	});
});

describe('errors say what is wrong and where', () => {
	it.each([
		['{"a":1,}', 'expectedKey', 1, 8],
		['{"a":1 "b":2}', 'expectedCommaOrEnd', 1, 8],
		['{"a" 1}', 'expectedColon', 1, 6],
		['[1,2', 'unexpectedEnd', 1, 5],
		['[1 2]', 'expectedCommaOrEnd', 1, 4],
		['{"a":}', 'expectedValue', 1, 6],
		['{\n  "a": 01\n}', 'badNumber', 2, 8],
		['{"a": 1.}', 'badNumber', 1, 7],
		['{"a": -}', 'badNumber', 1, 7],
		['{"a": 1e}', 'badNumber', 1, 7],
		['"abc', 'badString', 1, 1],
		['"a\\qb"', 'badEscape', 1, 3],
		['"a\\u12"', 'badEscape', 1, 3],
		['"tab\there"', 'controlChar', 1, 5],
		['{} x', 'trailingData', 1, 4],
		['   ', 'empty', 1, 4],
		['', 'empty', 1, 1],
		['nul', 'expectedValue', 1, 1],
		["{'a':1}", 'expectedKey', 1, 2]
	])('%j -> %s at %i:%i', (text, code, line, column) => {
		const e = errorOf(text);
		expect([e.code, e.line, e.column]).toEqual([code, line, column]);
	});

	it('reports line and column across lines', () => {
		const e = errorOf('{\n  "a": 1,\n  "b": [1, 2,\n  ]\n}');
		expect([e.code, e.line, e.column]).toEqual(['expectedValue', 4, 3]);
	});

	it('refuses absurd nesting instead of overflowing the stack', () => {
		const deep = '['.repeat(600) + ']'.repeat(600);
		expect(errorOf(deep).code).toBe('tooDeep');
		// and ordinary depth is fine
		expect(() => parseJson('['.repeat(100) + ']'.repeat(100))).not.toThrow();
	});

	it('rejects what JSON.parse also rejects, and accepts what it accepts', () => {
		const samples = ['{}', '[]', '1', '"x"', 'true', 'null', '-0', '1e5', '{"a":[1,2,{"b":"c"}]}', '[1,]', '{"a":1,}', '{a:1}', '01', '+1', '.5', '1.', 'NaN', "'x'", '[1 2]', '{"a"}', '[,]', 'undefined'];
		for (const s of samples) {
			let native = true;
			try {
				JSON.parse(s);
			} catch {
				native = false;
			}
			let ours = true;
			try {
				parseJson(s);
			} catch {
				ours = false;
			}
			expect(ours, s).toBe(native);
		}
	});

	it('excerpt puts the caret under the column', () => {
		const text = '{"a": 1,\n  "b" 2}';
		const e = errorOf(text);
		expect(errorExcerpt(text, e)).toEqual({ line: '  "b" 2}', caret: '      ^' });
	});
});
