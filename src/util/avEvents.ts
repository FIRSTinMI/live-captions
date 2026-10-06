import type { IncomingMessage, ServerResponse } from 'http';
import type { JSONConfig } from '../types/Config';
import type { PushStatus } from './youtubeCaptionPusher';
import {
    configBus, engineBus, micBus, watchdogBus, youtubeBus,
    EngineStatePayload, MicStatusPayload, WatchdogPayload, YouTubeChangeKind,
} from './eventBus';

/*
 * Optional Server-Sent Events channel at GET /api/events, used by the FIM AV
 * Assistant to react to changes instead of polling. The app works the same
 * with no client connected: the per-second mic listener, the ping timer and
 * every debounce timer only exist while at least one client is connected.
 * The only always-on cost is tracking the engine state, which changes rarely.
 *
 * Wire format: one `data: <json>\n\n` per message, no `event:` field, and a
 * `: ping\n\n` comment every 15 s.
 */

export const PROTOCOL_VERSION = 1;
export const PING_INTERVAL_MS = 15_000;
export const YOUTUBE_PUSH_THROTTLE_MS = 5_000;
export const HEARING_WINDOW_MS = 10_000;
export const HEARING_DEBOUNCE_MS = 3_000;
const CONFIG_DEBOUNCE_MS = 250;

export interface InputInfo {
    id: number;
    deviceName: string | null;
    speaker: string | null;
}

export interface InputState extends InputInfo {
    hearing: boolean;
}

export interface AvEventSources {
    version: string;
    getYouTubeStatus: () => PushStatus | null;
    getConfig: () => JSONConfig | null;
    /** Configured inputs, each with whether its level is above threshold right now. */
    getInputs: () => (InputInfo & { active: boolean })[];
    now?: () => number;
}

interface InputTrack {
    info: InputInfo;
    lastActive: number;
    reported: boolean;
    pendingSince: number | null;
}

type Client = { res: ServerResponse };

/** Strip secrets the settings page does not need to show. */
export function redactConfig(config: JSONConfig) {
    const { server, transformations, ...rest } = config;
    return {
        ...rest,
        server: {
            port: server.port,
            google: {
                projectId: server.google.projectId,
                clientEmail: server.google.credentials.client_email,
                hasPrivateKey: !!server.google.credentials.private_key,
            },
            cloud: {
                connected: !!server.cloud.deviceToken,
                deviceName: server.cloud.deviceName,
            },
        },
        transformations: transformations.map(t => ({ regex: t.regex.toString(), replacement: t.replacement })),
    };
}

function youtubeFields(s: PushStatus | null) {
    return s
        ? { enabled: s.enabled, url: s.url, running: s.running, lastPushAt: s.lastPushAt, lastError: s.lastError, queueDepth: s.queueDepth }
        : { enabled: false, url: null, running: false, lastPushAt: null, lastError: null, queueDepth: 0 };
}

export class AvEventHub {
    private src: AvEventSources;
    private clients = new Set<Client>();
    private engine: EngineStatePayload = { state: 'restarting', error: null };

    private pingTimer: NodeJS.Timeout | null = null;
    private youtubeTimer: NodeJS.Timeout | null = null;
    private configTimer: NodeJS.Timeout | null = null;
    private pendingConfig: JSONConfig | null = null;
    private lastYoutube: ReturnType<typeof youtubeFields> | null = null;
    private lastYoutubeSentAt = 0;
    private inputs = new Map<number, InputTrack>();

    private onEngine = (p: EngineStatePayload) => {
        if (p.state === this.engine.state && p.error === this.engine.error) return;
        this.engine = { state: p.state, error: p.error };
        this.broadcast({ type: 'engine', ...this.engine });
    };
    private onWatchdog = (p: WatchdogPayload) => {
        this.broadcast({ type: 'watchdog', action: p.action, reason: p.reason });
    };
    private onYoutube = (kind: YouTubeChangeKind) => this.youtubeChanged(kind);
    private onConfig = (config: JSONConfig) => {
        this.pendingConfig = config;
        if (this.configTimer) return;
        this.configTimer = setTimeout(() => {
            this.configTimer = null;
            const c = this.pendingConfig;
            this.pendingConfig = null;
            if (c) this.broadcast({ type: 'config', config: redactConfig(c) });
            // The input list or names may have changed with the config.
            this.syncInputList(true);
        }, CONFIG_DEBOUNCE_MS);
    };
    private onMic = (_p: MicStatusPayload) => this.tickInputs();

    constructor(src: AvEventSources) {
        this.src = src;
        // Engine state must be right in the hello even if nobody was listening
        // when it changed. It changes a few times per restart, so this is free.
        engineBus.on('state', this.onEngine);
    }

    get clientCount() {
        return this.clients.size;
    }

    get engineState(): EngineStatePayload {
        return { ...this.engine };
    }

    private now() {
        return this.src.now ? this.src.now() : Date.now();
    }

    /** Express/Node handler for GET /api/events. */
    handle = (req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        req.socket?.setNoDelay?.(true);
        req.socket?.setTimeout?.(0);

        const client: Client = { res };
        if (this.clients.size === 0) this.attach();
        // Bring the input list up to date first so existing clients hear about
        // any change before the new client gets it inside its hello.
        this.syncInputList(true);
        this.clients.add(client);
        this.send(client, this.hello());

        const drop = () => {
            if (!this.clients.delete(client)) return;
            if (this.clients.size === 0) this.detach();
        };
        req.on('close', drop);
        res.on('close', drop);
        res.on('error', drop);
    };

