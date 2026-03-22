import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../cloud-server/src/trpc/router';
import { ConfigManager } from './configManager';
import { Speech } from '../speech';
import { GoogleV1 } from '../engines/GoogleV1';
import { GoogleV2 } from '../engines/GoogleV2';
import { April } from '../engines/April';
import { CLOUD_SERVER_URL } from './cloudConfig';
import color from 'colorts';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface QueuedError {
    message: string;
    context?: Record<string, unknown>;
}

export class CloudSync {
    private config: ConfigManager;
    private getSpeechServices: () => Speech<GoogleV1 | GoogleV2 | April>[];
    private heartbeatTimer?: NodeJS.Timeout;
    private errorQueue: QueuedError[] = [];
    private client: ReturnType<typeof createTRPCClient<AppRouter>>;

    constructor(config: ConfigManager, getSpeechServices: () => Speech<GoogleV1 | GoogleV2 | April>[]) {
        this.config = config;
        this.getSpeechServices = getSpeechServices;
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
        this.errorQueue.push({ message, context });
        // Cap queue size
        if (this.errorQueue.length > 50) {
            this.errorQueue.shift();
        }
    }

    public async connect(pin: string): Promise<{ deviceName: string }> {
        const result = await this.client.device.auth.mutate({ pin });
        this.config.server.cloud.deviceToken = result.token;
        this.config.server.cloud.deviceName = result.deviceName;
        this.config.save();
        await this.syncConfig();
        this.startHeartbeat();
        return { deviceName: result.deviceName };
    }

    public disconnect() {
        this.stopHeartbeat();
        this.config.server.cloud.deviceToken = null;
        this.config.server.cloud.deviceName = null;
        this.config.save();
    }

    public async initialize() {
        if (!this.config.server.cloud.deviceToken) return;
        try {
            await this.syncConfig();
            this.startHeartbeat();
            console.log(color('Cloud sync initialized').green.toString());
        } catch (err) {
            console.error(color('Cloud sync init failed:').red.toString(), err);
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

            const errors = this.errorQueue.splice(0);
            const result = await this.client.device.heartbeat.mutate({ minutesUsed, errors });

            this.applyApiKey(result.apiKey, result.apiKeyType);
            if (result.pendingSettings?.length) {
                this.applyPendingSettings(result.pendingSettings as Record<string, unknown>[]);
            }
        } catch (err) {
            console.error(color('Cloud heartbeat failed:').yellow.toString(), err);
        }
    }

    private applyApiKey(apiKey: string | null, apiKeyType: string) {
        if (!apiKey) {
            // Key withheld — clear credentials so recognition stops
            if (this.config.server.cloud.deviceToken) {
                console.warn(color('Cloud: API key withheld (heartbeat overdue). Recognition paused.').yellow.toString());
                this.config.server.google.credentials.client_email = '';
                this.config.server.google.credentials.private_key = '';
                this.config.save();
            }
            return;
        }

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
