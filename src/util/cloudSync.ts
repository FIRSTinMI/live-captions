import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../cloud-server/src/trpc/router';
import { ConfigManager } from './configManager';
import { Speech } from '../speech';
import { GoogleV1 } from '../engines/GoogleV1';
import { GoogleV2 } from '../engines/GoogleV2';
import { April } from '../engines/April';
import { CLOUD_SERVER_URL } from './cloudConfig';
import { displayCtrlBus, captionBus, errorBus } from '../util/eventBus';
import type { Frame } from '../types/Frame';
import color from 'colorts';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RELAY_VOLUME_INTERVAL_MS = 500; // 500ms
const RELAY_RECONNECT_DELAY_MS = 5000; // 5s

interface QueuedError {
    message: string;
    context?: Record<string, unknown>;
    occurredAt: string;
}

export class CloudSync {
    private config: ConfigManager;
    private getSpeechServices: () => Speech<GoogleV1 | GoogleV2 | April>[];
    private getPhysicalDevices: () => Array<{ id: number; name: string; inputChannels: number }>;
    private restart: () => void;
    private heartbeatTimer?: NodeJS.Timeout;
    private errorQueue: QueuedError[] = [];
    private client: ReturnType<typeof createTRPCClient<AppRouter>>;

    // Relay WebSocket state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private relayWs: any = null;
    private relayReconnectTimer: NodeJS.Timeout | null = null;
    private volumeInterval: NodeJS.Timeout | null = null;
    private relayConnected = false;
    private captionHandler: ((frame: Frame) => void) | null = null;
    private errorHandler: ((payload: { message: string; context?: Record<string, unknown> }) => void) | null = null;

    constructor(
        config: ConfigManager,
        getSpeechServices: () => Speech<GoogleV1 | GoogleV2 | April>[],
        getPhysicalDevices: () => Array<{ id: number; name: string; inputChannels: number }> = () => [],
        restart: () => void = () => {},
    ) {
        this.config = config;
        this.getSpeechServices = getSpeechServices;
        this.getPhysicalDevices = getPhysicalDevices;
        this.restart = restart;
        this.client = createTRPCClient<AppRouter>({
            links: [
                httpBatchLink({
                    url: `${CLOUD_SERVER_URL}/trpc`,
                    headers: () => {
                        const token = this.config.server.cloud.deviceToken;
                        return token ? { Authorization: `Bearer ${token}` } : {};
                    },
                }),
            ],
        });
    }

    public queueError(message: string, context?: Record<string, unknown>) {
        this.errorQueue.push({ message, context, occurredAt: new Date().toISOString() });
        if (this.errorQueue.length > 50) this.errorQueue.shift();
    }

    public pushConfig() {
        this.relaySend({ type: 'config', config: this.config.get() });
    }

    public async connect(pin: string): Promise<{ deviceName: string }> {
        const result = await this.client.device.auth.mutate({ pin });
        this.config.server.cloud.deviceToken = result.token;
        this.config.server.cloud.deviceName = result.deviceName;
        this.config.save();
        await this.syncConfig();
        this.startHeartbeat();
        this.connectRelay();
        this.subscribeErrors();
        return { deviceName: result.deviceName };
    }

    public stopConnections() {
        this.stopHeartbeat();
        this.disconnectRelay();
        this.unsubscribeErrors();
    }

    public disconnect() {
        this.stopHeartbeat();
        this.disconnectRelay();
        this.unsubscribeErrors();
        this.config.server.cloud.deviceToken = null;
        this.config.server.cloud.deviceName = null;
        this.config.save();
    }

    public async initialize() {
        if (!this.config.server.cloud.deviceToken) return;
        try {
            await this.syncConfig();
            this.startHeartbeat();
            this.connectRelay();
            this.subscribeErrors();
            console.log(color('Cloud sync initialized').green.toString());
        } catch (err: any) {
            console.error(color('Cloud sync init failed:').red.toString(), err);
            // Device was removed from the server - stale token, clear it so the UI
            // shows the PIN input instead of falsely showing "connected"
            if (err?.data?.code === 'UNAUTHORIZED' || err?.shape?.message === 'UNAUTHORIZED') {
                console.log(color('Device token rejected - clearing stale token').yellow.toString());
                this.config.server.cloud.deviceToken = null;
                this.config.server.cloud.deviceName = null;
                this.config.save();
            }
        }
    }

    private subscribeErrors() {
        if (this.errorHandler) return; // already subscribed
        this.errorHandler = ({ message, context }) => {
            if (this.relayConnected) {
                // Send immediately; server persists it directly
                this.relaySend({ type: 'error', message, context: context ?? {}, occurredAt: new Date().toISOString() });
            } else {
                // Queue for next heartbeat
                this.queueError(message, context);
            }
        };
        errorBus.on('error', this.errorHandler);
    }

