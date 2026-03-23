import { RtAudio, RtAudioErrorType, RtAudioFormat, RtAudioStreamFlags, RtAudioStreamParameters } from 'audify';
import BadWords from 'bad-words';
import { ConfigManager } from "./util/configManager";
import { InputConfig } from "./types/Config";
import { Frame } from "./types/Frame";
import color from "colorts";
import { GoogleV2 } from './engines/GoogleV2';
import { GoogleV1 } from './engines/GoogleV1';
import { April } from './engines/April';
import { transform } from './util/transformer';
import { captionBus } from './util/eventBus';

// Number of frames after silence is detected to continue streaming
const THRESHOLD_CUTOFF_SMOOTHING = 10;

// Auto-threshold constants
const AUTO_THRESHOLD_HEADROOM = 12;
const AUTO_THRESHOLD_ALPHA_DOWN = 0.005; // fast decay when room gets quieter (τ ≈ 2s)
const AUTO_THRESHOLD_ALPHA_UP = 0.001;   // slow rise when room gets louder (τ ≈ 10s)

export enum StreamingState {
    ACTIVE,
    PAUSED,
    DESTROYED,
    ERRORED
}

export class Speech<T extends GoogleV2 | GoogleV1 | April> {
    private config: ConfigManager;
    public inputConfig: InputConfig;
    private engine: GoogleV2 | GoogleV1 | April;
    private rtAudio?: RtAudio;
    private filter = new BadWords({ placeHolder: ' ' });
    private amplitudeArray: number[] = [0, 0, 0, 0, 0];
    private amplitudeSum: number = 0;
    public volume: number = 0;
    private restart: () => void;
    private mockMode: boolean = false;
    private silent: boolean = true;
    private framesSinceChange: number = 0;
    private state: StreamingState = StreamingState.ACTIVE;
    private suspended: boolean = false;
    private noiseFloor: number = 0;
    private usageSeconds: number = 0;

    // Getter for test compatibility
    public get getState(): StreamingState {
        return this.state;
    }

    public getUsageMinutes(): number {
        return this.usageSeconds / 60;
    }

    public resetUsageMinutes(): void {
        this.usageSeconds = 0;
    }

    public get effectiveThreshold(): number {
        const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
        const isStale = !this.inputConfig.thresholdLastSet
            || (Date.now() - this.inputConfig.thresholdLastSet > FOUR_DAYS_MS);
        return (this.inputConfig.autoThreshold || isStale)
            ? this.noiseFloor + AUTO_THRESHOLD_HEADROOM
            : this.inputConfig.threshold;
    }

    constructor(config: ConfigManager, input: InputConfig, engine: { new(config: ConfigManager, sampleRate: number, inputId: number, inputName: string, languages: string[], restart: () => void): T; }, restart: () => void, mockMode: boolean = false) {
        input.sampleRate = 16000;
        this.config = config;
        this.inputConfig = input;
        this.restart = restart;
        this.mockMode = mockMode;
        this.noiseFloor = input.threshold; // warm start at manual threshold

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

        this.engine = new engine(config, input.sampleRate, input.id, input.speaker ?? "Unknown", input.languages ?? ['en-us'], this.restart);

        this.engine.emitter.on('engineError', () => {
            this.state = StreamingState.ERRORED;
        });

        this.engine.emitter.on('frame', (frame: Frame) => {
            frame.text = transform(frame.text, config.transformations);
            try {
                frame.text = this.filter.clean(frame.text);
            } catch (err) {
                return console.error(`Error while trying to filter ${frame.text}`);
            }
            captionBus.emit('frame', frame);
        });

        if (!this.mockMode) {
            this.rtAudio = new RtAudio(input.driver);
        }
    }

