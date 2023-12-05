const fs = require('fs');
const https = require('https');
const decompress = require('decompress');
const Config = require('./util/config');
const Speech = require('./speech');
const Server = require('./server');
const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';

let server, speech, speech2;
let clients = [];

async function start() {
    // Kill server and speech if they're already running
    if (server !== undefined) {
        server.close();
    }
    if (speech !== undefined) {
        speech.recorder.stop();
    }
    if (speech2 !== undefined) {
        speech2.recorder.stop();
    }

    // Create program folder
    if (!fs.existsSync(PROGRAM_FOLDER)) {
        fs.mkdirSync(PROGRAM_FOLDER);
        console.log('Created ' + PROGRAM_FOLDER);
    }

    // Download sox dependency
    if (!fs.existsSync(PROGRAM_FOLDER + '/sox-14.4.1')) {
        console.log('Downloading sox');

        const file = fs.createWriteStream(PROGRAM_FOLDER + '/sox.zip');
        await new Promise((resolve, reject) => https.get('https://master.dl.sourceforge.net/project/sox/sox/14.4.1/sox-14.4.1-win32.zip?viasf=1', (res) => {
            res.pipe(file);

            file.on('finish', () => {
                file.close();
                decompress(PROGRAM_FOLDER + '/sox.zip', PROGRAM_FOLDER)
                    .then(resolve)
                    .catch(reject);
            });
        }));
        console.log('Done')
    }

    // Download soundvolumeview dependency
    if (!fs.existsSync(PROGRAM_FOLDER + '/SoundVolumeView.exe')) {
        console.log('Downloading SoundVolumeView');

        const file = fs.createWriteStream(PROGRAM_FOLDER + '/svv.zip');
        await new Promise((resolve, reject) => https.get('https://www.nirsoft.net/utils/soundvolumeview-x64.zip', (res) => {
            res.pipe(file);

            file.on('finish', () => {
                file.close();
                decompress(PROGRAM_FOLDER + '/svv.zip', PROGRAM_FOLDER)
                    .then(resolve)
                    .catch(reject);
            });
        }));
        console.log('Done')
    }

    // Generate/load config
    const config = new Config(PROGRAM_FOLDER + '/config.json');

    // Start web server
    server = Server(config, clients, start, PROGRAM_FOLDER);

    // Start speech recognition
    speech = new Speech(config, PROGRAM_FOLDER, clients);
    speech.startStreaming();

    if (config.config.server.device2 != 'null') {
        speech2 = new Speech(config, PROGRAM_FOLDER, clients, 2);
        speech2.startStreaming();
    }
};

start();