    private unsubscribeErrors() {
        if (this.errorHandler) {
            errorBus.off('error', this.errorHandler);
            this.errorHandler = null;
        }
    }

    private connectRelay() {
        const deviceToken = this.config.server.cloud.deviceToken;
        if (!deviceToken) return;

        // Clear any pending reconnect
        if (this.relayReconnectTimer) {
            clearTimeout(this.relayReconnectTimer);
            this.relayReconnectTimer = null;
        }

        // Close existing WS if open
        if (this.relayWs) {
            try {
                this.relayWs.onclose = null;
                this.relayWs.close();
            } catch { /* ignore */ }
            this.relayWs = null;
        }

        const wsUrl = `${CLOUD_SERVER_URL.replace(/^http/, 'ws')}/ws/device?token=${encodeURIComponent(deviceToken)}`;

        // Use global WebSocket if available (browser), otherwise require ws (Node.js/Bun)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const WS: any = typeof WebSocket !== 'undefined' ? WebSocket : require('ws').WebSocket;

        let ws: typeof this.relayWs;
        try {
            ws = new WS(wsUrl);
        } catch (err) {
            console.error(color('Relay WS connect failed:').red.toString(), err);
            this.scheduleRelayReconnect();
            return;
        }

        this.relayWs = ws;
        this.relayConnected = false;

        ws.onopen = () => {
            this.relayConnected = true;
            console.log(color('Relay WS connected').green.toString());

            // Pull latest config (including API key) in case it changed while offline
            this.syncConfig().catch(err =>
                console.error(color('Cloud sync on reconnect failed:').yellow.toString(), err)
            );

            // Send hello
            this.relaySend({
                type: 'hello',
                config: this.config.get(),
                physicalDevices: this.getPhysicalDevices(),
            });

            // Forward captions to relay
            if (this.captionHandler) captionBus.off('frame', this.captionHandler);
            this.captionHandler = (frame: Frame) => this.relaySend({ type: 'caption', frame });
            captionBus.on('frame', this.captionHandler);

            // Start volume interval
            this.stopVolumeInterval();
            this.volumeInterval = setInterval(() => {
                if (ws.readyState !== 1 /* OPEN */) return;
                this.relaySend({
                    type: 'volumes',
                    devices: this.getSpeechServices().map(s => ({
                        id: s.inputConfig.id,
                        volume: Math.round(s.volume),
                        threshold: Math.round(s.effectiveThreshold),
                        state: s.getState,
                    })),
                });
            }, RELAY_VOLUME_INTERVAL_MS);
        };

        ws.onmessage = (event: { data: string }) => {
            try {
                const msg = JSON.parse(event.data) as Record<string, unknown>;
                this.handleRelayCommand(msg);
            } catch { /* ignore */ }
        };

        ws.onclose = () => {
            this.relayConnected = false;
            this.stopVolumeInterval();
            if (this.captionHandler) { captionBus.off('frame', this.captionHandler); this.captionHandler = null; }
            console.log(color('Relay WS disconnected').yellow.toString());
            // Reconnect if we still have a token
            if (this.config.server.cloud.deviceToken) {
                this.scheduleRelayReconnect();
            }
        };

        ws.onerror = (err: unknown) => {
            console.error(color('Relay WS error:').red.toString(), err);
        };
    }

    private scheduleRelayReconnect() {
        if (this.relayReconnectTimer) return;
        this.relayReconnectTimer = setTimeout(() => {
            this.relayReconnectTimer = null;
            if (this.config.server.cloud.deviceToken) {
                this.connectRelay();
            }
        }, RELAY_RECONNECT_DELAY_MS);
    }

    private disconnectRelay() {
        this.stopVolumeInterval();
        if (this.captionHandler) { captionBus.off('frame', this.captionHandler); this.captionHandler = null; }
        if (this.relayReconnectTimer) {
            clearTimeout(this.relayReconnectTimer);
            this.relayReconnectTimer = null;
        }
        if (this.relayWs) {
            try {
                this.relayWs.onclose = null;
                this.relayWs.close();
            } catch { /* ignore */ }
            this.relayWs = null;
        }
        this.relayConnected = false;
    }

    private stopVolumeInterval() {
        if (this.volumeInterval) {
            clearInterval(this.volumeInterval);
            this.volumeInterval = null;
        }
    }

