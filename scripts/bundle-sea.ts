// Bundles src/index.ts into one CommonJS file for the Node SEA build.
//
// Why this exists, when scripts/compile.ts (the Bun version) didn't need it: a Node SEA's main
// script runs through a restricted `embedderRequire` that only resolves Node's own builtins -
// bare `require('express')`/`require('audify')` for an on-disk node_modules package throws
// ERR_UNKNOWN_BUILTIN_MODULE even though node_modules sits right next to the binary. Bun's
// `--compile` bundles the whole dependency graph into the binary itself, so it never hits this.
// Node SEA expects you to have already produced a single self-contained CJS file (any bundler),
// so this step exists only because Node's own doesn't do it for you.
//
// Same audify wrinkle as compile.ts: audify's index.js loads its addon via
// `require("bindings")("audify")`, which can't find a prebuilt binary that isn't a real file on
// disk. Exactly like compile.ts, that require is rewritten to load src/native/audify.cjs
// instead, which dlopen()s the addon from a real path after writeEmbeddedFolder() extracts it
// from the SEA's embedded assets.
import path from 'path';
import { existsSync } from 'fs';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'build/sea-bundle.js');

const audifyIndex = path.join(root, 'node_modules/audify/index.js');
if (!existsSync(audifyIndex)) throw new Error('node_modules/audify/index.js is missing; run npm install');

const audifyLoader: esbuild.Plugin = {
    name: 'audify-native-loader',
    setup(build) {
        build.onLoad({ filter: /node_modules[\\/]audify[\\/]index\.js$/ }, async (args) => {
            const fs = await import('fs/promises');
            const source = await fs.readFile(args.path, 'utf8');
            const lookup = 'require("bindings")("audify")';
            if (!source.includes(lookup)) {
                throw new Error('audify/index.js no longer loads its addon through bindings; update scripts/bundle-sea.ts');
            }
            const loader = JSON.stringify(path.join(root, 'src/native/audify.cjs'));
            return { contents: source.replace(lookup, `require(${loader})`), loader: 'js' };
        });
    },
};

await esbuild.build({
    entryPoints: [path.join(root, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile,
    plugins: [audifyLoader],
    // node:sea, fs, path, etc. are external automatically for platform:'node'.
    logLevel: 'info',
});

console.log(`bundled ${path.relative(root, outfile)}`);
