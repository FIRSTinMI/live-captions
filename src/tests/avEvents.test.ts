import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { AvEventHub } from '../util/avEvents';
import { configBus, engineBus, micBus, watchdogBus, youtubeBus } from '../util/eventBus';
import type { PushStatus } from '../util/youtubeCaptionPusher';

type Msg = Record<string, any>;

let clock = 1_000_000;
let yt: PushStatus;
let inputs: { id: number; deviceName: string | null; speaker: string | null; active: boolean }[];
let hub: AvEventHub;
let http: HttpServer;
let base: string;

async function connect() {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const raw: string[] = [];
    const messages: Msg[] = [];
    (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    raw.push(chunk);
                    if (chunk.startsWith('data: ')) messages.push(JSON.parse(chunk.slice(6)));
                }
            }
        } catch { /* aborted */ }
    })();
    const waitFor = async (pred: (m: Msg) => boolean, ms = 1000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            const m = messages.find(pred);
            if (m) return m;
            await new Promise(r => setTimeout(r, 10));
        }
        throw new Error('timed out; got ' + JSON.stringify(messages));
    };
    return { res, messages, raw, waitFor, close: () => ctrl.abort() };
}

const settle = (ms = 50) => new Promise(r => setTimeout(r, ms));

beforeEach(async () => {
    clock = 1_000_000;
    yt = { enabled: true, url: 'https://example.test/cc', running: true, lastPushAt: null, queueDepth: 0, lastError: null };
    inputs = [{ id: 1, deviceName: 'Mic A', speaker: 'Host', active: false }];
    hub = new AvEventHub({
        version: '9.9.9',
        getYouTubeStatus: () => ({ ...yt }),
        getConfig: () => null,
        getInputs: () => inputs.map(i => ({ ...i })),
        now: () => clock,
    });
    engineBus.emit('state', { state: 'running', error: null });
    http = createServer((req, res) => {
        if (req.url === '/api/events') return hub.handle(req, res);
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>(r => http.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
    hub.closeAll();
    engineBus.removeAllListeners();
    await new Promise(r => http.close(r));
});

describe('/api/events', () => {
    it('sends hello with full state first', async () => {
        const c = await connect();
        expect(c.res.headers.get('content-type')).toBe('text/event-stream');
        const hello = await c.waitFor(m => m.type === 'hello');
        expect(c.messages[0]).toBe(hello);
        expect(hello).toMatchObject({
            addon: 'live-captions',
            protocol: 1,
            version: '9.9.9',
            youtube: { enabled: true, url: 'https://example.test/cc', running: true, lastPushAt: null, lastError: null, queueDepth: 0 },
            engine: { state: 'running', error: null },
            inputs: [{ id: 1, deviceName: 'Mic A', speaker: 'Host', hearing: false }],
        });
        c.close();
    });

    it('relays engine and watchdog events', async () => {
        const c = await connect();
        await c.waitFor(m => m.type === 'hello');
        engineBus.emit('state', { state: 'error', error: 'boom' });
        engineBus.emit('state', { state: 'error', error: 'boom' }); // duplicate, no message
        watchdogBus.emit('fired', { action: 'reload', reason: 'stuck' });
        expect(await c.waitFor(m => m.type === 'engine')).toEqual({ type: 'engine', state: 'error', error: 'boom' });
        expect(await c.waitFor(m => m.type === 'watchdog')).toEqual({ type: 'watchdog', action: 'reload', reason: 'stuck' });
        await settle();
        expect(c.messages.filter(m => m.type === 'engine').length).toBe(1);
        c.close();
    });

    it('youtube: errors and recovery at once, push times throttled', async () => {
        const c = await connect();
        await c.waitFor(m => m.type === 'hello');

        yt.lastError = 'HTTP 500'; yt.queueDepth = 3;
        youtubeBus.emit('change', 'error');
        youtubeBus.emit('change', 'error'); // every new error is sent
        await settle();
        expect(c.messages.filter(m => m.type === 'youtube' && m.lastError === 'HTTP 500').length).toBe(2);

        yt.lastError = null; yt.lastPushAt = clock; yt.queueDepth = 0;
        youtubeBus.emit('change', 'success');
        await c.waitFor(m => m.type === 'youtube' && m.lastError === null);

        // Plain success with no other change inside 5 s: held back.
        const before = c.messages.length;
        clock += 1000; yt.lastPushAt = clock;
        youtubeBus.emit('change', 'success');
        await settle();
        expect(c.messages.length).toBe(before);

        // State change with no field difference sends nothing.
        youtubeBus.emit('change', 'state');
        await settle();
        expect(c.messages.length).toBe(before);

        // URL change goes out at once.
        yt.url = 'https://example.test/other';
        youtubeBus.emit('change', 'state');
        expect((await c.waitFor(m => m.type === 'youtube' && m.url === 'https://example.test/other')).lastPushAt).toBe(clock);
        c.close();
    });

    it('inputs: hearing flips only after 3 s and holds for 10 s', async () => {
        const c = await connect();
        await c.waitFor(m => m.type === 'hello');
        const tick = () => micBus.emit('status', { devices: [] });

        inputs[0].active = true;
        tick();
        clock += 2000; tick();
        await settle();
        expect(c.messages.some(m => m.type === 'inputs')).toBe(false);
        clock += 1000; tick();
        expect((await c.waitFor(m => m.type === 'inputs')).inputs).toEqual([{ id: 1, deviceName: 'Mic A', speaker: 'Host', hearing: true }]);

        inputs[0].active = false;
        const last = clock;
        for (clock = last + 1000; clock < last + 12_000; clock += 1000) tick();
        await settle();
        expect(c.messages.filter(m => m.type === 'inputs').length).toBe(1);
        clock = last + 13_000; tick();
        await c.waitFor(m => m.type === 'inputs' && m.inputs[0].hearing === false);
        c.close();
    });

    it('config saves are sent without secrets', async () => {
        const c = await connect();
        await c.waitFor(m => m.type === 'hello');
        configBus.emit('saved', {
            display: { position: 0, size: 42, lines: 2, chromaKey: 'x', timeout: 5, align: 'left', hidden: false },
            server: {
                port: 3000,
                google: { projectId: 'p', scopes: 's', credentials: { client_email: 'e@x', private_key: 'SECRET' } },
                cloud: { deviceToken: 'TOKEN', deviceName: 'Field 1' },
            },
            transcription: { filter: [], streamingTimeout: 1, inputs: [], phraseSets: [], engine: 'googlev2', watchdogEnabled: true },
            transformations: [{ regex: /a/g, replacement: 'b' }],
            youtubeCaptions: { url: null, enabled: false },
        });
        const m = await c.waitFor(m => m.type === 'config');
        const text = JSON.stringify(m);
        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('TOKEN');
        expect(m.config.server.cloud).toEqual({ connected: true, deviceName: 'Field 1' });
        c.close();
    });

    it('pings, and costs nothing with no clients', async () => {
        const c = await connect();
        await c.waitFor(m => m.type === 'hello');
        expect(micBus.listenerCount('status')).toBe(1);
        (hub as any).ping();
        const end = Date.now() + 1000;
        while (!c.raw.includes(': ping') && Date.now() < end) await settle(10);
        expect(c.raw).toContain(': ping');

        const second = await connect();
        await second.waitFor(m => m.type === 'hello');
        expect(hub.clientCount).toBe(2);
        c.close();
        second.close();
        const end2 = Date.now() + 1000;
        while (hub.clientCount > 0 && Date.now() < end2) await settle(10);
        expect(hub.clientCount).toBe(0);
        for (const bus of [micBus, youtubeBus, watchdogBus, configBus]) {
            expect(bus.listenerCount(bus === micBus ? 'status' : bus === youtubeBus ? 'change' : bus === watchdogBus ? 'fired' : 'saved')).toBe(0);
        }
        expect((hub as any).pingTimer).toBeNull();
    });
});
