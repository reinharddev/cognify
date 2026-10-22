import { describe, expect, it } from 'vitest';
import { computeNames, defaultRules, naturalCompare, splitName, type FileInfo, type Rules } from './rename';

const f = (name: string, mtimeMs = 0): FileInfo => ({ name, mtimeMs });
const run = (files: string[], rules: Partial<Rules>) => computeNames(files.map((n) => f(n)), { ...defaultRules, ...rules }).names;

describe('splitName', () => {
	it.each([
		['photo.jpg', 'photo', '.jpg'],
		['my.photo.final.jpg', 'my.photo.final', '.jpg'],
		['archive.tar.gz', 'archive', '.tar.gz'],
		['ARCHIVE.TAR.GZ', 'ARCHIVE', '.TAR.GZ'],
		['.gitignore', '.gitignore', ''],
		['README', 'README', ''],
		['trailing.', 'trailing.', ''],
		['.tar.gz', '.tar', '.gz']
	])('%s -> %s + %s', (name, stem, ext) => {
		expect(splitName(name)).toEqual({ stem, ext });
	});
});

describe('find and replace', () => {
	it('is literal by default and never touches the extension', () => {
		expect(run(['a.b.txt', 'xaby.txt'], { find: 'a', replace: 'Z' })).toEqual(['Z.b.txt', 'xZby.txt']);
		expect(run(['holiday.txt.txt'], { find: 'txt', replace: 'doc' })).toEqual(['holiday.txt.txt'.replace('holiday.txt', 'holiday.doc')]);
	});

	it('treats regex characters and $ patterns literally in plain mode', () => {
		expect(run(['a.b (1).txt'], { find: '.b (1)', replace: '$&$1' })).toEqual(['a$&$1.txt']);
	});

	it('supports regex with capture groups', () => {
		expect(run(['IMG_2024_05_01.jpg'], { find: '(\\d{4})_(\\d{2})_(\\d{2})', replace: '$1-$2-$3', regex: true })).toEqual(['IMG_2024-05-01.jpg']);
	});

	it('is case-insensitive unless asked', () => {
		expect(run(['Hello.txt'], { find: 'hello', replace: 'bye' })).toEqual(['bye.txt']);
		expect(run(['Hello.txt'], { find: 'hello', replace: 'bye', matchCase: true })).toEqual(['Hello.txt']);
	});

	it('can search the whole name including the extension', () => {
		expect(run(['a.jpeg'], { find: '.jpeg', replace: '.jpg', scope: 'full' })).toEqual(['a.jpg']);
		expect(run(['a.jpeg'], { find: '.jpeg', replace: '.jpg', scope: 'stem' })).toEqual(['a.jpeg']);
	});

	it('flags an invalid regex instead of throwing, and changes nothing', () => {
		const r = computeNames([f('a.txt')], { ...defaultRules, find: '(', regex: true });
		expect(r).toEqual({ names: ['a.txt'], regexError: true });
	});
});

describe('template and numbering', () => {
	it('numbers in order with start, step and zero padding', () => {
		expect(run(['x.jpg', 'y.jpg', 'z.jpg'], { template: 'Trip_{n}', start: 8, step: 2, pad: 3 })).toEqual(['Trip_008.jpg', 'Trip_010.jpg', 'Trip_012.jpg']);
		expect(run(['x.jpg', 'y.jpg'], { template: '{n}', pad: 0 })).toEqual(['1.jpg', '2.jpg']);
	});

	it('keeps the (replaced) name with {name} and inserts the modified date', () => {
		const out = computeNames([f('cat.jpg', new Date(2024, 4, 9, 12).getTime())], { ...defaultRules, template: '{date}_{name}', find: 'cat', replace: 'dog' });
		expect(out.names).toEqual(['2024-05-09_dog.jpg']);
		expect(computeNames([f('a.txt', 0)], { ...defaultRules, template: '{date}' }).names).toEqual(['0000-00-00.txt']);
	});

	it('leaves unknown tokens alone', () => {
		expect(run(['a.txt'], { template: '{name}-{foo}' })).toEqual(['a-{foo}.txt']);
	});
});

describe('tidying, case and extension', () => {
	it('replaces spaces and strips special characters, keeping unicode letters', () => {
		expect(run(['My Holiday  Photo (1).jpg'], { spaces: '_', stripSpecial: true })).toEqual(['My_Holiday_Photo_1.jpg']);
		expect(run(['Kopi susu ☕ 日本.txt'], { stripSpecial: true })).toEqual(['Kopi susu 日本.txt']);
		expect(run(['a b.txt'], { spaces: '-' })).toEqual(['a-b.txt']);
	});

	it('trims stray spaces and trailing dots when a rule is active, but keeps a leading dot', () => {
		expect(run(['  padded.  .txt'], { stripSpecial: true })).toEqual(['padded.txt']);
		expect(run(['.hidden.txt'], { stripSpecial: true })).toEqual(['.hidden.txt']);
		expect(run(['.hidden'], { spaces: '_' })).toEqual(['.hidden']);
	});

	it('default rules are an exact no-op, even for odd names', () => {
		const odd = ['  a  .txt', '.hidden', 'a.', 'trailing .txt', '...', 'x. .y'];
		expect(run(odd, {})).toEqual(odd);
	});

	it('changes letter case and extension case independently', () => {
		expect(run(['Hello World_foo-bar.JPG'], { letterCase: 'lower', extCase: 'lower' })).toEqual(['hello world_foo-bar.jpg']);
		expect(run(['Hello.jpg'], { letterCase: 'upper', extCase: 'upper' })).toEqual(['HELLO.JPG']);
		expect(run(['hELLO wORLD_foo-bar.png'], { letterCase: 'title' })).toEqual(['Hello World_Foo-Bar.png']);
		expect(run(['x.JPG'], { extCase: 'keep' })).toEqual(['x.JPG']);
	});

	it('does nothing with default rules', () => {
		expect(run(['a b.TXT', '.hidden', 'noext'], {})).toEqual(['a b.TXT', '.hidden', 'noext']);
	});
});

describe('natural sort', () => {
	it('puts img2 before img10', () => {
		expect(['img10.jpg', 'img2.jpg', 'img1.jpg'].sort(naturalCompare)).toEqual(['img1.jpg', 'img2.jpg', 'img10.jpg']);
	});
});
