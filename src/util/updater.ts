import { spawn } from "child_process";
import color from "colorts";
import { createWriteStream, readdirSync, unlink } from "fs";
import { finished } from 'node:stream/promises';
import { Readable } from "stream";

const VERSION = require('../../package.json').version;

// Numeric x.y.z compare: as strings, "1.10.0" sorts below "1.9.0", so an
// update across a digit boundary was never picked up.
export function newerThan(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d > 0;
    }
    return false;
}

export async function update() {
    try {
        const res = await fetch('https://github.com/FIRSTinMI/live-captions/releases/latest')
        if (!res.ok) throw new Error(`Update check: HTTP ${res.status}`);
        // /latest redirects to .../tag/v<x.y.z>; anything else (an error
        // page, a rate limit) is no update.
        const tag = /^v(\d+\.\d+\.\d+)$/.exec(res.url.split('/').pop() ?? '');
        const latestVersion = tag ? tag[1] : VERSION;

        if (newerThan(latestVersion, VERSION)) {
            // Update available
            console.log(`Update available: ${color(VERSION).bold.yellow} -> ${color(latestVersion).bold.green}`);
            console.log('Downloading...');
            const stream = createWriteStream(`live-captions-${latestVersion}.exe`);
            const { body } = await fetch(`https://github.com/FIRSTinMI/live-captions/releases/download/v${latestVersion}/live-captions-${latestVersion}.exe`);
            if (body === null) throw new Error('Failed to download update');
            // @ts-ignore
            await finished(Readable.fromWeb(body).pipe(stream));
            spawn(`live-captions-${latestVersion}.exe`, [], { detached: true, shell: true }).unref();
            process.exit();
        } else {
            console.log(`Running latest version: ${color(VERSION).bold.green}`);
            readdirSync('.').filter(f => f.startsWith('live-captions') && f.endsWith('.exe')).forEach(f => {
                if (f !== `live-captions-${VERSION}.exe`) {
                    console.log(`Removing old version: ${color(f).bold.red}`);
                    unlink(f, () => { });
                }
            });
        }
    } catch (err) {
        console.log('Failed to check for updates');
        console.error(err);
    }
}
