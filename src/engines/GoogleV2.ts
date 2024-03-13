import { ConfigManager } from "../util/configManager";
import { Frame } from "../types/Frame";
import { APIError, SpeechResultData } from "../types/GoogleAPI";
import color from "colorts";
import { v2 } from '@google-cloud/speech';
const SpeechClient = v2.SpeechClient;
import { CancellableStream } from 'google-gax';
import { google } from '@google-cloud/speech/build/protos/protos';
import EventEmitter from 'events';

export class GoogleV2 {
    private config: ConfigManager;
    private speech?: v2.SpeechClient;
    private dead: boolean = false;
    private recognizeStream?: CancellableStream;
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
    private sampleRate: number;

    constructor(config: ConfigManager, sampleRate:number, inputId: number, inputName: string) {
        this.config = config;
        this.sampleRate = sampleRate;
        this.inputId = inputId;
        this.inputName = inputName;
        if (config.server.google.credentials.client_email === '' || config.server.google.credentials.private_key === '') {
            console.error(color('Google API Authentication Failed').bold.red.toString());
        } else {
            this.speech = new SpeechClient({ ...config.server.google });
        }
        this.startGoogleStream();
    }

    public pause() {
        this.dead = true;
        this.recognizeStream?.destroy();
        this.speech?.close();
    }

    public resume() {
        this.dead = false;
        this.startGoogleStream();
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

    private startGoogleStream() {
        const recognitionConfig: google.cloud.speech.v2.IRecognitionConfig = {
            autoDecodingConfig: {},
            explicitDecodingConfig: {
                encoding: 'LINEAR16',
                sampleRateHertz: this.sampleRate,
                audioChannelCount: 1,
            },
            languageCodes: ['en-US'],
            model: 'latest_long',
            adaptation: {
                phraseSets: this.config.transcription.phraseSets.map(s => ({ phraseSet: s }))
            }
        }

        const streamingRecognitionConfig: google.cloud.speech.v2.IStreamingRecognitionConfig = {
            config: recognitionConfig,
            streamingFeatures: {
                interimResults: true,
            }
        }

        const streamingRecognizeRequest: google.cloud.speech.v2.IStreamingRecognizeRequest = {
            recognizer: `projects/${this.config.server.google.projectId}/locations/global/recognizers/_`,
            streamingConfig: streamingRecognitionConfig,
        };

        if (this.speech) {
            console.log(color(`GoogleV2: Starting ${this.inputId} stream`).green.toString());
            this.recognizeStream = this.speech
                ._streamingRecognize()
                .on('error', (err: APIError) => {
                    // Error maxing out the 305 second limit, so we just restart
                    if (err.toString().includes('305') || err.details.includes('Max duration')) {
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
                .on('data', (data: any) => this.handleRecognitionEvent(data));

            this.recognizeStream.write(streamingRecognizeRequest);
        }
    }

    public write(pcm: Buffer) {
        if (this.dead || this.recognizeStream?.closed || this.recognizeStream?.destroyed) throw new Error('Tried to write to a dead GoogleV2 instance');   
        this.recognizeStream?.write({ audio: pcm });
    }

    public destroy() {
        this.dead = true;
        this.recognizeStream?.destroy();
        this.speech?.close();
        delete this.speech;
    }
}
