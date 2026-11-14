// Generates sea-config.json for `node --experimental-sea-config`: the Node SEA equivalent of
// scripts/compile.ts's `Bun.build({ compile: { assets: [...] } })`.
//
// Node SEA's `assets` field is a flat "key": "path on disk at build time" map - there's no
// folder embedding like Bun's. So this walks build/public and audify's build/Release and adds
// one entry per file, keyed "<folderName>/<relativePath>", which is exactly the key shape
// src/util/embedded.ts expects at runtime (it reads sea.getAssetKeys() and strips the
// "<folderName>/" prefix). Usage: `node --experimental-strip-types scripts/build-sea-assets.ts`
import { existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');

function walk(dir: string, base: string = dir): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full, base));
        else out.push(path.relative(base, full));
    }
    return out;
}

const publicDir = path.join(root, 'build/public');
const releaseDir = path.join(root, 'node_modules/audify/build/Release');

if (!existsSync(path.join(publicDir, 'index.html'))) {
    throw new Error('build/public is missing; run `npm run build:frontend` first');
}
if (!existsSync(path.join(releaseDir, 'audify.node'))) {
    throw new Error(`${releaseDir}/audify.node is missing; audify's prebuild did not install`);
}

const assets: Record<string, string> = {};
for (const rel of walk(publicDir)) {
    assets[`public/${rel.split(path.sep).join('/')}`] = path.relative(root, path.join(publicDir, rel));
}
for (const rel of walk(releaseDir)) {
    assets[`Release/${rel.split(path.sep).join('/')}`] = path.relative(root, path.join(releaseDir, rel));
}

const seaConfig = {
    main: 'build/sea-bundle.js',
    output: 'build/sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
};

writeFileSync(path.join(root, 'sea-config.json'), JSON.stringify(seaConfig, null, 4));
console.log(`wrote sea-config.json with ${Object.keys(assets).length} assets`);
