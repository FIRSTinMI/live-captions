function randomText() {
    return Math.random().toString(36).substring(7);
}

function fiftyPercentChance() {
    return Math.random() > 0.5;
}

function gibberish(clients, numDevices) {
    let frames = [];
    // Create a frame for each device
    for (let i = 0; i < numDevices; i++) {
        frames.push({
            device: i + 1,
            type: 'words',
            isFinal: false,
            text: "",
            confidence: 1
        })
    }

    setInterval(() => {
        // Randomize frames
        frames = frames.map(frame => {
            // If the last time this was a final frame, we need to reset it
            if (frame.isFinal) {
                frame.text = "";
                frame.skip = 0;
            }

            // Skip a few frames to make it more realistic
            if (frame.skip < 5) {
                frame.isFinal = false;
                frame.skip++;
                return frame;
            }

            frame.text = frame.text + " " + randomText();
            frame.isFinal = fiftyPercentChance();
            return frame;
        });

        clients.forEach(client => {
            frames.forEach(frame => {
                if (frame.text === "") return;
                client.send(JSON.stringify(frame));
            });
        })
    }, 1000);

    return;
}

module.exports = {
    gibberish
}