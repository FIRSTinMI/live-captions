document.addEventListener('DOMContentLoaded', function () {
    M.FormSelect.init(document.querySelectorAll('select'), {});
    M.Tabs.init(document.querySelector('.tabs'), {});
});

fetch('/config')
    .then(res => res.json())
    .then(json => {
        document.getElementById('position').value = json.display.position;
        document.getElementById('align').value = json.display.align;
        document.getElementById('size').value = json.display.size;
        document.getElementById('lines').value = json.display.lines;
        document.getElementById('timeout').value = json.display.timeout;
    });

function bindToInput(query, setting) {
    let elm = document.querySelector(query);
    elm.addEventListener('change', (evt) => {
        fetch(`/config/${encodeURIComponent(setting)}?value=${encodeURIComponent(elm.value)}`, { method: 'POST' });
    });
}

bindToInput('#position', 'display.position');
bindToInput('#align', 'display.align');
bindToInput('#size', 'display.size');
bindToInput('#lines', 'display.lines');
bindToInput('#timeout', 'display.timeout');