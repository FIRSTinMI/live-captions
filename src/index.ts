import { existsSync, mkdirSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import ws from 'ws';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';
import { MultiBar, Presets } from 'cli-progress';

const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server: Server;
let speechServices: Speech[] = [];
let clients: ws[] = [];

let multibar: MultiBar;

if (process.argv.includes('--volume-bar')) {
    multibar = new MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{name} | {bar} {percentage}',
    }, Presets.shades_grey);
}

function start() {
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

    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    // Start web server
    server = new Server(config, clients, rtAudio, start);
    server.start();

    // For development testing simulating semi-realistic captions
    if (process.argv.includes('--gibberish')) {
        require('./util/developmentGibberish').gibberish(clients, 2);
        return;
    }

    // Start speech recognition
    for (let input of <InputConfig[]>config.transcription.inputs) {
        const bar = (multibar) ? multibar.create(2000, 0, { name: input.speaker }) : undefined;
        const speech = new Speech(config, clients, input, bar);
        speech.startStreaming();
        speechServices.push(speech);
    }
};

start();
