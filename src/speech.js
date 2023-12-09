//const recorder = require('@filip96/node-record-lpcm16');
const Lib = require('@google-cloud/speech');
const Filter = require('bad-words'), filter = new Filter();
const { RtAudioFormat } = require("audify");

class Speech {
    constructor(config, rtAudio, program_folder, clients, model, device = 1) {
        this.config = config;
        this.program_folder = program_folder;
        this.clients = clients;
        this.device = device;
        this.speech = new Lib.SpeechClient(config.config.google);
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
        this.dead = false;
        this.model = model;

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
        filter.addWords(...addWords);
        filter.removeWords(...removeWords);
    }

    stop() {
        this.dead = true;
        this.rtAudio.setInputCallback(() => {});
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

        const asio = this.rtAudio.getDevices().filter(d => d.id.toString() === this.config.config.server[`device${this.device}`])[0]

        if (!asio) return;

        console.log(`Connecting to ASIO device ${asio.name} with ${asio.inputChannels} channels, listening on channel ${this.config.config.server[`device${this.device}_channel`]}`)

        // Update sample rate from xair
        this.request.config.sampleRateHertz = asio.preferredSampleRate;

        this.recognizeStream = this.speech
            .streamingRecognize(this.request)
            .on('error', (err) => {
                // Error 11 is maxing out the 305 second limit, so we just restart
                // TODO: automatically stop and start streaming when there's silence/talking
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
                    frame.text = filter.clean(frame.text.trim());
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
              deviceId: asio.id, // Input device id (Get all devices using `getDevices`)
              nChannels: 1, // Number of channels
              firstChannel: parseInt(this.config.config.server[`device${this.device}_channel`]), // First channel index on device (default = 0).
            },
            RtAudioFormat.RTAUDIO_SINT16, // PCM Format - Signed 16-bit integer
            asio.preferredSampleRate, // Sampling rate is 48kHz
            1920, // Frame size is 1920 (40ms)
            "Filip is cool", // The name of the stream (used for JACK Api)
            (pcm) => {
                try {
                    if (this.dead) return;
                    // this.recognizeStream.write(pcm)
                    this.model.transcribe(pcm).then(console.log)
                } catch(e) {
                    console.log(e)
                }
             } // Input callback function, write every input pcm data to the output buffer
          );
          
          // Start the stream
          this.rtAudio.start();

          
    }
}

module.exports = Speech;
