import { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '../api';

export type RemoteInput = {
    id: number;
    device: number;
    deviceName?: string;
    speaker?: string;
    channel: number;
    sampleRate: number;
    color: string;
    threshold: number;
    autoThreshold?: boolean;
    thresholdLastSet?: number;
    languages: string[];
    driver: number;
};

export type RemoteConfig = {
    display: {
        position: number;
        size: number;
        lines: number;
        chromaKey: string;
        timeout: number;
        align: string;
        hidden: boolean;
    };
    transcription: {
        engine: string;
        inputs: RemoteInput[];
        phraseSets: string[];
        filter: string[];
        streamingTimeout: number;
    };
    server: {
        port: number;
    };
};

export type PhysicalDevice = { id: number; name: string; inputChannels: number };
export type VolumeEntry = { id: number; volume: number; threshold: number; state: number };
export type CaptionEntry = { device: number; text: string; isFinal: boolean; speaker?: string; ts: number };

export type RelayState = {
    online: boolean;
    config: RemoteConfig | null;
    physicalDevices: PhysicalDevice[];
    volumes: VolumeEntry[];
    captions: CaptionEntry[];
    clientVersion: string | null;
};

const INITIAL_STATE: RelayState = {
    online: false,
    config: null,
    physicalDevices: [],
    volumes: [],
    captions: [],
    clientVersion: null,
};

export function useDeviceRelay(deviceId: number): [RelayState, (msg: unknown) => void] {
    const [state, setState] = useState<RelayState>(INITIAL_STATE);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unmountedRef = useRef(false);

    const send = useCallback((msg: unknown) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }, []);

    const connect = useCallback(() => {
        if (unmountedRef.current) return;

        const token = getToken();
        if (!token) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws/admin/${deviceId}?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            if (unmountedRef.current) return;
            try {
                const msg = JSON.parse(event.data) as Record<string, unknown>;
                if (msg.type === 'hello') {
                    setState(s => ({
                        online: (msg.online as boolean) ?? true,
                        config: (msg.config as RemoteConfig) ?? null,
                        physicalDevices: (msg.physicalDevices as PhysicalDevice[]) ?? [],
                        volumes: (msg.volumes as VolumeEntry[]) ?? [],
                        captions: s.captions,
                        clientVersion: (msg.clientVersion as string) ?? null,
                    }));
                } else if (msg.type === 'offline') {
                    setState(s => ({ ...s, online: false }));
                } else if (msg.type === 'config') {
                    setState(s => ({ ...s, config: (msg.config as RemoteConfig) ?? s.config }));
                } else if (msg.type === 'volumes') {
                    setState(s => ({ ...s, volumes: (msg.devices as VolumeEntry[]) ?? s.volumes }));
                } else if (msg.type === 'caption') {
                    const f = msg.frame as { device: number; text: string; isFinal: boolean; speaker?: string };
                    const entry: CaptionEntry = { ...f, ts: Date.now() };
                    setState(s => ({ ...s, captions: [...s.captions, entry].slice(-150) }));
                }
            } catch {
                // ignore malformed messages
            }
        };

        ws.onclose = () => {
            if (unmountedRef.current) return;
            setState(s => ({ ...s, online: false }));
            reconnectTimer.current = setTimeout(() => {
                if (!unmountedRef.current) connect();
            }, 3000);
        };

        ws.onerror = () => {
            // onclose will fire after onerror, handles reconnect
        };
    }, [deviceId]);

    useEffect(() => {
        unmountedRef.current = false;
        connect();

        return () => {
            unmountedRef.current = true;
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    return [state, send];
}
