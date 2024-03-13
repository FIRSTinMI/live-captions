import { ConfigManager } from "../util/configManager";
import { Frame } from "../types/Frame";
import { APIError, SpeechResultData } from "../types/GoogleAPI";
import color from "colorts";
import { SpeechClient } from '@google-cloud/speech';
import EventEmitter from 'events';
import Pumpify from "pumpify";

export class GoogleV1 {
    private config: ConfigManager;
    private sampleRate: number;
    private speech?: SpeechClient;
    private dead: boolean = false;
    private recognizeStream?: Pumpify;
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
    private request: any = {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: 'en-US',
            model: 'latest_long'
        },
        interimResults: true,
    };

    constructor(config: ConfigManager, sampleRate:number, inputId: number, inputName: string) {
        this.config = config;
        this.sampleRate = sampleRate;
        this.request.config.sampleRateHertz = sampleRate;
        this.inputId = inputId;
        this.inputName = inputName;
        if (config.server.google.credentials.client_email === '' || config.server.google.credentials.private_key === '') {
            console.error(color('Google API Authentication Failed').bold.red.toString());
        } else {
            this.speech = new SpeechClient({ ...config.server.google });
        }
        this.start();
    }

    public pause() {
        this.dead = true;
        this.recognizeStream?.destroy();
        this.speech?.close();
    }

    public resume() {
        this.dead = false;
        this.start();
    }

    private handleRecognitionEvent(data: SpeechResultData) {
        try {
            if (data.results.length < 1 && data.results[0].alternatives.length < 1) return;
            let frame: Frame = {
                device: this.inputId,
                type: 'words',
                isFinal: data.results[0].isFinal,
                text: data.results[0].alternatives[0]?.transcript,
                confidence: data.results[0].alternatives[0]?.confidence,
                speaker: this.inputName
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

            frame.text = frame.text.trim();
            this.emitter.emit('frame', frame);
        } catch (err) {
            console.error(err);
        }
    }

    private start() {
        if (this.speech) {
            console.log(color(`GoogleV1: Starting ${this.inputId} stream`).green.toString());
            this.recognizeStream = this.speech
                .streamingRecognize(this.request)
                .on('error', (err: APIError) => {
                    // Error maxing out the 305 second limit, so we just restart
                    if (err.toString().includes('305')) {
                        this.recognizeStream?.destroy();
                        this.resume();
                    } else if (err.code === 16 ||
                        err.toString().includes('does not contain a client_email field') ||
                        err.toString().includes('does not contain a private_key field')) {
                        console.error(color('Google API Authentication Failed').bold.red.toString());
                        this.pause();
                    } else if (err.message.includes('Cannot call write after a stream was destroyed')) {
                        console.log(color(`${err.message}: ${err.code}.  Restarting...`).red.toString());
                        this.pause();
                        this.resume();
                    } else {
                        console.error(err);
                    }
                })
                .on('data', (data) => this.handleRecognitionEvent(data));
        }
    }

    public write(pcm: Buffer) {
        if (this.dead || this.recognizeStream?.closed || this.recognizeStream?.destroyed) throw new Error('Tried to write to a dead GoogleV1 instance');   
        this.recognizeStream?.write(pcm);
    }

    public destroy() {
        this.dead = true;
        this.recognizeStream?.destroy();
        this.speech?.close();
        delete this.speech;
    }
}
