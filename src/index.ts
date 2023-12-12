import { existsSync, mkdirSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import ws from 'ws';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';

const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server: Server;
let speechServices: Speech[] = [];
let clients: ws[] = [];

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
        console.log(input)
        const speech = new Speech(config, clients, input);
        speech.startStreaming();
        speechServices.push(speech);
    }
};

start();
