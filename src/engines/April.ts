import { ConfigManager } from "../util/configManager";
import { Frame } from "../types/Frame";
import color from "colorts";
import EventEmitter from 'events';
import { ChildProcess, spawn } from "child_process";
import { PROGRAM_FOLDER } from "..";
import { existsSync, mkdirSync, createWriteStream } from "fs";

export class April {
    private dead: boolean = false;
    private aprilASR: ChildProcess;
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

    constructor(config: ConfigManager, sampleRate:number, inputId: number, inputName: string) {
        this.inputId = inputId;
        this.inputName = inputName;

        if (sampleRate !== 16000) {
            console.error(color('April ASR only supports 16kHz sample rate').bold.red.toString());
        }

        console.log(color(`April: Starting ${this.inputId} stream`).green.toString());
        this.aprilASR = spawn('python', ['./april-asr.py', PROGRAM_FOLDER + '/april-asr/april-english-dev-01110_en.april'], { shell: true, stdio: ['pipe', process.stdout, process.stderr]});

        this.aprilASR.stdout?.on('data', (data: Buffer) => {
            this.handleRecognitionEvent(data.toString());
        });
    }

    public pause() {
        // Stub because there's no reason to pause this engine
    }

    public resume() {
        // Stub because there's no reason to pause this engine
    }

    private handleRecognitionEvent(data: string) {
        let frame: Frame = {
            device: this.inputId,
            type: 'words',
            isFinal: data.startsWith('@'),
            text: data.substring(2),
            confidence: 1,
            speaker: this.inputName
        }

        if (frame.text.trim() === '') return;

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
        if (this.dead || !this.aprilASR.stdin?.writable) throw new Error('Tried to write to a dead April instance');
        this.aprilASR.stdin.cork();
        this.aprilASR.stdin.write(pcm);
        this.aprilASR.stdin.uncork();
    }

    public destroy() {
        this.dead = true;
        this.aprilASR.kill();
    }
}

export async function downloadDependencies() {
    if (!existsSync(PROGRAM_FOLDER + '/april-asr')) {
        mkdirSync(PROGRAM_FOLDER + '/april-asr');
        console.log('Created ' + PROGRAM_FOLDER + '/april-asr');
    }

    if (!existsSync(PROGRAM_FOLDER + '/april-asr/aprilv0_en-us.april')) {
        console.log('Downloading April ASR model...');
        const { body } = await fetch('https://april.sapples.net/aprilv0_en-us.april');
        if (body === null) throw new Error('Failed to download April ASR model');
        const stream = createWriteStream(PROGRAM_FOLDER + '/april-asr/aprilv0_en-us.april');
        // @ts-ignore
        await finished(Readable.fromWeb(body).pipe(stream));
        console.log('Downloaded April ASR model');
    }

    if (!existsSync(PROGRAM_FOLDER + '/april-asr/main.exe')) {
        // TODO: download main.exe
    }
}