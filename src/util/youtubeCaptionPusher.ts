import { ConfigManager } from './configManager';
import { captionBus } from './eventBus';
import { Frame } from '../types/Frame';

const FLUSH_INTERVAL_MS = 500;
const MAX_QUEUE_DEPTH = 500;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

interface QueuedCue {
    timestamp: number;
    text: string;
}

export interface PushStatus {
    enabled: boolean;
    url: string | null;
    running: boolean;
    lastPushAt: number | null;
    queueDepth: number;
    lastError: string | null;
}

function buildSeqUrl(rawUrl: string, seq: number): string {
    try {
        const u = new URL(rawUrl);
        u.searchParams.delete('seq');
        u.searchParams.set('seq', String(seq));
        return u.toString();
    } catch {
        const sep = rawUrl.includes('?') ? '&' : '?';
        return `${rawUrl.replace(/([?&])seq=[^&]*&?/, '$1').replace(/[?&]$/, '')}${sep}seq=${seq}`;
    }
}

export class YouTubeCaptionPusher {
    private config: ConfigManager;
    private queue: QueuedCue[] = [];
    private lastTimestamp = 0;
    private flushTimer: NodeJS.Timeout | null = null;
    private inFlight = false;
    private consecutiveFailures = 0;
    private nextAllowedFlush = 0;
    private lastPushAt: number | null = null;
    private lastError: string | null = null;
    private seq = 0;
    private captionHandler: (frame: Frame) => void;

    constructor(config: ConfigManager) {
        this.config = config;
        this.captionHandler = (frame: Frame) => {
            if (!frame.isFinal) return;
            const text = frame.text.trim();
            if (!text) return;
            const now = Date.now();
            const ts = Math.max(now, this.lastTimestamp + 1);
            this.lastTimestamp = ts;
            this.queue.push({ timestamp: ts, text });
            if (this.queue.length > MAX_QUEUE_DEPTH) {
                this.queue.splice(0, this.queue.length - MAX_QUEUE_DEPTH);
            }
        };
        this.reconcile();
    }

    public reconcile() {
        const { enabled, url } = this.config.youtubeCaptions;
        const shouldRun = enabled && !!url;
        if (shouldRun && !this.flushTimer) {
            this.start();
        } else if (!shouldRun && this.flushTimer) {
            this.stop();
        }
    }

    public getStatus(): PushStatus {
        return {
            enabled: this.config.youtubeCaptions.enabled,
            url: this.config.youtubeCaptions.url,
            running: this.flushTimer !== null,
            lastPushAt: this.lastPushAt,
            queueDepth: this.queue.length,
            lastError: this.lastError,
        };
    }

    private start() {
        this.seq = 0;
        captionBus.on('frame', this.captionHandler);
        this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
        console.log('[youtubeCaptions] pusher started');
    }

    private stop() {
        captionBus.off('frame', this.captionHandler);
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        console.log('[youtubeCaptions] pusher stopped');
    }

    public resetSequence() {
        this.seq = 0;
    }

    private async flush() {
        if (this.inFlight) return;
        if (this.queue.length === 0) return;
        if (Date.now() < this.nextAllowedFlush) return;
        const url = this.config.youtubeCaptions.url;
        if (!url) return;

        const batch = this.queue.splice(0, this.queue.length);
        const body = batch.map(c => {
            const ts = new Date(c.timestamp).toISOString().replace(/Z$/, '');
            return `${ts}\n${c.text}`;
        }).join('\n') + '\n';

        const seqUrl = buildSeqUrl(url, this.seq);

        this.inFlight = true;
        try {
            const res = await fetch(seqUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body,
            });
            if (!res.ok) {
                const respText = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText}${respText ? ` — ${respText.slice(0, 200)}` : ''}`);
            }
            this.lastPushAt = Date.now();
            this.lastError = null;
            this.consecutiveFailures = 0;
            this.nextAllowedFlush = 0;
            this.seq++;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.lastError = message;
            this.consecutiveFailures++;
            // Requeue at the front so retries don't drop cues
            this.queue.unshift(...batch);
            if (this.queue.length > MAX_QUEUE_DEPTH) {
                this.queue.splice(0, this.queue.length - MAX_QUEUE_DEPTH);
            }
            const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1), BACKOFF_MAX_MS);
            this.nextAllowedFlush = Date.now() + backoff;
            console.warn(`[youtubeCaptions] push failed (${message}); retry in ${backoff}ms`);
        } finally {
            this.inFlight = false;
        }
    }
}
