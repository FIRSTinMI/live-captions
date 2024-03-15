import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DisplayConfig, JSONConfig, ServerConfig, TranscriptionConfig } from '../types/Config';

export class ConfigManager {
    private file: string;

    public display: DisplayConfig = {
        position: 0,
        size: 36,
        lines: 2,
        chromaKey: 'rgba(0,0,0,0)',
        timeout: 5,
        align: 'left'
    };

    public server: ServerConfig = {
        port: 3000,
        google: {
            projectId: '',
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
            credentials: {
                client_email: '',
                private_key: ''
            }
        }
    }

    public transcription: TranscriptionConfig = {
        filter: [
            '-balls',
            '+gun',
            '+guns',
            '+pistol',
            '+pistols'
        ],
        streamingTimeout: 60e3,
        inputs: [],
        phraseSets: [
            'projects/829228050742/locations/global/phraseSets/fim-2024-team-names',
            'projects/829228050742/locations/global/phraseSets/frc-2024-terms'
        ],
        engine: 'googlev2'
    }

    constructor(file: string) {
        this.file = file;
        this.load();
    }

    public save() {
        writeFileSync(this.file, JSON.stringify(this.get(), null, 4));
    }

    public load() {
        if (!existsSync(this.file)) {
            this.save();
        }

        const json = JSON.parse(readFileSync(this.file).toString());
        this.display = overloadConfig(this.display, json.display);
        this.server = overloadConfig(this.server, json.server);
        this.transcription = overloadConfig(this.transcription, json.transcription);
    }

    public get(): JSONConfig {
        return {
            display: this.display,
            server: this.server,
            transcription: this.transcription
        };
    }

    public set(path: string, value: any) {
        switch (path) {
            case 'server.port':
                this.server.port = parseInt(value);
                break;
            case 'display.position':
                this.display.position = parseInt(value);
                break;
            case 'display.size':
                this.display.size = parseInt(value);
                break;
            case 'display.lines':
                this.display.lines = parseInt(value);
                break;
            case 'display.chromaKey':
                this.display.chromaKey = value;
                break;
            case 'display.timeout':
                this.display.timeout = parseInt(value);
                break;
            case 'display.align':
                this.display.align = value;
                break;
            case 'transcription.engine':
                this.transcription.engine = value;
                break;
        }
    }
}

/*
* objA: Default object
* objB: Loaded object from config
*/
function overloadConfig(objA: any, objB: any, parent?: any, key?: string) {
    if (objB === undefined && objA) {
        // If loaded undefined, use default
        return objA;
    } else if (objA === undefined && parent && key) {
        // If loaded has option that's not default, preserve it
        return objB;
    } else if (Array.isArray(objB)) {
        // If loaded is array, replace it
        objA = objB;
    } else if (typeof objB === 'object') {
        // If loaded is object, then recurse
        for (let key in objB) {
            objA[key] = overloadConfig(objA[key], objB[key], objA, key);
        }
    } else {
        // If loaded is not undefined, array, or object, then it's something else and just preserve it
        objA = objB;
    }
    return objA;
}