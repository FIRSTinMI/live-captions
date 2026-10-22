// Builds the Windows exe with `bun build --compile`.
//
// Two things a plain compile gets wrong, both handled here:
//  - audify finds its addon at runtime through `bindings`, which searches the disk and cannot
//    see inside the exe. And on Windows audify.node imports rtaudio.dll and opus.dll, which
//    Windows only loads from a real folder. So audify's whole build/Release folder is embedded
//    as an asset and audify is pointed at src/native/audify.cjs, which writes that folder to
//    disk and loads the addon from there.
//  - The frontend is served from disk. build/public is embedded as an asset and server.ts
//    serves it from inside the exe (src/util/embedded.ts).
//
// Usage: bun scripts/compile.ts [target] [outfile]   (defaults: bun-windows-x64, dist/live-captions.exe)
import path from 'path';
import { existsSync } from 'fs';
import type { BunPlugin } from 'bun';

const root = path.resolve(import.meta.dir, '..');
const { version } = await Bun.file(path.join(root, 'package.json')).json();
const target = (process.argv[2] ?? 'bun-windows-x64') as Bun.Build.CompileTarget;
const outfile = path.resolve(root, process.argv[3] ?? 'dist/live-captions.exe');

const audifyRelease = path.join(root, 'node_modules/audify/build/Release');
if (!existsSync(path.join(audifyRelease, 'audify.node'))) {
    throw new Error(`${audifyRelease}/audify.node is missing; audify's prebuild did not install`);
}
if (!existsSync(path.join(root, 'build/public/index.html'))) {
    throw new Error('build/public is missing; run `bun run build:frontend` first');
}

const audifyLoader: BunPlugin = {
    name: 'audify-native-loader',
    setup(build) {
        build.onLoad({ filter: /[\\/]node_modules[\\/]audify[\\/]index\.js$/ }, async (args) => {
            const source = await Bun.file(args.path).text();
            const lookup = 'require("bindings")("audify")';
            if (!source.includes(lookup)) {
                throw new Error('audify/index.js no longer loads its addon through bindings; update scripts/compile.ts');
            }
            const loader = JSON.stringify(path.join(root, 'src/native/audify.cjs'));
            return { contents: source.replace(lookup, `require(${loader})`), loader: 'js' };
        });
    },
};

const result = await Bun.build({
    entrypoints: [path.join(root, 'src/index.ts')],
    plugins: [audifyLoader],
    compile: {
        target,
        outfile,
        assets: [path.join(root, 'build/public'), audifyRelease],
        autoloadDotenv: false,
        autoloadBunfig: false,
        windows: {
            title: 'live-captions',
            publisher: 'Filip Kin',
            version: `${version}.0`,
            description: 'FIM live captions',
            copyright: 'Copyright (c) 2026 Filip Kin',
        },
    },
});

for (const log of result.logs) console.log(log);
if (!result.success) process.exit(1);
console.log(`built ${path.relative(root, outfile)} (${target}, v${version})`);
