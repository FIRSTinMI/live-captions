let physicalDevices = [];
let config = {};
const defaultColors = ["#42A5F5", "#EF5350", "#FFC107", "#D500F9", "#8BC34A", "#FFFFFF"];

document.addEventListener('DOMContentLoaded', function () {
    M.Tabs.init(document.querySelector('.tabs'), {});
});

const configPromise = fetch('/config')
    .then(res => res.json())
    .then(json => {
        config = json;
        // Update settings values
        document.getElementById('display-position').value = json.display.position;
        document.getElementById('display-align').value = json.display.align;
        document.getElementById('display-chromaKey').value = json.display.chromaKey;
        document.getElementById('display-size').value = json.display.size;
        document.getElementById('display-lines').value = json.display.lines;
        document.getElementById('display-timeout').value = json.display.timeout;
        document.getElementById('server-port').value = json.server.port;
        document.getElementById('server-google').value = JSON.stringify(json.server.google, null, 4);
        document.getElementById('transcription-filter').value = json.transcription.filter.join('\n');

        M.FormSelect.init(document.forms[0].querySelectorAll('select'), {});
        document.querySelectorAll('textarea').forEach(M.Forms.textareaAutoResize);
    });

// Fetch devices, add rows and populate dropdown
fetch('/devices')
    .then(res => res.json())
    .then(async devices => {
        physicalDevices = devices
        // Iterate over devices and create rows
        await configPromise;
        for (let device of config.transcription.inputs) {
            addRow(device);
        }
    });

// This handles sending all settings except devices
function bindToInput(elm) {
    elm.addEventListener('change', (evt) => {
        const setting = encodeURIComponent(elm.id.replace('-', '.'));
        let body;
        if (elm.id === 'transcription-filter') {
            body = JSON.stringify(elm.value.split('\n'));
        } else if (elm.type === 'textarea') {
            body = elm.value;
        } else {
            return fetch(`/config/${setting}${(body) ? '' : `?value=${encodeURIComponent(elm.value)}`}`, { method: 'POST' });
        }

        fetch(`/config/${setting}${(body) ? '' : `?value=${encodeURIComponent(elm.value)}`}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: body
            });
    });
}

for (let elm of document.querySelectorAll('input, select, textarea')) {
    if (elm.hasAttribute('data-role')) continue; // Skip any elms relating to devices
    bindToInput(elm);
}

const container = document.getElementById('devices-container');

function addRow(device = null) {
    const index = container.childElementCount;
    if (device === null) {
        device = {
            id: '',
            speaker: '',
            color: defaultColors[(index >= defaultColors.length) ? defaultColors.length - 1 : index],
            channel: 0,
            threshold: 10
        };
    }

    // Find template row
    const row = document.querySelector('[data-role="template"]').cloneNode(true);
    row.setAttribute('data-role', 'device-row');
    row.setAttribute('data-index', index);

    // Update IDs and set values
    row.querySelector('#template-name').value = device.speaker;
    row.querySelector('#template-name').setAttribute('id', `device-${index}-name`);
    row.querySelector('[for="template-name"]').setAttribute('for', `device-${index}-name`);

    row.querySelector('#template-device').addEventListener('change', () => requestVolumeForDevice(index));
    row.querySelector('#template-device').setAttribute('id', `device-${index}-id`);
    row.querySelector('[for="template-device"]').setAttribute('for', `device-${index}-id`);

    row.querySelector('#template-color').value = device.color;
    applyColorToInput(row.querySelector('#template-color'));
    row.querySelector('#template-color').addEventListener('keyup', (evt) => applyColorToInput(evt.target));
    row.querySelector('#template-color').setAttribute('id', `device-${index}-color`)
    row.querySelector('[for="template-color"]').setAttribute('for', `device-${index}-color`);

    row.querySelector('#template-channel').value = device.channel;
    row.querySelector('#template-channel').addEventListener('change', () => requestVolumeForChannel(index));
    row.querySelector('#template-channel').setAttribute('id', `device-${index}-channel`);
    row.querySelector('[for="template-channel"]').setAttribute('for', `device-${index}-channel`);

    row.querySelector('#template-threshold').value = device.threshold;
    row.querySelector('#template-threshold').setAttribute('id', `device-${index}-threshold`);

    row.querySelector('[data-role="volume"]').setAttribute('id', `device-${index}-volume`);

    // Add options to dropdown
    const dropdown = row.querySelector('[data-role="id"]');
    for (let physicalDevice of physicalDevices) {
        const option = document.createElement('option');
        option.value = physicalDevice.id;
        option.innerText = physicalDevice.name;
        dropdown.appendChild(option);
    }
    dropdown.value = device.device;

    // Append row to table
    container.appendChild(row);
    M.FormSelect.init(dropdown, {});
    row.removeAttribute('style');

    // Add listener to remove button
    row.querySelector('[data-action="remove"]').addEventListener('click', () => container.removeChild(row));
}

function applyColorToInput(elm) {
    if (elm.value.match(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)) {
        return elm.style.color = elm.value;
    }
    elm.style.color = '#FFFFFF';
}

function requestVolumeForDevice(index) {
    const device = parseInt(document.getElementById(`device-${index}-id`).value);
    const channel = parseInt(document.getElementById(`device-${index}-channel`).value);
    socket.send(JSON.stringify({ type: 'volumeRequest', device, channel, index }));
}

function addRowUi() {
    addRow();
}

for (let btn of document.querySelectorAll('.apply-btn')) {
    btn.addEventListener('click', () => {
        const toSave = []
        for (let row of document.getElementById('devices-container').children) {
            toSave.push({
                // Get values
                id: toSave.length,
                device: parseInt(row.querySelector('select').value),
                speaker: row.querySelector('[data-role="name"]').value,
                channel: parseInt(row.querySelector('[data-role="channel"]').value),
                color: row.querySelector('[data-role="color"]').value,
                driver: 7,
                threshold: parseInt(row.querySelector('[data-role="threshold"]').value)
            });
        }

        fetch('/config/transcription.inputs', {
            method: 'POST',
            body: JSON.stringify(toSave),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(() => {
            fetch('/restart', { method: 'POST' }).then(() => {
                setTimeout(() => connectToSocket(), 500);
                alert('Settings saved, restarting server.')
            });
        });
    });
}

let socket;

function connectToSocket() {
    // Open connection
    socket = new WebSocket(`ws://${window.location.host}/ws/`);

    // Connection opened
    socket.addEventListener('open', (evt) => {
        console.log('Connected');
        socket.send('settings');
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
    socket.addEventListener('message', (evt) => {
        const json = JSON.parse(evt.data);
        if (json.type === 'volumes') {
            for (let device of json.devices) {
                const elm = document.getElementById(`device-${device.id}-volume`);
                if (elm) {
                    elm.children[0].style.width = `${device.volume / 20}%`;
                    if (device.volume / 20 > parseInt(document.getElementById(`device-${device.id}-threshold`).value)) {
                        elm.children[0].style.backgroundColor = '#4CAF50';
                    } else {
                        elm.children[0].style.backgroundColor = '';
                    }
                }
            }
        }
    });
}

document.getElementById('transcription-tab').addEventListener('click', () => connectToSocket());