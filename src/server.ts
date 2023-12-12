import path from 'path';
import express from 'express';
import expressWs from 'express-ws';
import ws from 'ws';
import bodyParser from 'body-parser';
import color from 'colorts';
import { RtAudio } from 'audify';
import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { ConfigManager } from './util/configManager';

export class Server {
    public clients: ws[];
    private config: ConfigManager;
    private app: expressWs.Application;
    private instance: HttpServer<typeof IncomingMessage, typeof ServerResponse> | undefined;


    constructor(config: ConfigManager, clients: ws[], rtAudio: RtAudio, restart: () => void) {
        this.config = config;
        this.clients = clients;

        this.app = expressWs(express()).app;

        this.app.use(express.static(path.join(__dirname, '../src/public')));
        this.app.use('/dist', express.static(path.join(__dirname, '../node_modules/@materializecss/materialize/dist')));

        this.app.use(bodyParser.json());

        this.app.get('/config', (req, res) => {
            res.send(config.get());
        });

        this.app.post('/config/:setting', (req, res) => {
            console.log(req.params.setting + ': ' + (req.body || req.query.value));

            if (req.params.setting === 'transcription.inputs') {
                config.transcription.inputs = req.body;
                config.save();
            } else if (req.params.setting === 'server.google') {
                config.server.google = req.body;
                config.save();
            } else if (req.params.setting === 'transcription.filter') {
                config.transcription.filter = req.body;
                config.save();
            } else {
                try {
                    config.set(req.params.setting, req.query.value);
                } catch (err) {
                    return res.status(500).send({ type: 'error', msg: err })
                }
                config.save();
                for (let ws of this.clients) {
                    ws.send(JSON.stringify({ type: 'config' }));
                }
            }
            res.send();
        });

        this.app.post('/restart', (req, res) => {
            res.send();
            restart();
        });

        this.app.get('/devices', async (req, res) => {
            res.send(rtAudio.getDevices());
        });

        this.app.ws('/ws/', (ws, req) => {
            this.clients.push(ws);

            ws.on('message', (msg) => {
                console.log(msg);
            });

            ws.on('close', () => {
                this.clients.splice(this.clients.indexOf(ws), 1);
            });

            console.log('new connection to websocket');
        });
    }

    start() {
        this.instance = this.app.listen(this.config.server.port, () => {
            console.log(`Open captions ${color(`http://127.0.0.1:${this.config.server.port}`).bold.underline.blue}`);
            console.log(`Open settings ${color(`http://127.0.0.1:${this.config.server.port}/settings.html`).bold.underline.blue}`);
        });
    }

    stop() {
        this.instance?.close();
    }
}