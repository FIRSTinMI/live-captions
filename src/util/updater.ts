import { spawn } from "child_process";
import color from "colorts";
import { createWriteStream, readdirSync, unlink } from "fs";
import { finished } from 'node:stream/promises';
import { Readable } from "stream";

const VERSION = require('../../package.json').version;

export async function update() {
    try {
        const res = await fetch('https://github.com/FIRSTinMI/live-captions/releases/latest')
        const latestVersion = res.url.split('/').pop()?.slice(1) || '0.0.0';

        if (latestVersion > VERSION) {
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
