// Copies the running node.exe and injects the SEA blob (build/sea-prep.blob, produced by
// `node --experimental-sea-config sea-config.json`) into it with postject. The CI workflow
// (.github/workflows/release.yml) inlines this same sequence directly in the YAML; this script
// exists so `npm run dist` does the identical thing for a local/manual build.
const { copyFileSync } = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outExe = path.join(root, 'dist', process.platform === 'win32' ? 'live-captions.exe' : 'live-captions');

require('fs').mkdirSync(path.dirname(outExe), { recursive: true });
copyFileSync(process.execPath, outExe);

execFileSync('npx', [
    'postject', outExe, 'NODE_SEA_BLOB', path.join(root, 'build/sea-prep.blob'),
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit', shell: process.platform === 'win32' });

console.log(`built ${path.relative(root, outExe)}`);
