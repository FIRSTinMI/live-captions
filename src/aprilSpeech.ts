import { RtAudio, RtAudioErrorType, RtAudioFormat, RtAudioStreamFlags, RtAudioStreamParameters } from 'audify';
import WebSocket from "ws";
import BadWords from 'bad-words'
import { ConfigManager } from "./util/configManager";
import { InputConfig } from "./types/Config";
import { Frame } from "./types/Frame";
import color from "colorts";
import { ChildProcess, StdioPipe, spawn } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { SpeechResultData } from './types/GoogleAPI';
import { PROGRAM_FOLDER } from '.';
import { finished } from 'node:stream/promises';
import { Readable } from "stream";

// Number of frames after silence is detected to continue streaming
const THRESHOLD_CUTOFF_SMOOTHING = 10;

export class AprilSpeech {
    private config: ConfigManager;
    public inputConfig: InputConfig;
    private clients: WebSocket[];
    private rtAudio: RtAudio;
    private aprilASR?: ChildProcess;
    private filter = new BadWords();
    private lastFrame: Frame = {
        device: 0,
        type: 'words',
        isFinal: false,
        text: '',
        confidence: 0
    };
    private amplitudeArray: number[] = [0, 0, 0, 0, 0];
    public volume: number = 0;

    constructor(config: ConfigManager, clients: WebSocket[], input: InputConfig) {
        this.config = config;
        this.inputConfig = input;
        this.clients = clients;
        this.rtAudio = new RtAudio(input.driver);
        this.startAprilASR();

        // Process filter
        let removeWords = [];
        let addWords = [];
        for (let word of this.config.transcription.filter) {
            if (word.startsWith('+')) {
                addWords.push(word.slice(1));
            } else {
                removeWords.push(word.slice(1));
            }
        }
        this.filter.addWords(...addWords);
        this.filter.removeWords(...removeWords);
    }

    public stop(closeSpeech: boolean = true) {
        this.rtAudio.setInputCallback(() => { });
        this.rtAudio.closeStream();
        if (closeSpeech && this.aprilASR) this.aprilASR.kill();
    }

    private handleRecognitionEvent(data: SpeechResultData) {
        let frame: Frame = {
            device: this.inputConfig.id,
            type: 'words',
            isFinal: data.results[0].isFinal,
            text: data.results[0].alternatives[0].transcript,
            confidence: data.results[0].alternatives[0].confidence,
            speaker: this.inputConfig.speaker
        }

        // Sometimes the API sends duplicate isFinal frames
        if (frame.isFinal && this.lastFrame.isFinal) return;

        // Or an empty text...
        if (frame.text.trim() === '') return;

        // Or the same frame twice
        if (frame.text === this.lastFrame.text && !frame.isFinal) return;

        // If this frame has fewer words and is not final let's not send the update
        // because otherwise the words kind of flicker as it detects
        // and if the last frame was final then this is a new sentence and obviously will have fewer words
        if (frame.text.split(' ').length - this.lastFrame.text.split(' ').length < 0 && !frame.isFinal && !this.lastFrame.isFinal) return;

        this.lastFrame = frame;

        // Trim whitespace and censor bad words
        frame.text = this.filter.clean(frame.text.trim());
        let msg = JSON.stringify(frame);
        for (let ws of this.clients) {
            ws.send(msg);
        }
    }

    public startAprilASR() {
        if (this.aprilASR) this.aprilASR.kill();
        this.aprilASR = spawn(PROGRAM_FOLDER + '/april-asr/main.exe', ['-', PROGRAM_FOLDER + '/april-asr/april-english-dev-01110_en.april'], {
           stdio: ['pipe', process.stdout, process.stderr]});
    }

    private writeToAprilASR(data: Buffer) {
        if(this.aprilASR?.stdin?.writable) {
            this.aprilASR.stdin.cork();
            this.aprilASR.stdin.write(data);
            this.aprilASR.stdin.uncork();
        } else {
            console.error('April ASR stdin not writable');
        }
    }

    public startStreaming() {
        // Find the device we're listening to based on what was selected in the UI
        const asio = this.rtAudio.getDevices().filter(d => d.id === this.inputConfig.device)[0]
        if (!asio) return;
        console.log(
            `Connecting to ASIO device ${color(asio.name).bold.blue} with ${color(asio.inputChannels.toString()).bold.blue} channels, listening on channel ${color(this.inputConfig.channel.toString()).bold.blue}`
        );

        // Sample rate must be 16000 for april-asr
        this.inputConfig.sampleRate = 16000;

        const inputParameters: RtAudioStreamParameters = {
            deviceId: asio.id, // Input device id (Get all devices using `getDevices`)
            nChannels: 1, // Number of channels
            firstChannel: this.inputConfig.channel, // First channel index on device (default = 0).
        };

        const silence = Buffer.alloc(1920 * 2); // Twice the frame size because 16 bit
        let silent = true;
        let framesSinceChange = 0;
        let streamingShutoff = false;

        // One frame is 10ms
        this.rtAudio.openStream(
            null,
            inputParameters,
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            16000,
            1920, // Frame size is 1920 (40ms)
            `liveCaptions${this.inputConfig.id}`, // The name of the stream (used for JACK Api)
            (pcm: Buffer) => this.aprilASR?.stdin?.write(pcm),
            // (pcm: Buffer) => {
            //     try {

            //         let data = Array.from(
            //             { length: pcm.length / 2 },
            //             (v, i) => pcm.readInt16LE(i * 2) / (2 ** 15)
            //         );

            //         const amplitude = Math.max(...data) - Math.min(...data);
            //         this.amplitudeArray.shift();
            //         this.amplitudeArray.push(Math.ceil(amplitude * 100));
            //         this.volume = Math.log(this.amplitudeArray.reduce((partialSum, a) => partialSum + a, 0) / this.amplitudeArray.length) * 18.939;

            //         if (this.volume >= this.inputConfig.threshold) {
            //             if (silent) {
            //                 silent = false;
            //                 framesSinceChange = 0;
            //             }

            //             // If noise above threshold and streaming is not shutoff then stream audio
            //             if (!streamingShutoff) {
            //                 this.writeToAprilASR(pcm);
            //             } else {
            //                 streamingShutoff = false;
            //                 this.startAprilASR();
            //             }
            //         } else {
            //             if (!streamingShutoff) {
            //                 if (!silent) {
            //                     silent = true;
            //                     framesSinceChange = 0;
            //                 }

            //                 // Keep streaming audio for a certain amount of time after silence is detected
            //                 if (framesSinceChange < THRESHOLD_CUTOFF_SMOOTHING) {
            //                     this.writeToAprilASR(pcm);
            //                 } else {
            //                     this.writeToAprilASR(silence);
            //                 }

            //                 // Shutoff streaming after certain amount of silence
            //                 if (framesSinceChange > (this.config.transcription.streamingTimeout / 10)) {
            //                     streamingShutoff = true;
            //                     this.stop();
            //                     console.log(color(`Pausing ${this.inputConfig.id} stream`).yellow.toString());
            //                 }
            //             }
            //         }
            //         framesSinceChange++;
            //     } catch (err: unknown) {
            //         console.error(err);
            //     }
            // }, // Input callback function, write every input pcm data to the output buffer,
            null,
            RtAudioStreamFlags.RTAUDIO_ALSA_USE_DEFAULT,
            (err: RtAudioErrorType) => {
                console.error(err);
            }
        );

        // Start the stream
        this.rtAudio.start();
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