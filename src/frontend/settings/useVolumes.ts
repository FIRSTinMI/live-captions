import { useState, useRef, useEffect } from 'react';
import { trpc } from '../shared/trpc';

export const enum StreamingState { ACTIVE = 0, PAUSED = 1, DESTROYED = 2 }

export interface VolumeEntry {
    volume: number;
    threshold: number;
    state: StreamingState;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface VolumesState {
    volumes: Map<number, VolumeEntry>;
    connected: ConnectionStatus;
}

export function useVolumes(): VolumesState {
    const [volumes, setVolumes] = useState<Map<number, VolumeEntry>>(new Map());
    const [connected, setConnected] = useState<ConnectionStatus>('connecting');
    const staleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    function resetStaleTimer() {
        clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => setConnected('disconnected'), 4000);
    }

    trpc.volumes.useSubscription(undefined, {
        onStarted: () => {
            setConnected('connected');
            resetStaleTimer();
        },
        onData: (data) => {
            setConnected('connected');
            resetStaleTimer();
            setVolumes(new Map(data.devices.map(d => [d.id, { volume: d.volume, threshold: d.threshold, state: d.state }])));
        },
        onError: () => {
            clearTimeout(staleTimerRef.current);
            setConnected('disconnected');
        },
    });

    useEffect(() => () => clearTimeout(staleTimerRef.current), []);

    return { volumes, connected };
}
