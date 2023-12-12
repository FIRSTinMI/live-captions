import { SpeechClient } from "@google-cloud/speech";
import ConfigManager from "./util/config_manager";
import { RtAudio, RtAudioFormat } from 'audify';
import WebSocket from "ws";
import BadWords from 'bad-words'
import { DeviceConfig } from "./types/Config";

// @ts-ignore
require('@colors/colors');

class Speech {

    private config: ConfigManager;
    private device: DeviceConfig;
    private clients: WebSocket[];
    private speech: SpeechClient;
    private request: any;
    private rtAudio: RtAudio;
    private dead: boolean = false;
    private filter = new BadWords();

    constructor(config: ConfigManager, device: DeviceConfig, rtAudio: RtAudio, clients: WebSocket[]) {
        this.config = config;
        this.device = device;
        this.clients = clients;
        this.speech = new SpeechClient(config.config.google);
        this.request = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: 'en-US',
                model: 'latest_long'
            },
            interimResults: true,
        };
        this.rtAudio = rtAudio;

        // Process filter
        let removeWords = [];
        let addWords = [];
        for (let word of this.config.config.server.filter) {
            if (word.startsWith('+')) {
                addWords.push(word.substr(1));
            } else {
                removeWords.push(word.substr(1));
            }
        }
        this.filter.addWords(...addWords);
        this.filter.removeWords(...removeWords);
    }

    stop() {
        this.dead = true;
        this.rtAudio.setInputCallback(() => { });
        this.rtAudio.closeStream();
        this.speech.close()
    }

    startStreaming() {
        let lastFrame = {
            type: 'words',
            isFinal: false,
            text: '',
            confidence: 0
        };

        // Find the device we're listening to based on what was selected in the UI
        const rtDevice = this.rtAudio.getDevices().filter(d => d.id === this.device.id)[0]

        if (!rtDevice) return;

        console.log(`Connecting to device ${rtDevice.name} with ${rtDevice.inputChannels} channels, listening on channel ${this.device.channel}`)

        // Update sample rate from xair
        this.request.config.sampleRateHertz = rtDevice.preferredSampleRate;

        const recognizeStream = this.speech
            .streamingRecognize(this.request)
            .on('error', (err) => {
                // Error 11 is maxing out the 305 second limit, so we just restart
                // TODO: automatically stop and start streaming when there's silence/talking

                // @ts-ignore
                if (err.code == 11) {
                    this.rtAudio.closeStream();
                    return this.startStreaming();
                    // @ts-ignore
                } else if (err.code === 16 ||
                    err.toString().includes('does not contain a client_email field') ||
                    err.toString().includes('does not contain a private_key field')) {
                        // @ts-ignore
                    console.error('Google API Authentication Failed'.bold.red);
                    this.rtAudio.stop();
                } else {
                    console.error(err);
                }
            })
            .on('data', data => {
                let frame = {
                    device: this.device,
                    type: 'words',
                    isFinal: data.results[0].isFinal,
                    text: data.results[0].alternatives[0].transcript,
                    confidence: data.results[0].alternatives[0].confidence
                }

                if (frame.text.trim() === '') return;

                // If this frame has fewer words and is not final let's not send the update
                // because otherwise the words kind of flicker as it detects
                // and if the last frame was final then this is a new sentence and obviously will have fewer words
                if (frame.text.split(' ').length - lastFrame.text.split(' ').length < 0 && !frame.isFinal && !lastFrame.isFinal) {
                    return;
                }

                // Trim whitespace and censor bad words
                try {
                    frame.text = this.filter.clean(frame.text.trim());
                } catch (err) {
                    console.error(err);
                    console.error(frame.text);
                    return;
                }

                lastFrame = frame;
                let msg = JSON.stringify(frame);
                for (let ws of this.clients) {
                    ws.send(msg);
                }
            });

        this.rtAudio.openStream(
            null,
            {
                deviceId: rtDevice.id, // Input device id (Get all devices using `getDevices`)
                nChannels: 1, // Number of channels
                firstChannel: parseInt(this.device.channel.toString()), // First channel index on device (default = 0).
            },
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            rtDevice.preferredSampleRate, // Sampling rate is 48kHz
            1920, // Frame size is 1920 (40ms)
            "Filip is cool", // The name of the stream (used for JACK Api)
            (pcm) => {
                try {
                    if (this.dead) return;
                    recognizeStream.write(pcm)
                } catch (e) {
                    console.log(e)
                }
            }, // Input callback function, write every input pcm data to the output buffer
            () => { }
        );

        // Start the stream
        this.rtAudio.start();
    }
}

export default Speech;
