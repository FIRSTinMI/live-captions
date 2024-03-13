import { existsSync, mkdirSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import ws from 'ws';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';
import { updateBadWordsList } from './util/downloadBadWordsFIM';
import { update } from './util/updater';
import { GoogleV2 } from './engines/GoogleV2';
import { GoogleV1 } from './engines/GoogleV1';
import { April, downloadDependencies } from './engines/April';

export const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server: Server;
let clients: ws[] = [];

let engine: 'googlev1' | 'googlev2' | 'april' = 'googlev2';
if (process.argv.includes('--engine')) {
    let index = process.argv.indexOf('--engine');
    engine = process.argv[index + 1] as typeof engine;
    if (!['googlev1', 'googlev2', 'april'].includes(engine)) {
        console.error('Invalid engine type');
        process.exit(1);
    }
}

type engineType = typeof engine extends 'googlev2' ? GoogleV2 : typeof engine extends 'googlev1' ? GoogleV1 : April;

let speechServices: Speech<engineType>[] = [];

if (!process.argv.includes('--skip-update-check')) {
    update();
} else {
    start();
}


async function start() {
    // Kill server and speeches if they're already running
    if (server) {
        server.stop();
    }
    for (let speech of speechServices) {
        speech.destroy();
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
    await updateBadWordsList(config);

    if (engine === 'april') {
        await downloadDependencies();
    }

    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    // Start web server
    server = new Server(config, clients, rtAudio, start);
    server.start();

    setInterval(() => {
        for (let client of server.settingsClients) {
            client.send(JSON.stringify({
                type: 'volumes',
                devices: speechServices.map((s: Speech<engineType>) => ({
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
        console.log(engine);
        if (engine === 'googlev1') {
            const speech = new Speech(config, clients, input, GoogleV1);
            speech.startStreaming();
            speechServices.push(speech);
        } else if (engine === 'april') {
            const speech = new Speech(config, clients, input, April);
            speech.startStreaming();
            speechServices.push(speech);
        } else {
            const speech = new Speech(config, clients, input, GoogleV2);
            speech.startStreaming();
            speechServices.push(speech);
        }
    }
};
