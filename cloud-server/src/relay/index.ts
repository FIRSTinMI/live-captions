import { WebSocket } from 'ws';

export interface DeviceRelayState {
    config: unknown;
    physicalDevices: Array<{ id: number; name: string; inputChannels: number }>;
    volumes: Array<{ id: number; volume: number; threshold: number; state: number }>;
    online: boolean;
}

class RelayManager {
    private deviceSockets = new Map<number, WebSocket>();
    private adminSockets = new Map<number, Set<WebSocket>>();
    readonly state = new Map<number, DeviceRelayState>();
    private configSaveHandler: ((deviceId: number, config: unknown, source: 'hello' | 'config') => void) | null = null;

    setConfigSaveHandler(handler: (deviceId: number, config: unknown, source: 'hello' | 'config') => void) {
        this.configSaveHandler = handler;
    }

    sendToDevice(deviceId: number, msg: unknown) {
        const ws = this.deviceSockets.get(deviceId);
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    connectDevice(deviceId: number, ws: WebSocket) {
        const existing = this.deviceSockets.get(deviceId);
        if (existing?.readyState === WebSocket.OPEN) existing.terminate();
        this.deviceSockets.set(deviceId, ws);
        const s = this.getOrCreate(deviceId);
        s.online = true;

        ws.on('message', (data) => {
            try { this.onDeviceMessage(deviceId, JSON.parse(data.toString())); }
            catch { /* ignore */ }
        });

        ws.on('close', () => {
            if (this.deviceSockets.get(deviceId) === ws) {
                this.deviceSockets.delete(deviceId);
                const st = this.state.get(deviceId);
                if (st) st.online = false;
                this.broadcast(deviceId, { type: 'offline' });
            }
        });
    }

    connectAdmin(deviceId: number, ws: WebSocket) {
        let admins = this.adminSockets.get(deviceId);
        if (!admins) { admins = new Set(); this.adminSockets.set(deviceId, admins); }
        admins.add(ws);

        const s = this.state.get(deviceId);
        const isOnline = this.isOnline(deviceId);
        ws.send(JSON.stringify(
            s ? { type: 'hello', ...s, online: isOnline } : { type: 'offline' }
        ));

        ws.on('message', (data) => {
            try {
                const deviceWs = this.deviceSockets.get(deviceId);
                if (deviceWs?.readyState === WebSocket.OPEN) deviceWs.send(data.toString());
            } catch { /* ignore */ }
        });

        ws.on('close', () => { admins!.delete(ws); });
    }

    isOnline(deviceId: number): boolean {
        const ws = this.deviceSockets.get(deviceId);
        return ws?.readyState === WebSocket.OPEN;
    }

    private onDeviceMessage(deviceId: number, msg: Record<string, unknown>) {
        const s = this.getOrCreate(deviceId);
        if (msg.type === 'hello') {
            if (msg.config !== undefined) s.config = msg.config;
            if (msg.physicalDevices) s.physicalDevices = msg.physicalDevices as typeof s.physicalDevices;
            if (msg.config !== undefined) this.configSaveHandler?.(deviceId, msg.config, 'hello');
            this.broadcast(deviceId, { type: 'hello', ...s, online: true });
        } else if (msg.type === 'config') {
            if (msg.config !== undefined) {
                s.config = msg.config;
                this.configSaveHandler?.(deviceId, msg.config, 'config');
            }
            this.broadcast(deviceId, msg);
        } else if (msg.type === 'volumes') {
            if (msg.devices) s.volumes = msg.devices as typeof s.volumes;
            this.broadcast(deviceId, msg);
        } else if (msg.type === 'caption') {
            this.broadcast(deviceId, msg);
        }
    }

    private getOrCreate(deviceId: number): DeviceRelayState {
        if (!this.state.has(deviceId)) {
            this.state.set(deviceId, { config: null, physicalDevices: [], volumes: [], online: false });
        }
        return this.state.get(deviceId)!;
    }

    private broadcast(deviceId: number, msg: unknown) {
        const admins = this.adminSockets.get(deviceId);
        if (!admins?.size) return;
        const json = JSON.stringify(msg);
        for (const ws of admins) {
            if (ws.readyState === WebSocket.OPEN) ws.send(json);
        }
    }
}

export const relay = new RelayManager();
