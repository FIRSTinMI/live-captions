"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const speech_1 = require("@google-cloud/speech");
const bad_words_1 = __importDefault(require("bad-words"));
class Speech {
    constructor(config, device, rtAudio, clients) {
        this.dead = false;
        this.filter = new bad_words_1.default();
        this.config = config;
        this.device = device;
        this.clients = clients;
        this.speech = new speech_1.SpeechClient(config.config.google);
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
            }
            else {
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
        this.speech.close();
    }
    startStreaming() {
        let lastFrame = {
            type: 'words',
            isFinal: false,
            text: '',
            confidence: 0
        };
        const selectedDevice = this.device.id.toString();
        const rtDevice = this.rtAudio.getDevices().filter(d => d.id.toString() === selectedDevice)[0];
        if (!rtDevice)
            return;
        console.log(`Connecting to device ${rtDevice.name} with ${rtDevice.inputChannels} channels, listening on channel ${this.device.channel}`);
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
            }
            console.error(err);
        })
            .on('data', data => {
            let frame = {
                device: this.device,
                type: 'words',
                isFinal: data.results[0].isFinal,
                text: data.results[0].alternatives[0].transcript,
                confidence: data.results[0].alternatives[0].confidence
            };
            if (frame.text.trim() === '')
                return;
            // If this frame has fewer words and is not final let's not send the update
            // because otherwise the words kind of flicker as it detects
            // and if the last frame was final then this is a new sentence and obviously will have fewer words
            if (frame.text.split(' ').length - lastFrame.text.split(' ').length < 0 && !frame.isFinal && !lastFrame.isFinal) {
                return;
            }
            // Trim whitespace and censor bad words
            try {
                frame.text = this.filter.clean(frame.text.trim());
            }
            catch (err) {
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
        this.rtAudio.openStream(null, {
            deviceId: rtDevice.id, // Input device id (Get all devices using `getDevices`)
            nChannels: 1, // Number of channels
            firstChannel: parseInt(this.device.channel.toString()), // First channel index on device (default = 0).
        }, 2 /* RtAudioFormat.RTAUDIO_SINT16 */, // PCM Format - Signed 16-bit integer
        rtDevice.preferredSampleRate, // Sampling rate is 48kHz
        1920, // Frame size is 1920 (40ms)
        "Filip is cool", // The name of the stream (used for JACK Api)
        (pcm) => {
            try {
                if (this.dead)
                    return;
                recognizeStream.write(pcm);
            }
            catch (e) {
                console.log(e);
            }
        }, // Input callback function, write every input pcm data to the output buffer
        () => { });
        // Start the stream
        this.rtAudio.start();
    }
}
exports.default = Speech;
