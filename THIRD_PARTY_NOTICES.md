# Third-party notices

Toolbox itself is MIT-licensed (see `LICENSE`). Release builds also ship the
programs below. Each keeps its own license, and each runs as a **separate
process** started by Toolbox; none is linked into the Toolbox executable.

## FFmpeg and FFprobe

- Version: 9.0.2 (see `scripts/engines.json` for the exact files and SHA-256 hashes).
- Built by Martin Riedl's FFmpeg build server: <https://ffmpeg.martin-riedl.de/>
- License: **GPL**. These builds enable GPL-licensed components (for example the
  x264 and x265 encoders), which makes the combined FFmpeg binaries GPL. The
  exact configuration and the licenses of every linked library are printed by
  `ffmpeg -version` and `ffmpeg -L`.
- FFmpeg source code for this version: <https://ffmpeg.org/releases/>
- The build scripts used for the binaries are published on the build server's
  site above.

If you redistribute Toolbox together with these binaries, you take on the
obligations of the GPL for them: keep this notice, include the license text, and
make the corresponding source available (the links above are the source offer
for the unmodified FFmpeg release and its build recipe). Toolbox's own code is
not affected, because it only launches FFmpeg as a separate program.

This file is information for maintainers, not legal advice. If you plan to
distribute commercially, have the licensing reviewed.

## Downloaded on demand (not shipped in the installer)

Fetched by the user from inside the app, checksum-verified, and run or read from
the app's own folder:

- **yt-dlp**, Unlicense (public domain), <https://github.com/yt-dlp/yt-dlp>.
  Runs as a separate program.

## Used if present, or installed by the user from inside the app

- **LibreOffice**, MPL-2.0 (<https://www.libreoffice.org>). Not shipped in the
  installer. The "Documents to PDF" tool finds an existing install, or (macOS) the user
  can have the app download the official disk image (hash pinned in `src-tauri/engines.json`)
  and copy it into the app's data folder. It runs headless as a separate program.

## Linked into the app

- **lopdf**, **image**, **zune-jpeg** and friends (MIT, Apache-2.0, Zlib).
- **qrcode** (MIT) and **jsQR** (Apache-2.0) in the interface.
- **Tauri** (MIT or Apache-2.0), **Svelte** (MIT), **Lucide icons** (ISC).

An audit of the 380 Rust crates linked for macOS found no GPL, LGPL or AGPL code.
Five crates are **MPL-2.0**, a file-level copyleft that only requires their own
source files to stay available when modified; they are used unmodified, as
dependencies of Tauri's HTML handling: `cssparser`, `cssparser-macros`,
`dtoa-short`, `selectors` and `option-ext`. The JavaScript packages that ship are
MIT, ISC or Apache-2.0, except citeproc-js (AGPL-3.0 option, see Citations below).

The complete lists are in `src-tauri/Cargo.lock` and `pnpm-lock.yaml`.

## Citations (Cite)

- **citeproc-js** (Frank Bennett), the CSL processing engine. Dual-licensed CPAL-1.0 or AGPL-3.0-or-later; Cognify uses it under the AGPL-3.0, the licence of Cognify itself. https://github.com/Juris-M/citeproc-js
- **CSL styles and locales** from the Citation Style Language project (APA 7, MLA 9, Chicago 18 author-date and notes, Cite Them Right 12 Harvard, IEEE, NLM/Vancouver, ISO 690 author-date and numeric; locales en-US and id-ID), https://github.com/citation-style-language/styles and /locales, licensed CC BY-SA 3.0 (Creative Commons Attribution-ShareAlike). They are bundled unmodified in `src/lib/cite/styles` and `src/lib/cite/locales`.