    public startStreaming() {
        // In mock mode, skip rtAudio initialization
        if (this.mockMode) {
            return;
        }

        // Find the device we're listening to based on what was selected in the UI
        const asio = this.rtAudio!.getDevices().filter(d => d.id === this.inputConfig.device)[0];
        if (!asio) return;
        console.log(
            `Connecting to ASIO device ${color(asio.name).bold.blue} with ${color(asio.inputChannels.toString()).bold.blue} channels, listening on channel ${color(this.inputConfig.channel.toString()).bold.blue}`
        );

        const inputParameters: RtAudioStreamParameters = {
            deviceId: asio.id, // Input device id (Get all devices using `getDevices`)
            nChannels: 1, // Number of channels
            firstChannel: this.inputConfig.channel, // First channel index on device (default = 0).
        };

        // One frame is 10ms
        this.rtAudio!.openStream(
            null,
            inputParameters,
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            this.inputConfig.sampleRate, // Sample rate
            480, // Frame size is 480 (10ms)
            `liveCaptions${this.inputConfig.id}`, // The name of the stream (used for JACK Api)
            (pcm: Buffer) => {
                this.processPCMBuffer(pcm);
            }, // Input callback function, write every input pcm data to the output buffer,
            null,
            RtAudioStreamFlags.RTAUDIO_ALSA_USE_DEFAULT,
            (err: RtAudioErrorType) => {
                console.error(err);
            }
        );

        // Start the stream
        this.rtAudio!.start();
    }

    public feedPCMData(pcm: Buffer): void {
        if (!this.mockMode) {
            throw new Error('feedPCMData can only be called in mock mode');
        }
        this.processPCMBuffer(pcm);
    }

    public suspend() {
        this.suspended = true;
        if (this.state === StreamingState.ACTIVE) {
            this.engine.pause();
            this.state = StreamingState.PAUSED;
        }
    }

    public unsuspend() {
        this.suspended = false;
        // processPCMBuffer will call engine.resume() naturally when audio above threshold arrives
    }

    private processPCMBuffer(pcm: Buffer): void {
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

        const rawVolume = Math.log(this.amplitudeSum / this.amplitudeArray.length) * 18.939;
        this.volume = isFinite(rawVolume) ? rawVolume : 0;

        // Update noise floor EMA only during silence - never during active speech.
        // This prevents: (a) long speech slowly raising the floor until it cuts out,
        // (b) the floor chasing the speaker's voice instead of the ambient noise.
        // During muting (volume → 0) the floor still fast-decays, re-calibrating on unmute.
        if (this.volume < this.effectiveThreshold) {
            if (this.volume < this.noiseFloor) {
                // Room got quieter - decay quickly
                this.noiseFloor = AUTO_THRESHOLD_ALPHA_DOWN * this.volume + (1 - AUTO_THRESHOLD_ALPHA_DOWN) * this.noiseFloor;
            } else {
                // Ambient noise crept up - rise slowly
                this.noiseFloor = AUTO_THRESHOLD_ALPHA_UP * this.volume + (1 - AUTO_THRESHOLD_ALPHA_UP) * this.noiseFloor;
            }
        }
        // When volume >= effectiveThreshold (someone speaking): hold the floor steady.

        // Stop here when suspended - don't write to the speech engine
        if (this.suspended) return;

        const effectiveThreshold = this.effectiveThreshold;

        if (this.volume >= effectiveThreshold) {
            if (this.silent) {
                this.silent = false;
                this.framesSinceChange = 0;
            }

            // If noise above threshold and streaming is not paused then stream audio
            if (this.state === StreamingState.ACTIVE) {
                this.engine.write(pcm);
                this.usageSeconds += 480 / 16000; // one frame = 480 samples @ 16kHz
            } else if (this.state === StreamingState.PAUSED) {
                this.engine.resume();
                this.state = StreamingState.ACTIVE;
            }
            // ERRORED/DESTROYED: don't write or auto-resume - needs a restart
        } else {
            if (this.state === StreamingState.ACTIVE) {
                if (!this.silent) {
                    this.silent = true;
                    this.framesSinceChange = 0;
                }

                // Keep streaming audio for a certain amount of time after silence is detected
                if (this.framesSinceChange < THRESHOLD_CUTOFF_SMOOTHING) {
                    this.engine.write(pcm);
                } else {
                    const silence = Buffer.alloc(480 * 2);
                    this.engine.write(silence);
                }

                // Pause streaming after certain amount of silence
                if (this.framesSinceChange > (this.config.transcription.streamingTimeout / 10)) {
                    console.log(color(`Pausing ${this.inputConfig.id} stream`).yellow.toString());
                    this.state = StreamingState.PAUSED;
                    this.engine.pause();
                }
            }
        }
        this.framesSinceChange++;
    }

    public destroy() {
        this.state = StreamingState.DESTROYED;
        if (this.rtAudio) {
            this.rtAudio.closeStream();
        }
        return this.engine.destroy();
    }
}
