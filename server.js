const recorder = require('node-record-lpcm16');
const Speech = require('@google-cloud/speech');
const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);
const { load, save } = require('./util/config');

const config = load();

const speech = new Speech.SpeechClient(config.google);

app.use(express.static('public'));

app.get('/config', (req, res) => {
    res.send({ display: config.display, server: config.server });
});

app.post('/config/:setting', (req, res) => {
    console.log(req.params.setting + ': ' + req.query.value);
    let setting = req.params.setting.split('.');
    config[setting[0]][setting[1]] = req.query.value;
    save(config);
    for (let ws of clients) {
        ws.send(JSON.stringify({ type: 'config' }));
    }
    res.send();
});

let clients = [];

app.ws('/ws/', (ws, req) => {
    clients.push(ws);

    ws.on('message', (msg) => {
        console.log(msg);
    });

    console.log('new connection to websocket');
});

app.listen(config.server.port, () => {
    console.log(`Open captions http://127.0.0.1:${config.server.port}\nOpen settings http://127.0.0.1:${config.server.port}/settings.html`);
});

const request = {
    config: {
        encoding: 'LINEAR16',
        sampleRateHertz: config.server.sampleRate,
        languageCode: 'en-US',
        model: 'latest_long'
    },
    interimResults: true,
};

function startStreaming() {
    const recognizeStream = speech
        .streamingRecognize(request)
        .on('error', (err) => {
            console.error(err);
            if (err.code == 11) return startStreaming();
        })
        .on('data', data => {
            let frame = {
                type: 'words',
                isFinal: data.results[0].isFinal,
                text: data.results[0].alternatives[0].transcript,
                confidence: data.results[0].alternatives[0].confidence
            }
            let msg = JSON.stringify(frame);
            for (let ws of clients) {
                ws.send(msg);
            }
        });

    recorder
        .record({
            sampleRateHertz: config.sampleRate,
            threshold: 0,
            verbose: false,
            recordProgram: 'rec',
            silence: '10.0',
        })
        .stream()
        .on('error', console.error)
        .pipe(recognizeStream);
}

startStreaming();