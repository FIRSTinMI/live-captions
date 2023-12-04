const recorder = require('node-record-lpcm16');
const Lib = require('@google-cloud/speech');
const Filter = require('bad-words'), filter = new Filter();

class Speech {
    constructor(config, program_folder, clients) {
        this.config = config;
        this.program_folder = program_folder;
        this.clients = clients;
        this.speech = new Lib.SpeechClient(config.config.google);
        this.request = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: config.config.server.sampleRate,
                languageCode: 'en-US',
                model: 'latest_long'
            },
            interimResults: true,
        };
    }

    startStreaming() {
        let lastFrame = {
            type: 'words',
            isFinal: false,
            text: '',
            confidence: 0
        };

        const recognizeStream = this.speech
            .streamingRecognize(this.request)
            .on('error', (err) => {
                console.error(err);
                if (err.code == 11) this.startStreaming();
            })
            .on('data', data => {
                let frame = {
                    type: 'words',
                    isFinal: data.results[0].isFinal,
                    text: data.results[0].alternatives[0].transcript,
                    confidence: data.results[0].alternatives[0].confidence
                }

                // If this frame has fewer words and is not final let's not send the update
                // because otherwise the words kind of flicker as it detects
                // and if the last frame was final then this is a new sentence and obviously will have fewer words
                if (frame.text.split(' ').length - lastFrame.text.split(' ').length < 0 && !frame.isFinal && !lastFrame.isFinal) {
                    return;
                }

                // Trim whitespace and censor bad words
                frame.text = filter.clean(frame.text.trim());

                lastFrame = frame;
                let msg = JSON.stringify(frame);
                for (let ws of this.clients) {
                    ws.send(msg);
                }
            });

        recorder
            .record({
                sampleRateHertz: this.config.config.sampleRate,
                threshold: 0,
                verbose: false,
                recorder: 'sox',
                silence: '10.0',
                cmd: this.program_folder + '/sox-14.4.1/sox.exe'
            })
            .stream()
            .on('error', console.error)
            .pipe(recognizeStream);
    }
}

module.exports = Speech;
