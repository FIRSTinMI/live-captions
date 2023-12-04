document.addEventListener('DOMContentLoaded', function () {
    M.Tabs.init(document.querySelector('.tabs'), {});
});

fetch('/config')
    .then(res => res.json())
    .then(json => {
        document.getElementById('position').value = json.display.position;
        document.getElementById('align').value = json.display.align;
        document.getElementById('chromaKey').value = json.display.chromaKey;
        document.getElementById('size').value = json.display.size;
        document.getElementById('lines').value = json.display.lines;
        document.getElementById('timeout').value = json.display.timeout;
        document.getElementById('port').value = json.server.port;
        document.getElementById('samplerate').value = json.server.sampleRate;
        document.getElementById('google').value = JSON.stringify(json.google, null, 4);
        M.Forms.InitTextarea(document.querySelector('#google'));
        M.FormSelect.init(document.querySelectorAll('select'), {});
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
bindToInput('#samplerate', 'server.sampleRate');
bindToInput('#google', 'google');