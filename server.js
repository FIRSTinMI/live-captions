const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);
const port = 3000;

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

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});

// TCP server for communicating with whisper process
require('net').createServer((socket) => {
    console.log('new connection to tcp socket');

    socket.on('data', function (data) {
        let msg = data.toString();
        console.log(msg);
        for (let client of clients) {
            client.send(msg);
        }
    });
}).listen(65432);
