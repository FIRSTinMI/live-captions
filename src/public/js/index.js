const lc = document.getElementById('lc');

let timeout = 10e3;
let config = {};

const deviceStats = [];

function updateConfig() {
    return fetch('/config')
        .then(res => res.json())
        .then(json => {
            // Clear old styles
            lc.style.removeProperty('bottom');
            lc.style.removeProperty('top');
            lc.style.removeProperty('left');
            lc.style.removeProperty('right');
            lc.style.removeProperty('transform');

            switch (json.display.position.toString()) {
                case '0':
                    lc.style.bottom = '0';
                    break;
                case '1':
                    lc.style.top = '0';
                    break;
                case '2':
                    lc.style.bottom = '256px';
                    break;
                case '3':
                    lc.style.top = '256px';
                    break;
            }
            switch (json.display.align) {
                case 'left':
                    lc.style.left = '0';
                    break;
                case 'right':
                    lc.style.right = '0';
                    break;
                case 'center':
                    lc.style.left = '50%';
                    lc.style.transform = 'translateX(-50%)';
                    break;
            }
            document.body.style.backgroundColor = json.display.chromaKey;
            lc.style.maxHeight = (json.display.lines * (json.display.size + 6)) + 'px';
            for (let child of lc.children) {
                child.style.fontSize = config.display.size + 'px';
                child.style.lineHeight = (config.display.size + 6) + 'px';
                child.style.maxHeight = (parseFloat(config.display.size) + 6) + 'px';
            }

            timeout = json.display.timeout * 1000;
            config = json;
        });
}

function capitalize(text) {
    const arr = text.split(".");

    for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
    }

    return arr.join(".");
}


function connectToSocket() {
    // Open connection
    const socket = new WebSocket(`ws://${window.location.host}/ws/`);

    // Connection opened
    socket.addEventListener('open', (evt) => {
        console.log('Connected');
        socket.send('display');
        setInterval(() => {
            socket.send('heartbeat');
        }, 60e3);
    });

    socket.addEventListener('close', () => {
        console.log('Socket lost connection, retying in 5 seconds');
        setTimeout(connectToSocket, 5e3);
    });

    socket.addEventListener('error', (err) => {
        console.error(err);
    });

    // Listen for messages
    socket.addEventListener('message', (evt) => handleCaptionFrame(JSON.parse(evt.data)));
}

/*
{
    device: number,
    type: 'words',
    isFinal: boolean,
    text: string,
    confidence: number,
    skip?: number
}
*/

function handleCaptionFrame(frame) {
    console.log(frame);
    if (frame.type == 'config') return window.location.reload();
    if (frame.text == '') return;

    const device = frame.device;

    // Initilize defaults
    if (!deviceStats[device]) deviceStats[device] = {
        transcript: '',
        lastFrameWasFinal: false,
        currentDiv: undefined,
        currentTimeout: undefined,
        color: config.transcription.inputs.find((input) => (input.id === device)).color
    };

    let { transcript, lastFrameWasFinal, currentDiv, currentTimeout, color } = deviceStats[device];

    clearTimeout(currentTimeout);
    lc.style.display = 'block';

    // Check if we've located the correct span
    if (currentDiv != undefined) {
        // Just append to that
        if (!frame.isFinal) currentDiv.innerText = transcript + capitalize(frame.text);
    } else {
        // Otherwise create a new span with the correct color
        currentDiv = document.createElement('div');
        currentDiv.style.color = color;
        currentDiv.style.fontSize = config.display.size + 'px';
        currentDiv.style.lineHeight = (config.display.size + 6) + 'px';
        currentDiv.style.maxHeight = (parseFloat(config.display.size) + 6) + 'px';
        lc.appendChild(currentDiv);
        currentDiv.innerText = capitalize(frame.text) + ((frame.isFinal) ? '.\n' : '');
    }

    if (frame.isFinal) {
        lastFrameWasFinal = true;

        // If the sentence is finished we can commit it to the transcript
        if (frame.confidence > 0) {
            transcript += capitalize(frame.text) + '.\n'
        } else {
            // confidence < 0 means we're using April engine which handles punctuation itself
            transcript += capitalize(frame.text) + '\n'
        }
        currentDiv.innerText = transcript

        currentTimeout = setTimeout(() => {
            deviceStats[device].currentDiv.innerHTML = '';
            deviceStats[device].transcript = '';

            // Iterate over all spans and check transcripts, if we're all empty, hide the container
            let allEmpty = deviceStats.reduce((acc, val) => {
                acc = acc && val.transcript == '';
                return acc;
            }, true);

            if (allEmpty) {
                lc.style.display = 'none';
            }
        }, timeout);
    }

    // Scroll to bottom of ALL containers and set heights as a percentage of how many are visible
    const visibleContainers = Array.from(lc.children).reduce((acc, val) => val.innerHTML != '' ? acc + 1 : acc, 0);
    const percent = 100 / visibleContainers;
    for (const div of lc.children) {
        div.scrollTop = div.scrollHeight;
        div.style.height = percent + '%';
    }

    // Update frame stats
    deviceStats[device] = {
        transcript,
        lastFrameWasFinal,
        currentDiv,
        currentTimeout
    };
}

// const observer = new MutationObserver((mutationList, observer) => {
//     lc.scrollTop = lc.scrollHeight;
// });
// observer.observe(lc, { attributes: true, childList: true, subtree: true });

updateConfig().then(() => {
    connectToSocket();
})