const transformers = import('@xenova/transformers');
const WaveFile = require('wavefile').WaveFile;

class SpeechModel {
    constructor() {
        this.setup();
    }

    async setup() {
        const t = await transformers
        this.model = await t.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        console.log("Model Ready")
    }

    async transcribe(buffer) {
        if (!this.model) return {};
        // Load a wav file with 32-bit audio
        let wav = new WaveFile();
        wav.fromBase64(buffer.toString("base64"))
        wav.toBitDepth('32f'); // Pipeline expects input as a Float32Array
        wav.toSampleRate(16000); // Whisper expects audio with a sampling rate of 16000
        let audioData = wav.getSamples();
        if (Array.isArray(audioData)) {
            // For this demo, if there are multiple channels for the audio file, we just select the first one.
            // In practice, you'd probably want to convert all channels to a single channel (e.g., stereo -> mono).
            audioData = audioData[0];
        }
        return this.model(audioData);
    }

    buffToArray(buffer) {
        // Ensure the buffer length is a multiple of 4, as each float32 takes 4 bytes
        if (buffer.length % 4 !== 0) {
            throw new Error('Buffer length must be a multiple of 4');
        }

        // Create a new ArrayBuffer and copy the buffer's data into it
        const arrayBuffer = new ArrayBuffer(buffer.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < buffer.length; ++i) {
            view[i] = buffer[i];
        }

        // Create a Float32Array from the ArrayBuffer
        return new Float32Array(arrayBuffer);
    }
}

module.exports = SpeechModel;