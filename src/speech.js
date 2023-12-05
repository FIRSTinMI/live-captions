const recorder = require('@filip96/node-record-lpcm16');
const Lib = require('@google-cloud/speech');
const Filter = require('bad-words'), filter = new Filter();

class Speech {
    constructor(config, program_folder, clients, device = 1) {
        this.config = config;
        this.program_folder = program_folder;
        this.clients = clients;
        this.device = device;
        this.speech = new Lib.SpeechClient(config.config.google);
        this.request = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: config.config.server[`device${this.device}_sampleRate`],
                languageCode: 'en-US',
                model: 'latest_long'
            },
            interimResults: true,
        };

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

    startStreaming() {
        let lastFrame = {
            type: 'words',
            isFinal: false,
            text: '',
            confidence: 0
        };

        this.recognizeStream = this.speech
            .streamingRecognize(this.request)
            .on('error', (err) => {
                // Error 11 is maxing out the 305 second limit, so we just restart
                // TODO: automatically stop and start streaming when there's silence/talking
                if (err.code == 11) return this.startStreaming();
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

        this.recorder = recorder.record({
            sampleRateHertz: this.config.config[`device${this.device}_sampleRate`],
            threshold: 0,
            verbose: false,
            recorder: 'sox',
            silence: '10.0',
            cmd: this.program_folder + '/sox-14.4.1/sox.exe',
            device: (this.config.config[`device${this.device}`] == 'null') ? '' : this.config.config[`device${this.device}`]
        });
        this.recorder.stream()
            .on('error', console.error)
            .pipe(this.recognizeStream);
    }
}

module.exports = Speech;
