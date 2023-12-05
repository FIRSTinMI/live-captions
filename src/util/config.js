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
                    chromaKey: '#FF00FF',
                    timeout: '5',
                    align: 'left'
                },
                server: {
                    port: 3000,
                    device1_sampleRate: 16000,
                    device1: 'null',
                    device1_color: '#EF5350',
                    device2_sampleRate: 16000,
                    device2: 'null',
                    device2_color: '#42A5F5',
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
