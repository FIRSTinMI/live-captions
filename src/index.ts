import { createWriteStream, existsSync, mkdirSync, readdirSync, unlink, unlinkSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import ws from 'ws';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';
import color from 'colorts';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { spawn } from 'child_process';

const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server: Server;
let speechServices: Speech[] = [];
let clients: ws[] = [];

const VERSION = require('../package.json').version;

if (!process.argv.includes('--skip-update-check')) {
    fetch('https://github.com/Filip-Kin/live-captions/releases/latest').then(async res => {
        const latestVersion = res.url.split('/').pop()?.slice(1) || '0.0.0';
        if (latestVersion > VERSION) {
            // Update available
            console.log(`Update available: ${color(VERSION).bold.yellow} -> ${color(latestVersion).bold.green}`);
            console.log('Downloading...');
            const stream = createWriteStream(`live-captions-${latestVersion}.exe`);
            const { body } = await fetch(`https://github.com/Filip-Kin/live-captions/releases/download/v${latestVersion}/live-captions-${latestVersion}.exe`);
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
            start();
        }
    }).catch(err => {
        console.log('Failed to check for updates');
        console.error(err);
        start();
    });
} else {
    start();
}

async function updateBadWordsList(config: ConfigManager) {
    const FIMBadWords = await fetch('https://storage.googleapis.com/live-captions-assets/badwords.txt').then(res => res.text());
    
    let filter = config.transcription.filter;
    
    for (let word of FIMBadWords.split('\n')) {
        word = word.trim();
        let sign = word.slice(0, 1);

        if (word.length <= 1) continue;

        if (sign === '+') {
            if (!filter.includes(word)) {
                filter.push(word);
                console.log('Added to filter: ' + word);
            }
            if (filter.includes('-' + word.slice(1))) {
                filter.splice(filter.indexOf('-' + word.slice(1)), 1);
            }
        } else if (sign === '-') {
            if (!filter.includes(word)) {
                filter.push(word);
                console.log('Added to filter: ' + word);
            }
            if (filter.includes('+' + word.slice(1))) {
                filter.splice(filter.indexOf('+' + word.slice(1)), 1);
            }
        }
    }

    config.transcription.filter = filter;
    config.save();
}

async function start() {
    // Kill server and speeches if they're already running
    if (server) {
        server.stop();
    }
    for (let speech of speechServices) {
        speech.stop();
    }
    speechServices = [];
    clients = [];

    // Create program folder
    if (!existsSync(PROGRAM_FOLDER)) {
        mkdirSync(PROGRAM_FOLDER);
        console.log('Created ' + PROGRAM_FOLDER);
    }

    // Generate/load config
    const config = new ConfigManager(PROGRAM_FOLDER + '/config.json');
    updateBadWordsList(config);

    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    // Start web server
    server = new Server(config, clients, rtAudio, start);
    server.start();

    setInterval(() => {
        for (let client of server.settingsClients) {
            client.send(JSON.stringify({
                type: 'volumes',
                devices: speechServices.map((s: Speech) => ({
                    id: s.inputConfig.id,
                    volume: Math.round(s.volume)
                }))
            }));
        }
    }, 50);

    // For development testing simulating semi-realistic captions
    if (process.argv.includes('--gibberish')) {
        require('./util/developmentGibberish').gibberish(clients, 2);
        return;
    }

    // Start speech recognition
    for (let input of <InputConfig[]>config.transcription.inputs) {
        const speech = new Speech(config, clients, input);
        speech.startStreaming();
        speechServices.push(speech);
    }
};
