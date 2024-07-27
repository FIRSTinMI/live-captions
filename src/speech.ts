import { RtAudio, RtAudioErrorType, RtAudioFormat, RtAudioStreamFlags, RtAudioStreamParameters } from 'audify';
import WebSocket from "ws";
import BadWords from 'bad-words'
import { ConfigManager } from "./util/configManager";
import { InputConfig } from "./types/Config";
import { Frame } from "./types/Frame";
import color from "colorts";
import { GoogleV2 } from './engines/GoogleV2';
import { GoogleV1 } from './engines/GoogleV1';
import { April } from './engines/April';
import { transform } from './util/transformer';

// Number of frames after silence is detected to continue streaming
const THRESHOLD_CUTOFF_SMOOTHING = 10;

export class Speech<T extends GoogleV2 | GoogleV1 | April> {
    private config: ConfigManager;
    public inputConfig: InputConfig;
    private clients: WebSocket[];
    private engine: GoogleV2 | GoogleV1 | April;
    private rtAudio: RtAudio;
    private filter = new BadWords();
    private amplitudeArray: number[] = [0, 0, 0, 0, 0];
    private amplitudeSum: number = 0;
    public volume: number = 0;

    constructor(config: ConfigManager, clients: WebSocket[], input: InputConfig, engine: { new(config: ConfigManager, sampleRate: number, inputId: number, inputName: string): T }) {
        input.sampleRate = 16000;
        this.config = config;
        this.inputConfig = input;
        this.clients = clients;

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

        this.engine = new engine(config, input.sampleRate, input.id, input.speaker ?? "Unknown");

        this.engine.emitter.on('frame', (frame: Frame) => {
            console.log(config.transformations);
            frame.text = transform(frame.text, config.transformations);
            try {
                frame.text = this.filter.clean(frame.text);
            } catch (err) {
                return console.error(`Error while trying to filter ${frame.text}`);
            }
            let msg = JSON.stringify(frame);
            for (let ws of this.clients) {
                ws.send(msg);
            }
        });

        this.rtAudio = new RtAudio(input.driver);
    }

    public startStreaming() {
        // Find the device we're listening to based on what was selected in the UI
        const asio = this.rtAudio.getDevices().filter(d => d.id === this.inputConfig.device)[0]
        if (!asio) return;
        console.log(
            `Connecting to ASIO device ${color(asio.name).bold.blue} with ${color(asio.inputChannels.toString()).bold.blue} channels, listening on channel ${color(this.inputConfig.channel.toString()).bold.blue}`
        );

        const inputParameters: RtAudioStreamParameters = {
            deviceId: asio.id, // Input device id (Get all devices using `getDevices`)
            nChannels: 1, // Number of channels
            firstChannel: this.inputConfig.channel, // First channel index on device (default = 0).
        };

        const silence = Buffer.alloc(480 * 2); // Twice the frame size because 16 bit
        let silent = true;
        let framesSinceChange = 0;
        let streamingShutoff = false;

        // One frame is 10ms
        this.rtAudio.openStream(
            null,
            inputParameters,
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            this.inputConfig.sampleRate, // Sample rate
            480, // Frame size is 480 (10ms)
            `liveCaptions${this.inputConfig.id}`, // The name of the stream (used for JACK Api)
            (pcm: Buffer) => {
                let min = 32767;
                let max = -32768;
                const originalBufferLength = pcm.length; // not sure if reading from this buffer type clears the data from the buffer -> reduces length of the buffer
                for (let i = 0; i < originalBufferLength / 2; i++) {
                let val = pcm.readInt16LE(i * 2) / 2 ** 15;

                if (val < min) {
                    min = val;
                }

                if (val > max) {
                    max = val;
                }
                }

                const amplitude = max - min;

                this.amplitudeSum -= this.amplitudeArray[0];
                this.amplitudeArray.shift();

                this.amplitudeArray.push(Math.ceil(amplitude * 100));
                this.amplitudeSum += this.amplitudeArray[this.amplitudeArray.length - 1];

                this.volume = Math.log(this.amplitudeSum / this.amplitudeArray.length) * 18.939;

                if (this.volume >= this.inputConfig.threshold) {
                    if (silent) {
                        silent = false;
                        framesSinceChange = 0;
                    }

                    // If noise above threshold and streaming is not shutoff then stream audio
                    if (!streamingShutoff) {
                        this.engine.write(pcm);
                    } else {
                        this.engine.resume();
                        streamingShutoff = false;
                    }
                } else {
                    if (!streamingShutoff) {
                        if (!silent) {
                            silent = true;
                            framesSinceChange = 0;
                        }

                        // Keep streaming audio for a certain amount of time after silence is detected
                        if (framesSinceChange < THRESHOLD_CUTOFF_SMOOTHING) {
                            this.engine.write(pcm);
                        } else {
                            this.engine.write(silence);
                        }

                        // Shutoff streaming after certain amount of silence
                        if (framesSinceChange > (this.config.transcription.streamingTimeout / 10)) {
                            console.log(color(`Pausing ${this.inputConfig.id} stream`).yellow.toString());
                            streamingShutoff = true;
                            this.engine.pause();
                        }
                    }
                }
                framesSinceChange++;
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

    public destroy() {
        this.rtAudio.closeStream();
        return this.engine.destroy();
    }
}
