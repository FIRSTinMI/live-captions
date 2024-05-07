import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DisplayConfig, JSONConfig, ServerConfig, TranscriptionConfig } from '../types/Config';

export class ConfigManager {
    private file: string;

    public display: DisplayConfig = {
        position: 0,
        size: 42,
        lines: 2,
        chromaKey: 'rgba(0,0,0,0)',
        timeout: 5,
        align: 'left',
        hidden: false
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
        engine: 'googlev2',
        transformations: [
            {
                regex: /(\d\d)(\.| )(\d\d)/gm,
                replacement: "$1$3"
            },
            {
                regex: /(fucking?|bucking|bucket) gears/gmi,
                replacement: "Buc'n'Gears"
            },
            {
                regex: /(zoo buttocks|zubats)/gmi,
                replacement: "ZooBOTix"
            },
            {
                regex: /t(ea)? and t(ea)?/gmi,
                replacement: "TnT"
            },
            {
                regex: /blue (lines?|lions?)/gmi,
                replacement: "Blue Alliance"
            },
            {
                regex: /red (lines?|lions?)/gmi,
                replacement: "Red Alliance"
            },
            {
                regex: /christian (go|know)/gmi,
                replacement: "Crescendo"
            },
            {
                regex: /the bears/gmi,
                replacement: "Da Bears"
            },
            {
                regex: /try sonic's/gmi,
                replacement: "TriSonics"
            },
            {
                regex: /soccer tr?uck/gmi,
                replacement: "Saugatuck"
            },
            {
                regex: /so (i've|i) (been|can) driving/gmi,
                replacement: "step up and drive"
            },
            {
                regex: /drivers? behind a lines?/gmi,
                replacement: 'drivers behind the lines'
            },
            {
                regex: /drunk town thunder/gmi,
                replacement: "Truck Town Thunder"
            },
            {
                regex: /rubble eagles/gmi,
                replacement: "RoboEagles"
            },
            {
                regex: /bender butts/gmi,
                replacement: "Vander Bots"
            },
            {
                regex: /woody/gmi,
                replacement: "Woodie"
            },
            {
                regex: /app to field/gmi,
                replacement: "Aptiv Field"
            },
            {
                regex: /active field/gmi,
                replacement: "Aptiv Field"
            },
            {
                regex: /ch?risti?ano/gmi,
                replacement: "Crescendo"
            }
        ]
    }

    constructor(file: string) {
        this.file = file;
        this.load();
    }

    public save() {
        const save = this.get();
        for (let transformation of save.transcription.transformations) {
            // @ts-expect-error
            transformation.regex = transformation.regex.toString();
        }
        writeFileSync(this.file, JSON.stringify(save, null, 4));
    }

    public load() {
        if (!existsSync(this.file)) {
            this.save();
        }

        const json = JSON.parse(readFileSync(this.file).toString());
        this.display = overloadConfig(this.display, json.display);
        this.server = overloadConfig(this.server, json.server);
        this.transcription.transformations = parseTransformations(json.transcription.transformations);
        this.transcription = overloadConfig(this.transcription, json.transcription);
        console.log(this.transcription.transformations)
        this.save();
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
            case 'transcription.hidden': 
                this.display.hidden = value;
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

function parseTransformations(transformations: { regex: string, replacement: string }[]) {
    const newTransformations = [];
    for (let transformation of transformations) {
        const splitRegex = transformation.regex.split('/');
        const options = splitRegex.pop();
        const regex = splitRegex.slice(1).join('/');
        newTransformations.push({
            regex: new RegExp(regex, options),
            replacement: transformation.replacement
        });
    }
    console.log(newTransformations);
    return newTransformations;
}