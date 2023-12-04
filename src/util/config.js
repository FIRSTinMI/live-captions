const fs = require('fs');

class Config {
    constructor(file) {
        this.file = file;
        this.load();
    }

    save() {
        fs.writeFileSync(this.file, JSON.stringify(this.config, null, 4));
    }

    load() {
        if (!fs.existsSync(this.file)) {
            fs.writeFileSync(this.file, JSON.stringify({
                display: {
                    position: '0',
                    size: '24',
                    lines: '2',
                    chromaKey: '#ff00ff',
                    timeout: '5',
                    align: 'left'
                },
                server: {
                    port: 3000,
                    sampleRate: 16000,
                    filter: [
                        '-balls'
                    ]
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

        this.config = JSON.parse(fs.readFileSync(this.file).toString());
    }
}

module.exports = Config;
