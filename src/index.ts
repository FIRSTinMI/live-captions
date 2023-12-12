import { server as Server } from './server';
import { RtAudio, RtAudioApi } from 'audify';
import WebSocket from 'ws';
import Speech from './speech';
import * as http from 'http';
import * as fs from 'fs';
import ConfigManager from './util/config_manager';
import { gibberish } from './util/developmentGibberish';

const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';
let server: http.Server;
let clients: WebSocket[] = [];
let speeches: Speech[] = [];

async function start() {
    // Kill server and speeches if they're already running
    if (server !== undefined) {
        server.close();
    }
    speeches.forEach(speech => {
        speech.stop();
    });
    speeches = [];

    // Create program folder
    if (!fs.existsSync(PROGRAM_FOLDER)) {
        fs.mkdirSync(PROGRAM_FOLDER);
        console.log('Created ' + PROGRAM_FOLDER);
    }

    // Generate/load config
    const config = new ConfigManager(PROGRAM_FOLDER + '/config.json');

    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    // Start web server
    server = Server(config, clients, start, rtAudio);

    // For development testing simulating semi-realistic captions
    if (process.argv.includes('--gibberish')) {
        gibberish(clients, 2);
        return;
    }

    // Start speech recognition
    if (!Array.isArray(config.config.server.devices)) return;
    for (let device of config.config.server.devices) {
        console.log(device)
        const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);
        const speech = new Speech(config, device, rtAudio, clients);
        speech.startStreaming();
        speeches.push(speech);
    }
};

start();
