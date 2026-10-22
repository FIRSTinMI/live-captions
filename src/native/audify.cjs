// audify's addon inside the exe. scripts/compile.ts replaces audify's
// `require("bindings")("audify")` with a require of this file; `bun run` never loads it.
//
// A DLL cannot be loaded from inside the exe, and Windows resolves audify.node's imports
// (rtaudio.dll, opus.dll) from the addon's own folder or PATH. So the embedded
// build/Release folder is written to disk once per version and the addon is loaded from there.
const path = require('path');
const { rmSync, readdirSync } = require('fs');
const { writeEmbeddedFolder } = require('../util/embedded');
const { version } = require('../../package.json');

const nativeRoot = process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'live-captions', 'native')
    : path.join(process.env.HOME, '.config', 'live-captions', 'native');
const dir = path.join(nativeRoot, version);

writeEmbeddedFolder('Release', dir);
process.env.PATH = dir + path.delimiter + (process.env.PATH || '');

const addon = { exports: {} };
process.dlopen(addon, path.join(dir, 'audify.node'));
module.exports = addon.exports;

// Folders from older versions. One still loaded by a running older exe stays locked; skip it.
for (const old of readdirSync(nativeRoot)) {
    if (old === version) continue;
    try { rmSync(path.join(nativeRoot, old), { recursive: true, force: true }); } catch { }
}
