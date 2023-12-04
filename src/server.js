const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);

function server(config, clients) {
    app.use(express.static('public'));

    app.get('/config', (req, res) => {
        res.send(config.config);
    });

    app.post('/config/:setting', (req, res) => {
        console.log(req.params.setting + ': ' + req.query.value);
        if (req.params.setting !== 'google') {
            let setting = req.params.setting.split('.');
            config.config[setting[0]][setting[1]] = req.query.value;
            config.save();
            for (let ws of clients) {
                ws.send(JSON.stringify({ type: 'config' }));
            }
        } else {
            config.config.google = JSON.parse(req.query.value);
            config.save();
        }
        res.send();
    });

    app.ws('/ws/', (ws, req) => {
        clients.push(ws);

        ws.on('message', (msg) => {
            console.log(msg);
        });

        console.log('new connection to websocket');
    });

    app.listen(config.config.server.port, () => {
        console.log(`Open captions http://127.0.0.1:${config.config.server.port}\nOpen settings http://127.0.0.1:${config.config.server.port}/settings.html`);
    });
}

module.exports = server;
