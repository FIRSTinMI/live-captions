const PORT = 3000;
const MODEL = 'large-v3';
const PROGRAM_FOLDER = './'; //process.env.APPDATA + '\\captions';

const wget = require('wget-improved');
const cliProgress = require('cli-progress');
const net = require('net');
const fs = require('fs');

const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);

if (!fs.existsSync(PROGRAM_FOLDER)) {
    fs.mkdirSync(PROGRAM_FOLDER);
    console.log('Created ' + PROGRAM_FOLDER);
}

// Download model if not exists
let downloadBar = new cliProgress.SingleBar({ format: '[{bar}] {percentage}% | ETA: {eta}s | {value}/{total} KB', etaBuffer: 10000 }, cliProgress.Presets.shades_classic);
let size = 0;
if (!fs.existsSync(`${PROGRAM_FOLDER}/${MODEL}.model`)) {
    console.log(`Downloading https://huggingface.co/Systran/faster-whisper-${MODEL}/resolve/main/model.bin?download=true`);
    let download = wget.download(`https://huggingface.co/Systran/faster-whisper-${MODEL}/resolve/main/model.bin?download=true`, `${PROGRAM_FOLDER}/${MODEL}.model`);
    download.on('error', console.error);
    download.on('start', (fileSize) => {
        size = Math.floor(fileSize / 1024 / 1024 * 100) / 100;
        downloadBar.start(size, 0);
    });
    download.on('progress', (progress) => {
        typeof progress === 'number';
        downloadBar.update(Math.floor(progress * size * 100) / 100);
    });
    download.on('end', () => {
        downloadBar.stop();
    });
}

app.use(express.static('public'));

let clients = [];

app.ws('/ws/', (ws, req) => {
    clients.push(ws);

    ws.on('message', (msg) => {
        console.log(msg);
        ws.send(msg);
    });

    console.log('new connection to websocket');
});

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`);
});

// TCP server for communicating with whisper process
net.createServer((socket) => {
    console.log('new connection to tcp socket');

    socket.on('data', function (data) {
        let msg = data.toString();
        console.log(msg);
        for (let client of clients) {
            client.send(msg);
        }
    });
}).listen(65432);
