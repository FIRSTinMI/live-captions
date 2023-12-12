import Config from "../types/Config";
import fs from 'fs';
import { RtAudioApi } from "audify"

class ConfigManager {

    private file: string;
    public config: Config;

    constructor(file: string) {
        this.file = file;
        this.config = {} as Config;
        this.load();
    }

    save() {
        fs.writeFileSync(this.file, JSON.stringify(this.config, null, 4));
    }

    updateObject(key: string, value: string) {
        const keys = key.split('.');
        let currentObj: any = this.config;

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
        if (!fs.existsSync(this.file)) {
            const config: Config = {
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
                            driver: RtAudioApi.WINDOWS_WASAPI,
                            color: '#EF5350',
                        },
                        {
                            name: 'Speaker 2',
                            id: 1,
                            channel: 0,
                            driver: RtAudioApi.WINDOWS_WASAPI,
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
            }
            fs.writeFileSync(this.file, JSON.stringify(config, null, 4));
        }

        this.config = JSON.parse(fs.readFileSync(this.file).toString());
    }
}

export default ConfigManager;
