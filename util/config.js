const fs = require('fs');

exports.save = function (config) {
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
}

exports.load = function () {
    if (!fs.existsSync('./config.json')) {
        fs.writeFileSync('./config.json', JSON.stringify({
            display: {
                position: 0,
                size: 24,
                lines: 2,
                chromaKey: '#ff00ff',
                timeout: 10,
                align: 'left'
            },
            server: {
                port: 3000,
                sampleRate: 16000
            },
            google: {
                projectId: '',
                scopes: 'https://www.googleapis.com/auth/cloud-platform',
                credentials: {
                    client_email: '',
                    private_key: ''
                }
            }
        }, null, 4));
    }

    return JSON.parse(fs.readFileSync('./config.json').toString());
}