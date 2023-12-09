const fs = require('fs');
const Config = require('./util/config');
const Speech = require('./speech');
const Server = require('./server');
const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';
const { RtAudio, RtAudioApi } = require("audify");

let server, speech, speech2;
let clients = [];

async function start() {
    // Kill server and speech if they're already running
    if (server !== undefined) {
        server.close();
    }
    if (speech !== undefined) {
        speech.stop();
    }
    if (speech2 !== undefined) {
        speech2.stop();
    }

    // Create program folder
    if (!fs.existsSync(PROGRAM_FOLDER)) {
        fs.mkdirSync(PROGRAM_FOLDER);
        console.log('Created ' + PROGRAM_FOLDER);
    }

    // Generate/load config
    const config = new Config(PROGRAM_FOLDER + '/config.json');

    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);
    const rtAudio2 = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    // Start web server
    server = Server(config, clients, start, PROGRAM_FOLDER, rtAudio);

    // Start speech recognition
    if (config.config.server.device1 != 'null') {
        speech = new Speech(config, rtAudio, PROGRAM_FOLDER, clients);
        speech.startStreaming();
    }

    if (config.config.server.device2 != 'null') {
        speech2 = new Speech(config, rtAudio2, PROGRAM_FOLDER, clients, 2);
        speech2.startStreaming();
    }
};

start();
