import { Frame } from '../types/Frame';
import ws from 'ws';
import { LoremIpsum } from "lorem-ipsum";

const lorem = new LoremIpsum({
    sentencesPerParagraph: {
        max: 8,
        min: 4
    },
    wordsPerSentence: {
        max: 16,
        min: 4
    }
});

function dispatchSentence(clients: ws[], frame: Frame, wordsLeft: string[], resolve: any) {
    if (wordsLeft.length < 1) {
        frame.isFinal = true;
    } else {
        frame.text += ' ' + wordsLeft[0];
        frame.text = frame.text.trim();
        wordsLeft = wordsLeft.slice(1);
    }

    for (let client of clients) {
        client.send(JSON.stringify(frame));
    }

    if (frame.isFinal) return resolve();
    setTimeout(() => dispatchSentence(clients, frame, wordsLeft, resolve), Math.round((Math.random() * 1000) + 100));
}

async function startGibberishLoop(clients: ws[], i: number) {
    await new Promise((resolve, reject) => {
        dispatchSentence(clients, {
            device: i,
            type: 'words',
            isFinal: false,
            text: '',
            confidence: 1
        }, lorem.generateSentences(1).replace('.', '').split(' '), resolve);
    });
    setTimeout(() => startGibberishLoop(clients, i), Math.round((Math.random() * 10000) + 1000));
}

export function gibberish(clients: ws[], numDevices: number) {
    for (let i = 0; i < numDevices; i++) {
        startGibberishLoop(clients, i)
    }
}
