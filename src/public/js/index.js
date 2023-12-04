const lc = document.getElementById('lc');
const text = document.getElementById('lc-text')

let timeout = 10e3;

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
    let connectedMessageOverwritten = false;
    let transcript = '';
    let currentTimeout;
    socket.addEventListener('message', (evt) => {
        let frame = JSON.parse(evt.data);
        console.log(frame);
        if (frame.type == 'config') return updateConfig();
        if (frame.text == '') return;

        connectedMessageOverwritten = true;
        clearTimeout(currentTimeout);
        lc.style.display = 'inline-block';
        text.innerText = transcript + capitalize(frame.text);
        if (frame.isFinal) {
            transcript += capitalize(frame.text) + '.\n'
            text.innerText = transcript;
            currentTimeout = setTimeout(() => {
                text.innerText = '';
                transcript = '';
                lc.style.display = 'none';
            }, timeout);
        }
    });
}


const observer = new MutationObserver((mutationList, observer) => {
    lc.scrollTop = lc.scrollHeight;
});
observer.observe(lc, { attributes: true, childList: true, subtree: true });

updateConfig();
connectToSocket();