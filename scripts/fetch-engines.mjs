#!/usr/bin/env node
// Downloads the ffmpeg/ffprobe builds listed in scripts/engines.json into
// src-tauri/binaries/<name>-<target-triple>, where Tauri's `externalBin`
// expects them. Nothing here runs unless you call it (`pnpm engines`).
//
//   pnpm engines                       fetch for this machine
//   pnpm engines --target <triple>     fetch for another target
//   pnpm engines --pin                 record hashes for entries that have none
//   pnpm engines --force               re-download even if already present
//
// Security model: every archive must match the sha256 pinned in engines.json.
// Pinning (--pin) only succeeds when the hash we computed also equals the one
// the server publishes next to the file, which catches a corrupted download.
// It cannot prove the server itself is honest, so review the pin diff in git.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'scripts', 'engines.json');
const outDir = join(root, 'src-tauri', 'binaries');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const fail = (message) => {
	console.error(`\nerror: ${message}`);
	process.exit(1);
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const target = option('--target') ?? execFileSync('rustc', ['--print', 'host-tuple']).toString().trim();
const entries = manifest.targets[target];
if (!entries) {
	fail(`no engine build listed for "${target}". Supported: ${Object.keys(manifest.targets).join(', ')}.`);
}
if (target.includes('windows')) fail('Windows builds are not wired up yet.');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function download(url, file) {
	const res = await fetch(url);
	if (!res.ok) fail(`${url} -> HTTP ${res.status}`);
	writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function findFile(dir, name) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			const hit = findFile(full, name);
			if (hit) return hit;
		} else if (entry.name === name) return full;
	}
	return null;
}

mkdirSync(outDir, { recursive: true });
let pinned = false;

for (const [tool, entry] of Object.entries(entries)) {
	const dest = join(outDir, `${tool}-${target}`);
	if (existsSync(dest) && !flag('--force')) {
		console.log(`${tool}: already present (${mb(statSync(dest).size)}), skipping. Use --force to replace.`);
		continue;
	}

	const work = mkdtempSync(join(tmpdir(), `toolbox-${tool}-`));
	try {
		console.log(`${tool}: downloading ${entry.url}`);
		const zip = join(work, `${tool}.zip`);
		await download(entry.url, zip);
		const actual = sha256(zip);

		const serverText = await (await fetch(`${entry.url}.sha256`)).text();
		const published = serverText.trim().split(/\s+/)[0]?.toLowerCase();

		if (entry.sha256) {
			if (actual !== entry.sha256) {
				fail(`${tool}: sha256 mismatch.\n  pinned:   ${entry.sha256}\n  download: ${actual}\nRefusing to install.`);
			}
			console.log(`${tool}: sha256 matches the pin`);
		} else {
			if (actual !== published) {
				fail(`${tool}: download does not match the server's own checksum.\n  server:   ${published}\n  download: ${actual}`);
			}
			if (!flag('--pin')) {
				fail(`${tool}: no pinned hash yet (download matches the server checksum: ${actual}).\nRe-run with --pin to record it in scripts/engines.json, then commit that change.`);
			}
			entry.sha256 = actual;
			pinned = true;
			console.log(`${tool}: pinned ${actual}`);
		}

		const unpacked = join(work, 'unpacked');
		mkdirSync(unpacked);
		execFileSync('unzip', ['-q', zip, '-d', unpacked]);
		const binary = findFile(unpacked, tool);
		if (!binary) fail(`${tool}: archive did not contain a file named "${tool}"`);

		copyFileSync(binary, dest);
		chmodSync(dest, 0o755);
		if (process.platform === 'darwin') {
			try {
				execFileSync('codesign', ['--verify', dest], { stdio: 'ignore' });
			} catch {
				// arm64 macOS refuses to run unsigned binaries; real signing happens at bundle time.
				execFileSync('codesign', ['--force', '--sign', '-', dest], { stdio: 'ignore' });
				console.log(`${tool}: ad-hoc signed for local use`);
			}
		}
		console.log(`${tool}: installed ${dest} (${mb(statSync(dest).size)})`);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (pinned) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// The build must actually be able to produce every format the app offers.
const ffmpeg = join(outDir, `ffmpeg-${target}`);
if (target === execFileSync('rustc', ['--print', 'host-tuple']).toString().trim() && existsSync(ffmpeg)) {
	const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders']).toString();
	const have = new Set(encoders.split('\n').map((l) => l.trim().split(/\s+/)[1]));
	const missing = manifest.requiredEncoders.filter((e) => !have.has(e));
	console.log('\n' + execFileSync(ffmpeg, ['-version']).toString().split('\n')[0]);
	if (missing.length) fail(`this ffmpeg build lacks required encoders: ${missing.join(', ')}`);
	console.log(`all required encoders present (${manifest.requiredEncoders.join(', ')})`);
}

console.log('\nThese builds are GPL-licensed; see THIRD_PARTY_NOTICES.md before distributing.');
