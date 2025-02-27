import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { PROGRAM_FOLDER } from '..';
import { ConfigManager } from '../util/configManager';
import { Frame } from '../types/Frame';
import color from 'colorts';
import { createWriteStream, existsSync, mkdirSync } from 'fs';

export class Whisper3 {
    private config: ConfigManager;
    private sampleRate: number;
    private dead: boolean = false;
    private whisperProcess?: ChildProcess;
    private lastFrame: Frame = {
        device: 0,
        type: 'words',
        isFinal: false,
        text: '',
        confidence: 0
    };
    public emitter: EventEmitter = new EventEmitter();
    private inputId: number;
    private inputName: string;
    private ws?: WebSocket;

    constructor(config: ConfigManager, sampleRate: number, inputId: number, inputName: string) {
        this.config = config;
        this.sampleRate = sampleRate;
        this.inputId = inputId;
        this.inputName = inputName;

        if (sampleRate !== 16000) {
            console.error('Whisper-3 only supports 16kHz sample rate');
        }

        this.start();
    }

    private start() {
        if (this.whisperProcess?.killed) this.whisperProcess?.kill();
        console.log(color(`Whisper-3: Starting ${this.inputId} stream`).green.toString());
        this.whisperProcess = spawn('python', [PROGRAM_FOLDER + '/whisper-3/whisper-3.py'], { shell: true, stdio: ['pipe', 'pipe', process.stderr] });

        this.whisperProcess.stdout?.on('data', (data: Buffer) => {
            let strings = data.toString().split('\n');
            for (let str of strings) {
                if (str == null || str === '') continue;
                if (str.startsWith('Server started')) {
                    let port = str.split(' ')[4];
                    this.connectWebSocket(port);
                } else if (str.startsWith('Result')) {
                    this.handleRecognitionEvent(str.substring(7));
                }
            }
        });
    }

    public pause() {
        // Stub because there's no reason to pause this engine
    }

    public resume() {
        // Stub because there's no reason to pause this engine
    }

    private connectWebSocket(port: string = '8760') {
        console.log(`Whisper-3: Connecting to WebSocket on port ${port}`);
        this.ws = new WebSocket('ws://localhost:' + port);

        this.ws.onmessage = (event) => {
            console.log(event.data.toString());
        };

        this.ws.onerror = (event) => {
            console.error(event);
        };
    }

    private handleRecognitionEvent(data: string) {
        if (data.startsWith('.')) return; // Skip unrecognized partial results

        let frame: Frame = {
            device: this.inputId,
            type: 'words',
            isFinal: data.startsWith('@'),
            text: data.substring(2).trim().toLowerCase(),
            confidence: -1,
            speaker: this.inputName
        };

        if (frame.text.trim() === '' || frame.text === this.lastFrame.text && !frame.isFinal) return;

        // If this frame has fewer words and is not final let's not send the update
        // because otherwise the words kind of flicker as it detects
        // and if the last frame was final then this is a new sentence and obviously will have fewer words
        if (frame.text.split(' ').length - this.lastFrame.text.split(' ').length < 0 && !frame.isFinal && !this.lastFrame.isFinal) return;

        this.lastFrame = frame;

        frame.text = frame.text.trim();
        this.emitter.emit('frame', frame);
    }

    public write(pcm: Buffer) {
        if (!this.ws || this.ws.readyState !== 1) return;
        if (this.dead) throw new Error('Tried to write to a dead Whisper-3 instance');
        this.ws.send(pcm);
    }

    public destroy() {
        this.dead = true;
        this.whisperProcess?.kill();
        return new Promise((resolve) => {
            this.whisperProcess?.on('exit', () => {
                resolve(null);
            });
        });
    }
}

export async function downloadDependencies() {
    if (!existsSync(PROGRAM_FOLDER + '/whisper-3')) {
        mkdirSync(PROGRAM_FOLDER + '/whisper-3');
        console.log('Created ' + PROGRAM_FOLDER + '/whisper-3');
    }

    if (!existsSync(PROGRAM_FOLDER + '/whisper-3/whisper-3.py')) {
        console.log('Downloading Whisper-3 script...');
        const { body } = await fetch('https://raw.githubusercontent.com/Filip-Kin/live-captions/main/whisper-3.py');
        if (body === null) throw new Error('Failed to download Whisper-3 script');
        const stream = createWriteStream(PROGRAM_FOLDER + '/whisper-3/whisper-3.py');
        // @ts-ignore
        await finished(Readable.fromWeb(body).pipe(stream));
        console.log('Downloaded Whisper-3 script');
    }
}
