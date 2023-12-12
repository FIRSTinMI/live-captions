"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
class ConfigManager {
    constructor(file) {
        this.file = file;
        this.config = {};
        this.load();
    }
    save() {
        fs_1.default.writeFileSync(this.file, JSON.stringify(this.config, null, 4));
    }
    updateObject(key, value) {
        const keys = key.split('.');
        let currentObj = this.config;
        for (let i = 0; i < keys.length - 1; i++) {
            const currentKey = keys[i];
            // If the key doesn't exist in the object, create an empty object
            if (!currentObj[currentKey] || typeof currentObj[currentKey] !== 'object') {
                currentObj[currentKey] = {};
            }
            // Move to the next level of the object
            currentObj = currentObj[currentKey];
        }
        // Update the value of the final key
        currentObj[keys[keys.length - 1]] = value;
    }
    load() {
        if (!fs_1.default.existsSync(this.file)) {
            const config = {
                display: {
                    position: '0',
                    size: '36',
                    lines: '2',
                    chromaKey: '#FF00FF',
                    timeout: '5',
                    align: 'left'
                },
                server: {
                    port: 3000,
                    devices: [
                        {
                            name: 'Speaker 1',
                            id: 0,
                            channel: 0,
                            driver: 7 /* RtAudioApi.WINDOWS_WASAPI */,
                            color: '#EF5350',
                        },
                        {
                            name: 'Speaker 2',
                            id: 1,
                            channel: 0,
                            driver: 7 /* RtAudioApi.WINDOWS_WASAPI */,
                            color: '#42A5F5',
                        }
                    ],
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
            };
            fs_1.default.writeFileSync(this.file, JSON.stringify(config, null, 4));
        }
        this.config = JSON.parse(fs_1.default.readFileSync(this.file).toString());
    }
}
exports.default = ConfigManager;
