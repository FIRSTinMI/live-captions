import { ConfigManager } from "../util/configManager";
import { Frame } from "../types/Frame";
import { APIError, SpeechResultData } from "../types/GoogleAPI";
import color from "colorts";
import { errorBus } from "../util/eventBus";
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
    private restart: () => void;
    private languages: string[];
    private streamRetries: number = 0;
    private static readonly MAX_STREAM_RETRIES = 5;
    private static readonly RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

    constructor(config: ConfigManager, sampleRate: number, inputId: number, inputName: string, languages: string[], restart: () => void) {
        this.config = config;
        this.sampleRate = sampleRate;
        this.inputId = inputId;
        this.inputName = inputName;
        this.restart = restart;
        this.languages = languages;

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
            };

            // Sometimes the API sends duplicate isFinal frames
            if (frame.isFinal && this.lastFrame.isFinal) return;

            // Or an empty text...
            if (!frame.text || frame.text.trim() === '') return;

            // Or the same frame twice
            if (frame.text === this.lastFrame.text && !frame.isFinal) return;

            // If this frame has fewer words and is not final let's not send the update
            // because otherwise the words kind of flicker as it detects
            // and if the last frame was final then this is a new sentence and obviously will have fewer words
            if (frame.text.split(' ').length - this.lastFrame.text.split(' ').length < 0 && !frame.isFinal && !this.lastFrame.isFinal) return;

            this.lastFrame = frame;

            // A real frame means the stream is healthy again.
            this.streamRetries = 0;

            frame.text = frame.text.trim();
            this.emitter.emit('frame', frame);
        } catch (err) {
            console.error(err);
        }
    }

    private start() {
        const recognitionConfig: google.cloud.speech.v2.IRecognitionConfig = {
            autoDecodingConfig: {},
            explicitDecodingConfig: {
                encoding: 'LINEAR16',
                sampleRateHertz: this.sampleRate,
                audioChannelCount: 1,
            },
            languageCodes: this.languages,
            model: 'latest_long',
            ...(this.config.transcription.phraseSets.length > 0 ? {
                adaptation: {
                    phraseSets: this.config.transcription.phraseSets.map(s => ({ phraseSet: s }))
                }
            } : {}),
            features: {
                enableAutomaticPunctuation: true
            },
            ...(this.config.server.cloud.deviceName ? {
                metadata: {
                    recordingDeviceName: this.config.server.cloud.deviceName,
                    recordingDeviceType: 'PC_MIC' as const,
                }
            } : {})
        };

        const streamingRecognitionConfig: google.cloud.speech.v2.IStreamingRecognitionConfig = {
            config: recognitionConfig,
            streamingFeatures: {
                interimResults: true,
            }
        };

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
                    if (err.toString().includes('305') || err.details?.includes('Max duration')) {
                        this.recognizeStream?.destroy();
                        this.resume();
                    } else if (err.code === 16 || err.code === 7 ||
                        err.toString().includes('does not contain a client_email field') ||
                        err.toString().includes('does not contain a private_key field')) {
                        console.error(color('Google API Authentication Failed').bold.red.toString());
                        console.error(err.details);
                        this.emitter.emit('engineError', `Google API authentication failed: ${err.details ?? err.message}`);
                        errorBus.emit('error', {
                            message: `Google API authentication failed: ${err.details ?? err.message}`,
                            context: { code: err.code, inputId: this.inputId },
                        });
                        this.pause();
                    } else if (err.message.includes('Cannot call write after a stream was destroyed')) {
                        console.log(color(`${err.message}: ${err.code}.  Restarting...`).red.toString());
                        this.pause();
                        this.resume();
                    } else if (err.code === 10 && /no more client requests/i.test(err.details ?? err.message ?? '')) {
                        // ABORTED "Stream timed out after receiving no more client requests":
                        // Google closes a stream that got no audio for ~10 s. That is the
                        // silence gate doing its job (no audio is sent while nobody talks, so
                        // silence is never billed), not a failure: pause, don't retry, and let
                        // speech.ts reopen the stream when audio comes back. Before v1.11.3 the
                        // catch-all below only paused, which handled this the same way; its
                        // retry loop then turned every quiet mic into "exhausted 5 retries".
                        console.log(color(`GoogleV2: input ${this.inputId} idle (no audio), pausing until audio returns`).yellow.toString());
                        this.pause();
                        this.emitter.emit('idle');
                    } else {
                        // grpc-js builds its Error from the gRPC Status (code/name/details);
                        // when the HTTP/2 stream dies before any status trailer arrives, those
                        // are all undefined and err.toString() prints "undefined undefined:
                        // undefined". Give a message that says what actually happened instead.
                        const hasRealStatus = err.code !== undefined || !!err.details || !!err.message;
                        const message = hasRealStatus
                            ? (err.details ?? err.message ?? String(err))
                            : 'Speech stream closed with no response from the server (connection dropped before a status was received)';
                        console.error(err);
                        errorBus.emit('error', {
                            message,
                            context: { code: err.code, inputId: this.inputId },
                        });

                        // Only a failure that outlasts the retries is an engine error. While
                        // retrying, speech.ts keeps the input active so the new stream gets
                        // audio; marking it errored here stopped all writes, so every retry
                        // opened a stream with no audio and Google timed it out again.
                        if (this.streamRetries < GoogleV2.MAX_STREAM_RETRIES) {
                            const delay = GoogleV2.RETRY_BACKOFF_MS[this.streamRetries];
                            this.streamRetries += 1;
                            console.log(color(`GoogleV2: retrying input ${this.inputId} in ${delay}ms (attempt ${this.streamRetries}/${GoogleV2.MAX_STREAM_RETRIES})`).yellow.toString());
                            this.pause();
                            // Safe even if destroy() runs during the wait: start() no-ops
                            // once this.speech has been deleted.
                            setTimeout(() => this.resume(), delay);
                        } else {
                            console.error(color(`GoogleV2: input ${this.inputId} exhausted ${GoogleV2.MAX_STREAM_RETRIES} retries, giving up until a manual restart`).bold.red.toString());
                            this.emitter.emit('engineError', message);
                            this.pause();
                        }
                    }
                })
                .on('data', (data: any) => this.handleRecognitionEvent(data));

            this.recognizeStream.write(streamingRecognizeRequest);
        }
    }

    public write(pcm: Buffer) {
        if (this.dead) return; // intentionally paused, drop audio silently
        if (this.recognizeStream?.closed || this.recognizeStream?.destroyed) {
            console.error('[RESTART] triggered from GoogleV2.write() - dead stream on input ' + this.inputId);
            this.recognizeStream?.destroy();
            this.speech?.close();
            this.restart();
            return;
        }
        this.recognizeStream?.write({ audio: pcm });
    }

    public destroy() {
        this.dead = true;
        this.recognizeStream?.destroy();
        this.speech?.close();
        delete this.speech;
    }
}
