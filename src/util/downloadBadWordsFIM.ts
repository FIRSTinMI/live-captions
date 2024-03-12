import { ConfigManager } from "./configManager";

export async function updateBadWordsList(config: ConfigManager) {
    const FIMBadWords = await fetch('https://storage.googleapis.com/live-captions-assets/badwords.txt').then(res => res.text());

    let filter = config.transcription.filter;

    for (let word of FIMBadWords.split('\n')) {
        word = word.trim();
        let sign = word.slice(0, 1);

        if (word.length <= 1) continue;

        if (sign === '+') {
            if (!filter.includes(word)) {
                filter.push(word);
                console.log('Added to filter: ' + word);
            }
            if (filter.includes('-' + word.slice(1))) {
                filter.splice(filter.indexOf('-' + word.slice(1)), 1);
            }
        } else if (sign === '-') {
            if (!filter.includes(word)) {
                filter.push(word);
                console.log('Added to filter: ' + word);
            }
            if (filter.includes('+' + word.slice(1))) {
                filter.splice(filter.indexOf('+' + word.slice(1)), 1);
            }
        }
    }

    config.transcription.filter = filter;
    config.save();
}
