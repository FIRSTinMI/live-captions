import { existsSync, mkdirSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import ws from 'ws';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';
import { AprilSpeech, downloadDependencies } from './aprilSpeech';
import { updateBadWordsList } from './util/downloadBadWordsFIM';
import { update } from './util/updater';

export const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server: Server;
let clients: ws[] = [];

const engine: 'google' | 'april' = (process.argv.includes('--local-engine')) ? 'april' : 'google';
type engineType = typeof engine extends 'google' ? Speech : AprilSpeech;

let speechServices: engineType[] = [];


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
                devices: speechServices.map((s: engineType) => ({
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
        if (engine === 'april') {
            const speech = new AprilSpeech(config, clients, input);
            speech.startStreaming();
            // @ts-ignore
            speechServices.push(speech);
        } else {
            const speech = new Speech(config, clients, input);
            speech.startStreaming();
            // @ts-ignore
            speechServices.push(speech);
        }
    }
};
