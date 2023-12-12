import express from 'express';
import expressWs from "express-ws";
import WebSocket from "ws";
import path from 'path';
import ConfigManager from "./util/config_manager";
import { RtAudio } from 'audify';
import bodyParser from 'body-parser';

const app = expressWs(express()).app;

export function server(config: ConfigManager, clients: WebSocket[], restart: () => void, rtAudio: RtAudio) {
    app.use(express.static(path.join(__dirname, '../src/public')));

    app.use(bodyParser.json());

    app.get('/config', (req, res) => {
        res.send(config.config);
    });
    app.post('/config/:setting', (req, res) => {
        console.log(req.params.setting + ': ' + (req.query.value || req.body));
        if (req.params.setting === 'devices') {
            config.config.server.devices = req.body;
            config.save();
        } else if (req.params.setting === 'google' && typeof req.query.value === 'string') {
            config.config.google = JSON.parse(req.query.value);
            config.save();
        } else if (req.params.setting === 'server.filter' && typeof req.query.value === 'string') {
            config.config.server.filter = req.query.value.split('\n');
            config.save();
        } else {
            let setting = req.params.setting.split('.');
            // @ts-ignore
            config.config[setting[0]][setting[1]] = req.query.value;
            config.save();
            for (let ws of clients) {
                ws.send(JSON.stringify({ type: 'config' }));
            }
        }
        res.send();
    });

    app.post('/restart', (req, res) => {
        res.send();
        restart();
    });

    app.get('/devices', async (req, res) => {
        res.send(rtAudio.getDevices());
    });

    app.ws('/ws/', (ws, req) => {
        clients.push(ws);

        ws.on('message', (msg) => {
            console.log(msg);
        });

        console.log('new connection to websocket');
    });

    return app.listen(config.config.server.port, () => {
        console.log(`Open captions http://127.0.0.1:${config.config.server.port}\nOpen settings http://127.0.0.1:${config.config.server.port}/settings.html`);
    });
}
