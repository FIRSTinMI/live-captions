import { SpeechClient } from "@google-cloud/speech";
import { RtAudio, RtAudioErrorType, RtAudioFormat, RtAudioStreamFlags, RtAudioStreamParameters } from 'audify';
import WebSocket from "ws";
import BadWords from 'bad-words'
import { ConfigManager } from "./util/configManager";
import { InputConfig } from "./types/Config";
import { Frame } from "./types/Frame";
import { APIError, SpeechResultData } from "./types/GoogleAPI";
import color from "colorts";
import { SingleBar } from "cli-progress";

// Number of frames after silence is detected to continue streaming
const THRESHOLD_CUTOFF_SMOOTHING = 10;
const STOP_STREAMING_CUTTOFF = 600; // about 20 seconds

export class Speech {
    private config: ConfigManager;
    public inputConfig: InputConfig;
    private clients: WebSocket[];
    private speech?: SpeechClient;
    private request: any = {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: 'en-US',
            model: 'latest_long'
        },
        interimResults: true,
    };;
    private rtAudio: RtAudio;
    private dead: boolean = false;
    private filter = new BadWords();
    private recognizeStream: any;
    private lastFrame: Frame = {
        device: 0,
        type: 'words',
        isFinal: false,
        text: '',
        confidence: 0
    };
    private volumeBar: SingleBar | undefined = undefined;
    public volume: number = 0;

    constructor(config: ConfigManager, clients: WebSocket[], input: InputConfig, volumeBar?: SingleBar) {
        this.config = config;
        this.inputConfig = input;
        this.clients = clients;
        if (config.server.google.credentials.client_email === '' || config.server.google.credentials.private_key === '') {
            console.error(color('Google API Authentication Failed').bold.red.toString());
        } else {
            this.speech = new SpeechClient(config.server.google);
        }
        this.rtAudio = new RtAudio(input.driver);
        this.volumeBar = volumeBar;

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

    public stop() {
        this.dead = true;
        this.rtAudio.setInputCallback(() => { });
        this.rtAudio.closeStream();
        this.recognizeStream.destroy();
        this.speech?.close();
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

    private startGoogleStream() {
        this.request.config.sampleRateHertz = this.inputConfig.sampleRate;

        if (this.speech) {
            console.log(color('Starting stream to Google').green.toString());
            this.recognizeStream = this.speech
                .streamingRecognize(this.request)
                .on('error', (err: APIError) => {
                    // Error maxing out the 305 second limit, so we just restart
                    if (err.toString().includes('305')) {
                        this.recognizeStream.destroy();
                        this.rtAudio = new RtAudio(this.inputConfig.driver);
                        return this.startStreaming();
                    } else if (err.code === 16 ||
                        err.toString().includes('does not contain a client_email field') ||
                        err.toString().includes('does not contain a private_key field')) {
                        console.error(color('Google API Authentication Failed').bold.red.toString());
                        this.stop();
                    } else {
                        console.error(err);
                    }
                })
                .on('data', (data) => this.handleRecognitionEvent(data));
        }
    }

    public startStreaming() {
        this.dead = false;
        // Find the device we're listening to based on what was selected in the UI
        const asio = this.rtAudio.getDevices().filter(d => d.id === this.inputConfig.device)[0]
        if (!asio) return;
        console.log(
            `Connecting to ASIO device ${color(asio.name).bold.blue} with ${color(asio.inputChannels.toString()).bold.blue} channels, listening on channel ${color(this.inputConfig.channel.toString()).bold.blue}`
        );

        // Update sample rate from xair
        // TODO: Use sample rate from config
        this.inputConfig.sampleRate = asio.preferredSampleRate;
        this.startGoogleStream();

        const inputParameters: RtAudioStreamParameters = {
            deviceId: asio.id, // Input device id (Get all devices using `getDevices`)
            nChannels: 1, // Number of channels
            firstChannel: this.inputConfig.channel, // First channel index on device (default = 0).
        };

        const silence = Buffer.alloc(1920 * 2); // Twice the frame size because 16 bit
        let silent = true;
        let framesSinceChange = 0;
        let streamingShutoff = false;

        this.rtAudio.openStream(
            null,
            inputParameters,
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            this.inputConfig.sampleRate, // Sampling rate is 48kHz
            1920, // Frame size is 1920 (40ms)
            `liveCaptions${this.inputConfig.id}`, // The name of the stream (used for JACK Api)
            (pcm: Buffer) => {
                try {
                    if (this.dead) return;
                    let data = Array.from(
                        { length: pcm.length / 2 },
                        (v, i) => pcm.readInt16LE(i * 2) / (2 ** 15)
                    );

                    let max = Math.max(...data)
                    let min = Math.min(...data)
                    this.volumeBar?.update((max - min) * 2000);
                    this.volume = (max - min) * 1000;

                    if ((max - min) * 100 >= this.inputConfig.threshold) {
                        if (silent) {
                            silent = false;
                            framesSinceChange = 0;
                        }

                        // If noise above threshold and streaming is not shutoff then stream audio
                        if (!streamingShutoff) {
                            this.recognizeStream?.write(pcm);
                        }

                        // If streaming is shutoff but activity exists for more than 3 frames restart
                        if (streamingShutoff && framesSinceChange > 3) {
                            streamingShutoff = false;
                            this.startGoogleStream();
                        }
                    } else {
                        if (!streamingShutoff) {
                            if (!silent) {
                                silent = true;
                                framesSinceChange = 0;
                            }

                            // Keep streaming audio for a certain amount of time after silence is detected
                            if (framesSinceChange < THRESHOLD_CUTOFF_SMOOTHING) {
                                this.recognizeStream?.write(pcm);
                            } else {
                                this.recognizeStream?.write(silence);
                            }

                            // Shutoff streaming after certain amount of silence
                            if (framesSinceChange > STOP_STREAMING_CUTTOFF) {
                                streamingShutoff = true;
                                this.recognizeStream.destroy();
                                console.log(color('Stopping stream to Google').yellow.toString());
                            }
                        }
                    }
                    framesSinceChange++;
                } catch (err) {
                    console.log(err)
                }
            }, // Input callback function, write every input pcm data to the output buffer,
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
