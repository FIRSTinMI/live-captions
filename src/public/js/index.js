const lc = document.getElementById('lc');
const text = document.getElementById('lc-text')

let timeout = 10e3;
let deviceColor = ['#ffffff', '#ffffff'];
let device2 = 'null';

function updateConfig() {
    fetch('/config')
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
                    lc.style.bottom = '128px';
                    break;
                case '3':
                    lc.style.top = '128px';
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
            text.style.fontSize = json.display.size + 'px';
            text.style.lineHeight = (parseFloat(json.display.size) + 6) + 'px';
            lc.style.maxHeight = (json.display.lines * (parseFloat(json.display.size) + 6)) + 'px';
            timeout = json.display.timeout * 1000;
            deviceColor = [json.server.device1_color, json.server.device2_color];
            device2 = json.server.device2;
        });
}

function capitalize(text) {
    const arr = text.split(".");

    for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
    }

    return arr.join(".");
}

let connectedMessageOverwritten = false;
let transcript = '';
let lastFrameWasFinal = false;
let currentTimeout, currentSpan;
let currentDevice = 1;

function connectToSocket() {
    // Open connection
    const socket = new WebSocket(`ws://${window.location.host}/ws/`);

    // Connection opened
    socket.addEventListener('open', (evt) => {
        console.log('Connected');
        lc.style.display = 'inline-block';
        text.innerText = 'Connected';
        setTimeout(() => {
            if (!connectedMessageOverwritten) {
                text.innerText = '';
                lc.style.display = 'none';
            }
        }, 5e3);
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

function handleCaptionFrame(frame) {
    console.log(frame);
    if (frame.type == 'config') return updateConfig();
    if (frame.text == '') return;

    if (!connectedMessageOverwritten) text.innerText = "";
    connectedMessageOverwritten = true;
    clearTimeout(currentTimeout);
    lc.style.display = 'inline-block';

    // Sometimes the API sends duplicate isFinal frames
    if (frame.isFinal && lastFrameWasFinal) {
        return;
    } else {
        lastFrameWasFinal = false;
    }

    if (frame.device === currentDevice && currentSpan != undefined) {
        // If the device hasn't changed and an exist span is usable, just append to that
        if (!frame.isFinal) currentSpan.innerText = transcript + capitalize(frame.text);
    } else {
        // Otherwise create a new span with the correct color
        currentSpan = document.createElement('span');
        currentSpan.style.color = (device2 == 'null') ? '#ffffff' : deviceColor[frame.device - 1];
        text.appendChild(currentSpan);
        currentSpan.innerText = capitalize(frame.text) + ((frame.isFinal) ? '.\n' : '');
        // Clear the transcript
        transcript = '';
    }
    currentDevice = frame.device;

    if (frame.isFinal) {
        lastFrameWasFinal = true;

        // If the sentence is finished we can commit it to the transcript
        transcript += capitalize(frame.text) + '.\n'
        currentSpan.innerText = transcript

        currentTimeout = setTimeout(() => {
            text.innerHTML = '';
            transcript = '';
            lc.style.display = 'none';
            currentSpan = undefined;
        }, timeout);
    }
}


const observer = new MutationObserver((mutationList, observer) => {
    lc.scrollTop = lc.scrollHeight;
});
observer.observe(lc, { attributes: true, childList: true, subtree: true });

updateConfig();
connectToSocket();