import { ConfigManager } from "../util/configManager";
import { Frame } from "../types/Frame";
import color from "colorts";
import EventEmitter from 'events';
import { ChildProcess, spawn } from "child_process";
import { PROGRAM_FOLDER } from "..";
import { existsSync, mkdirSync, createWriteStream } from "fs";
import { finished } from "stream/promises";
import { Readable } from "stream";
import WebSocket from "ws";

export class April {
    private config: ConfigManager;
    private sampleRate: number;
    private dead: boolean = false;
    private aprilASR?: ChildProcess;
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

    constructor(config: ConfigManager, sampleRate:number, inputId: number, inputName: string) {
        this.config = config;
        this.sampleRate = sampleRate;
        this.inputId = inputId;
        this.inputName = inputName;

        if (sampleRate !== 16000) {
            console.error(color('April ASR only supports 16kHz sample rate').bold.red.toString());
        }

        this.start();
    }

    public pause() {
        // Stub because there's no reason to pause this engine
    }

    public resume() {
        // Stub because there's no reason to pause this engine
    }

    private start() {
        if (!this.aprilASR?.killed) this.aprilASR?.kill();
        console.log(color(`April: Starting ${this.inputId} stream`).green.toString());
        this.aprilASR = spawn('python', [PROGRAM_FOLDER + '/april-asr/april-asr.py'], { shell: true, stdio: ['pipe', 'pipe', process.stderr]});

        this.aprilASR.stdout?.on('data', (data: Buffer) => {
            let strings = data.toString().split('\n');
            for (let str of strings) {
                if (str == null || str == '') continue;
                if (str.startsWith('Server started')) {
                    let port = str.split(' ')[4];
                    this.connectWebsocket(port);
                } else if (str.startsWith('Result')) {
                    this.handleRecognitionEvent(str.substring(7));
                }
            }
        });
    }

    private connectWebsocket(port: string = '8760') {
        console.log(color(`April: Connecting to websocket on port ${port}`).green.toString());
        this.ws = new WebSocket('ws://localhost:'+port);

        this.ws.onmessage = (event) => {
            console.log(event.data.toString());
        }

        this.ws.onerror = (event) => {
            console.error(event);
        }
    }

    private handleRecognitionEvent(data: string) {
        if (data.startsWith('.')) return;

        let frame: Frame = {
            device: this.inputId,
            type: 'words',
            isFinal: data.startsWith('@'),
            text: data.substring(2).trim().toLowerCase(),
            confidence: -1,
            speaker: this.inputName
        }

        if (frame.text.trim() === '' || frame.text.trim() === ',') return;

        if (frame.text === this.lastFrame.text && !frame.isFinal) return;

        // If this frame has fewer words and is not final let's not send the update
        // because otherwise the words kind of flicker as it detects
        // and if the last frame was final then this is a new sentence and obviously will have fewer words
        if (frame.text.split(' ').length - this.lastFrame.text.split(' ').length < 0 && !frame.isFinal && !this.lastFrame.isFinal) return;

        this.lastFrame = frame;

        frame.text = frame.text.trim();
        this.emitter.emit('frame', frame);
    }

    public write(pcm: Buffer) {
        if (!this.ws || this.ws.readyState != 1) return;
        if (this.dead) throw new Error('Tried to write to a dead April instance');
        this.ws.send(pcm);
    }

    public destroy() {
        this.dead = true;
        this.aprilASR?.kill();
        return new Promise((resolve) => {
            this.aprilASR?.on('exit', () => {
                resolve(null);
            });
        });
    }
}

export async function downloadDependencies() {
    if (!existsSync(PROGRAM_FOLDER + '/april-asr')) {
        mkdirSync(PROGRAM_FOLDER + '/april-asr');
        console.log('Created ' + PROGRAM_FOLDER + '/april-asr');
    }

    if (!existsSync(PROGRAM_FOLDER + '/april-asr/model.april')) {
        console.log('Downloading April ASR model... this may take a minute.');
        const { body } = await fetch('https://april.sapples.net/april-english-dev-01110_en.april');
        if (body === null) throw new Error('Failed to download April ASR model');
        const stream = createWriteStream(PROGRAM_FOLDER + '/april-asr/model.april');
        // @ts-ignore
        await finished(Readable.fromWeb(body).pipe(stream));
        console.log('Downloaded April ASR model');
    }

    if (!existsSync(PROGRAM_FOLDER + '/april-asr/april-asr.py')) {
        console.log('Downloading April ASR script...');
        const { body } = await fetch('https://raw.githubusercontent.com/Filip-Kin/live-captions/main/april-asr.py');
        if (body === null) throw new Error('Failed to download April ASR script');
        const stream = createWriteStream(PROGRAM_FOLDER + '/april-asr/april-asr.py');
        // @ts-ignore
        await finished(Readable.fromWeb(body).pipe(stream));
        console.log('Downloaded April ASR script');
    }
}