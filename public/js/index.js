
const lc = document.getElementById('lc');
const text = document.getElementById('lc-text')

// Open connection
const socket = new WebSocket("ws://localhost:3000/ws/");

// Connection opened
socket.addEventListener("open", (event) => {
    socket.send("Connected");
});

// Listen for messages
socket.addEventListener("message", (evt) => {
    lc.style.display = 'inline-block';
    text.innerText = evt.data;
    setTimeout(() => {
        text.innerText = '';
        lc.style.display = 'none';
    }, 10e3); // TODO: set timeout parameter
});

const observer = new MutationObserver((mutationList, observer) => {
    lc.scrollTop = lc.scrollHeight;
});
observer.observe(text, { attributes: true, childList: true, subtree: true });

const searchParams = new URLSearchParams(window.location.href.split('?')[1]);
if (searchParams.has('position')) {
    if (searchParams.get('position') == 1) document.getElementById('lc').style.top = '0';
}
if (searchParams.has('lines')) {
    document.getElementById('lc').style.maxHeight = (searchParams.get('lines') * 1.4) + 'em';
}