    private relaySend(msg: unknown) {
        if (this.relayWs?.readyState === 1 /* OPEN */) {
            try {
                this.relayWs.send(JSON.stringify(msg));
            } catch { /* ignore */ }
        }
    }

    private handleRelayCommand(msg: Record<string, unknown>) {
        const type = msg.type as string;

        if (type === 'set') {
            const key = msg.key as string;
            const value = msg.value;
            (this.config as unknown as { set: (key: string, value: unknown) => void }).set(key, value);
            this.config.save();
            displayCtrlBus.emit('event', { type: 'config' });
            this.relaySend({ type: 'config', config: this.config.get() });

        } else if (type === 'setJson') {
            const key = msg.key as string;
            if (key === 'server.google') {
                (this.config.server as unknown as Record<string, unknown>).google = msg.value;
                this.config.save();
                displayCtrlBus.emit('event', { type: 'config' });
                this.relaySend({ type: 'config', config: this.config.get() });
            }

        } else if (type === 'setArray') {
            const fullKey = msg.key as string;
            const value = msg.value;
            // Extract the sub-key after 'transcription.'
            const subKey = fullKey.includes('.') ? fullKey.split('.').pop()! : fullKey;
            (this.config.transcription as unknown as Record<string, unknown>)[subKey] = value;
            this.config.save();
            this.relaySend({ type: 'config', config: this.config.get() });

        } else if (type === 'setInputs') {
            this.config.transcription.inputs = msg.inputs as typeof this.config.transcription.inputs;
            this.config.save();
            this.relaySend({ type: 'config', config: this.config.get() });

        } else if (type === 'restart') {
            console.log('[RESTART] triggered via cloud relay restart command');
            this.restart();

        } else if (type === 'hide') {
            const value = msg.value as boolean;
            this.config.display.hidden = value;
            this.config.save();
            displayCtrlBus.emit('event', { type: 'hide', value });
            this.relaySend({ type: 'config', config: this.config.get() });

        } else if (type === 'clear') {
            displayCtrlBus.emit('event', { type: 'clear' });

        } else if (type === 'reloadDisplay') {
            displayCtrlBus.emit('event', { type: 'reload' });

        } else if (type === 'pushSettings') {
            const settings = msg.settings as Record<string, unknown>;
            this.mergeSettings(settings);
            this.config.save();
            displayCtrlBus.emit('event', { type: 'config' });
            // Report back so server clears pushedSettings
            this.relaySend({ type: 'config', config: this.config.get() });
        }
    }

    private async syncConfig() {
        const result = await this.client.device.config.query();
        this.applyApiKey(result.apiKey, result.apiKeyType);
        if (result.pendingSettings?.length) {
            this.applyPendingSettings(result.pendingSettings as Record<string, unknown>[]);
        }
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private async heartbeat() {
        try {
            const services = this.getSpeechServices();
            const minutesUsed = services.reduce((sum, s) => sum + s.getUsageMinutes(), 0);
            services.forEach(s => s.resetUsageMinutes());

            const errors = this.errorQueue.splice(0).map(e => ({
                message: e.message,
                context: e.context,
                occurredAt: e.occurredAt,
            }));
            const result = await this.client.device.heartbeat.mutate({ minutesUsed, errors });

            if (result.pendingSettings?.length) {
                this.applyPendingSettings(result.pendingSettings as Record<string, unknown>[]);
            }
        } catch (err) {
            console.error(color('Cloud heartbeat failed:').yellow.toString(), err);
        }
    }

    private applyApiKey(apiKey: string | null, apiKeyType: string) {
        if (!apiKey) return;
        try {
            const creds = JSON.parse(apiKey);
            this.config.server.google.credentials = {
                client_email: creds.client_email ?? '',
                private_key: creds.private_key ?? '',
            };
            if (creds.project_id) {
                this.config.server.google.projectId = creds.project_id;
            }
            this.config.save();
        } catch {
            console.error(color('Cloud: failed to parse API key JSON').red.toString());
        }
    }

    private applyPendingSettings(settingsList: Record<string, unknown>[]) {
        for (const settings of settingsList) {
            this.mergeSettings(settings);
        }
        this.config.save();
        console.log(color(`Cloud: applied ${settingsList.length} setting(s) from server`).cyan.toString());
        // Ack to server so pushedSettings is cleared — prevents re-applying on every reconnect
        this.relaySend({ type: 'config', config: this.config.get() });
    }

    private mergeSettings(settings: Record<string, unknown>) {
        const merge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
            for (const key of Object.keys(source)) {
                if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof target[key] === 'object') {
                    merge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
                } else {
                    target[key] = source[key];
                }
            }
        };
        merge(this.config as unknown as Record<string, unknown>, settings);
    }
}