    /** Close every stream (used by tests and shutdown). */
    closeAll() {
        for (const c of [...this.clients]) {
            try { c.res.end(); } catch { /* ignore */ }
        }
        this.clients.clear();
        this.detach();
    }

    hello() {
        const config = this.src.getConfig();
        return {
            type: 'hello',
            addon: 'live-captions',
            protocol: PROTOCOL_VERSION,
            version: this.src.version,
            youtube: youtubeFields(this.src.getYouTubeStatus()),
            engine: { ...this.engine },
            inputs: this.inputList(),
            config: config ? redactConfig(config) : null,
        };
    }

    private attach() {
        youtubeBus.on('change', this.onYoutube);
        watchdogBus.on('fired', this.onWatchdog);
        configBus.on('saved', this.onConfig);
        micBus.on('status', this.onMic);
        this.lastYoutube = youtubeFields(this.src.getYouTubeStatus());
        this.lastYoutubeSentAt = this.now();
        this.inputs.clear();
        this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    }

    private detach() {
        youtubeBus.off('change', this.onYoutube);
        watchdogBus.off('fired', this.onWatchdog);
        configBus.off('saved', this.onConfig);
        micBus.off('status', this.onMic);
        for (const t of [this.pingTimer, this.youtubeTimer, this.configTimer]) {
            if (t) clearTimeout(t);
        }
        this.pingTimer = this.youtubeTimer = this.configTimer = null;
        this.pendingConfig = null;
        this.lastYoutube = null;
        this.inputs.clear();
    }

    private ping() {
        for (const c of this.clients) this.write(c, ': ping\n\n');
    }

    private write(c: Client, chunk: string) {
        try {
            c.res.write(chunk);
        } catch {
            this.clients.delete(c);
            if (this.clients.size === 0) this.detach();
        }
    }

    private send(c: Client, msg: object) {
        this.write(c, `data: ${JSON.stringify(msg)}\n\n`);
    }

    private broadcast(msg: object) {
        if (this.clients.size === 0) return;
        const chunk = `data: ${JSON.stringify(msg)}\n\n`;
        for (const c of [...this.clients]) this.write(c, chunk);
    }

    // ---- youtube ----

    private youtubeChanged(kind: YouTubeChangeKind) {
        const cur = youtubeFields(this.src.getYouTubeStatus());
        const prev = this.lastYoutube;
        const important = kind === 'error' || !prev
            || cur.enabled !== prev.enabled || cur.url !== prev.url
            || cur.running !== prev.running || cur.lastError !== prev.lastError;
        if (important) {
            this.sendYoutube(cur);
            return;
        }
        if (cur.lastPushAt === prev.lastPushAt) return;
        // Only lastPushAt/queueDepth moved: at most one message per 5 s.
        const wait = this.lastYoutubeSentAt + YOUTUBE_PUSH_THROTTLE_MS - this.now();
        if (wait <= 0) {
            this.sendYoutube(cur);
        } else if (!this.youtubeTimer) {
            this.youtubeTimer = setTimeout(() => {
                this.youtubeTimer = null;
                const latest = youtubeFields(this.src.getYouTubeStatus());
                if (this.lastYoutube && latest.lastPushAt !== this.lastYoutube.lastPushAt) this.sendYoutube(latest);
            }, wait);
        }
    }

    private sendYoutube(cur: ReturnType<typeof youtubeFields>) {
        if (this.youtubeTimer) {
            clearTimeout(this.youtubeTimer);
            this.youtubeTimer = null;
        }
        this.lastYoutube = cur;
        this.lastYoutubeSentAt = this.now();
        this.broadcast({ type: 'youtube', ...cur });
    }

    // ---- inputs ----

    private inputList(): InputState[] {
        return [...this.inputs.values()].map(t => ({ ...t.info, hearing: t.reported }));
    }

    /**
     * Rebuild the tracked list from the configured inputs. Returns true and
     * (when emit is set) sends `inputs` if an input was added, removed or renamed.
     */
    private syncInputList(emit: boolean): boolean {
        const now = this.now();
        const live = this.src.getInputs();
        let changed = live.length !== this.inputs.size;
        const next = new Map<number, InputTrack>();
        for (const i of live) {
            const info: InputInfo = { id: i.id, deviceName: i.deviceName, speaker: i.speaker };
            const old = this.inputs.get(i.id);
            if (old) {
                if (old.info.deviceName !== info.deviceName || old.info.speaker !== info.speaker) changed = true;
                old.info = info;
                if (i.active) old.lastActive = now;
                next.set(i.id, old);
            } else {
                changed = true;
                next.set(i.id, { info, lastActive: i.active ? now : 0, reported: i.active, pendingSince: null });
            }
        }
        this.inputs = next;
        if (changed && emit && this.clients.size > 0) this.broadcast({ type: 'inputs', inputs: this.inputList() });
        return changed;
    }

    /** Runs on each micBus status tick (1 Hz) while a client is connected. */
    tickInputs() {
        const listChanged = this.syncInputList(false);
        const now = this.now();
        let flipped = false;
        for (const t of this.inputs.values()) {
            const raw = t.lastActive > 0 && now - t.lastActive < HEARING_WINDOW_MS;
            if (raw === t.reported) {
                t.pendingSince = null;
                continue;
            }
            if (t.pendingSince === null) t.pendingSince = now;
            if (now - t.pendingSince >= HEARING_DEBOUNCE_MS) {
                t.reported = raw;
                t.pendingSince = null;
                flipped = true;
            }
        }
        if (flipped || listChanged) this.broadcast({ type: 'inputs', inputs: this.inputList() });
    }
}
