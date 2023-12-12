let totalDevices = 0;
let physicalDevices = [];
const alternatingColors = ["#42A5F5", "#EF5350"];

document.addEventListener('DOMContentLoaded', function () {
    M.Tabs.init(document.querySelector('.tabs'), {});
});

function bindToInput(query, setting) {
    let elm = document.querySelector(query);
    elm.addEventListener('change', (evt) => {
        fetch(`/config/${encodeURIComponent(setting)}?value=${encodeURIComponent(elm.value)}`, { method: 'POST' });
    });
}


fetch('/config')
    .then(res => res.json())
    .then(json => {
        // Update settings values
        document.getElementById('display-position').value = json.display.position;
        document.getElementById('align').value = json.display.align;
        document.getElementById('chromaKey').value = json.display.chromaKey;
        document.getElementById('size').value = json.display.size;
        document.getElementById('lines').value = json.display.lines;
        document.getElementById('timeout').value = json.display.timeout;
        document.getElementById('port').value = json.server.port;
        document.getElementById('google').value = JSON.stringify(json.google, null, 4);
        document.getElementById('filter').value = json.server.filter.join('\n');
        M.Forms.InitTextarea(document.querySelector('#google'));
        M.Forms.InitTextarea(document.querySelector('#filter'));

        // Fetch devices, add rows and populate dropdown
        fetch('/devices')
            .then(res => res.json())
            .then(devices => {
                physicalDevices = devices
                // Iterate over devices and create rows
                if (!json.server.devices) json.server.devices = [];
                json.server.devices.forEach((device, index) => {
                    addRow(device, index);
                });
            });
    });

bindToInput('#display-position', 'display.position');
bindToInput('#align', 'display.align');
bindToInput('#chromaKey', 'display.chromaKey');
bindToInput('#size', 'display.size');
bindToInput('#lines', 'display.lines');
bindToInput('#timeout', 'display.timeout');
bindToInput('#port', 'server.port');
bindToInput('#google', 'google');
bindToInput('#filter', 'server.filter');

for (let btn of document.querySelectorAll('.apply-btn')) {

    btn.addEventListener('click', () => {
        // Find device list
        const toSave = $("#transcription").find('[data-role="device-row"]').map((index, row) => {
            return {
                // Get values
                id: $(row).find('[data-role="id"]').val(),
                color: $(row).find('[data-role="color"]').val(),
                channel: parseInt($(row).find('[data-role="channel"]').val()),
                name: $(row).find('[data-role="name"]').val()
            }
        });

        fetch('/config/devices', {
            method: 'POST',
            body: JSON.stringify(toSave.toArray()),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(() => {
            fetch('/restart', { method: 'POST' }).then(() => {
                alert('Settings saved, restarting server.')
            });
        });
    });
}