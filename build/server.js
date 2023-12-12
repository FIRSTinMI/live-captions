"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const express_1 = __importDefault(require("express"));
const express_ws_1 = __importDefault(require("express-ws"));
const path_1 = __importDefault(require("path"));
const body_parser_1 = __importDefault(require("body-parser"));
const app = (0, express_ws_1.default)((0, express_1.default)()).app;
function server(config, clients, restart, rtAudio) {
    app.use(express_1.default.static(path_1.default.join(__dirname, '../src/public')));
    app.use(body_parser_1.default.json());
    app.get('/config', (req, res) => {
        res.send(config.config);
    });
    app.post('/config/:setting', (req, res) => {
        console.log(req.params.setting + ': ' + (req.query.value || req.body));
        if (req.params.setting === 'devices') {
            config.config.server.devices = req.body;
            config.save();
        }
        else if (req.params.setting === 'google' && typeof req.query.value === 'string') {
            config.config.google = JSON.parse(req.query.value);
            config.save();
        }
        else if (req.params.setting === 'server.filter' && typeof req.query.value === 'string') {
            config.config.server.filter = req.query.value.split('\n');
            config.save();
        }
        else {
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
    app.get('/devices', (req, res) => __awaiter(this, void 0, void 0, function* () {
        res.send(rtAudio.getDevices());
    }));
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
exports.server = server;
