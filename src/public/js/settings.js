document.addEventListener('DOMContentLoaded', function () {
    M.Tabs.init(document.querySelector('.tabs'), {});
});

fetch('/config')
    .then(res => res.json())
    .then(json => {
        fetch('/devices')
            .then(res => res.json())
            .then(devices => {
                for (let device of devices) {
                    let e = document.createElement('option');
                    e.innerText = device;
                    e.value = device.substr(0, 31);
                    document.getElementById('device1').appendChild(e)
                }
                if (devices.length > 1) {
                    for (let device of devices) {
                        let e = document.createElement('option');
                        e.innerText = device;
                        e.value = device.substr(0, 31);
                        document.getElementById('device2').appendChild(e)
                    }
                }
                document.getElementById('position').value = json.display.position;
                document.getElementById('align').value = json.display.align;
                document.getElementById('chromaKey').value = json.display.chromaKey;
                document.getElementById('size').value = json.display.size;
                document.getElementById('lines').value = json.display.lines;
                document.getElementById('timeout').value = json.display.timeout;
                document.getElementById('port').value = json.server.port;
                document.getElementById('device1_samplerate').value = json.server.device1_sampleRate;
                document.getElementById('device1').value = json.server.device1;
                document.getElementById('device1_color').value = json.server.device1_color;
                document.getElementById('device2_samplerate').value = json.server.device2_sampleRate;
                document.getElementById('device2').value = json.server.device2;
                document.getElementById('device2_color').value = json.server.device2_color;
                document.getElementById('google').value = JSON.stringify(json.google, null, 4);
                document.getElementById('filter').value = json.server.filter.join('\n');
                M.Forms.InitTextarea(document.querySelector('#google'));
                M.Forms.InitTextarea(document.querySelector('#filter'));
                M.FormSelect.init(document.querySelectorAll('select'), {});
            });
    });

function bindToInput(query, setting) {
    let elm = document.querySelector(query);
    elm.addEventListener('change', (evt) => {
        fetch(`/config/${encodeURIComponent(setting)}?value=${encodeURIComponent(elm.value)}`, { method: 'POST' });
    });
}

bindToInput('#position', 'display.position');
bindToInput('#align', 'display.align');
bindToInput('#chromaKey', 'display.chromaKey');
bindToInput('#size', 'display.size');
bindToInput('#lines', 'display.lines');
bindToInput('#timeout', 'display.timeout');
bindToInput('#port', 'server.port');
bindToInput('#device1_samplerate', 'server.device1_sampleRate');
bindToInput('#device1', 'server.device1');
bindToInput('#device1_color', 'server.device1_color');
bindToInput('#device2_samplerate', 'server.device2_sampleRate');
bindToInput('#device2', 'server.device2');
bindToInput('#device2_color', 'server.device2_color');
bindToInput('#google', 'google');
bindToInput('#filter', 'server.filter');

for (let btn of document.querySelectorAll('.apply-btn')) {
    btn.addEventListener('click', () => {
        fetch('/restart', { method: 'POST' });
    });
}