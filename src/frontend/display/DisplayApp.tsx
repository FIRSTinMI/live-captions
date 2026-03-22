import React, { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '../shared/trpc';
import { Frame, AppConfig, InputConfig } from '../shared/types';
import { CaptionTrack } from './CaptionTrack';
import { useWatchdog } from './useWatchdog';

function applyPositionStyles(el: HTMLElement, position: number, align: string) {
    el.style.removeProperty('bottom');
    el.style.removeProperty('top');
    el.style.removeProperty('left');
    el.style.removeProperty('right');
    el.style.removeProperty('transform');
    switch (position) {
        case 0: el.style.bottom = '0'; break;
        case 1: el.style.top = '0'; break;
        case 2: el.style.bottom = '256px'; break;
        case 3: el.style.top = '256px'; break;
    }
    switch (align) {
        case 'left': el.style.left = '0'; break;
        case 'right': el.style.right = '0'; break;
        case 'center':
            el.style.left = '50%';
            el.style.transform = 'translateX(-50%)';
            break;
    }
}

export function DisplayApp() {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [hidden, setHidden] = useState(false);
    const [framesByDevice, setFramesByDevice] = useState<Map<number, Frame | null>>(new Map());
    const [emptyDevices, setEmptyDevices] = useState<Set<number>>(new Set());
    const [clearingWaitForFinal, setClearingWaitForFinal] = useState(false);
    const lcRef = useRef<HTMLDivElement>(null);

    const { recordFrame, recordMicActive } = useWatchdog();

    // Apply URL param overrides to config
    const configQuery = trpc.config.get.useQuery(undefined, { staleTime: Infinity });
    const utils = trpc.useUtils();

    // Parse query and merge with server config — runs when data arrives
    useEffect(() => {
        if (!configQuery.data) return;
        const json = configQuery.data as AppConfig;
        const params = new URLSearchParams(window.location.search);

        const merged: AppConfig = {
            ...json,
            display: {
                ...json.display,
                size: params.get('fontSize') ? parseInt(params.get('fontSize')!) : json.display.size,
                lines: params.get('maxLines') ? parseInt(params.get('maxLines')!) : json.display.lines,
                align: (params.get('align') as AppConfig['display']['align']) || json.display.align,
                position: params.get('position') ? parseInt(params.get('position')!) : json.display.position,
                timeout: params.get('timeout') ? parseInt(params.get('timeout')!) : json.display.timeout,
                chromaKey: params.get('chromaKey') || json.display.chromaKey,
            },
        };

        setConfig(merged);
        setHidden(merged.display.hidden);
        document.body.style.backgroundColor = merged.display.chromaKey;
    }, [configQuery.data]);

    // Apply DOM position/size styles after the #lc div is rendered (config in state)
    useEffect(() => {
        if (!config || !lcRef.current) return;
        applyPositionStyles(lcRef.current, config.display.position, config.display.align);
        lcRef.current.style.maxHeight = config.display.lines * (config.display.size + 6) + 'px';
    }, [config]);

    // Subscriptions
    trpc.captions.useSubscription(undefined, {
        onData: (frame: Frame) => {
            if (frame.text === '') return;
            recordFrame();
            setEmptyDevices(prev => {
                const next = new Set(prev);
                next.delete(frame.device);
                return next;
            });
            setFramesByDevice(prev => new Map(prev).set(frame.device, frame));
        },
    });

    trpc.micStatus.useSubscription(undefined, {
        onData: (data) => {
            if (data.devices.some(d => d.active)) recordMicActive();
        },
    });

    trpc.displayControl.useSubscription(undefined, {
        onData: (event) => {
            if (event.type === 'config') {
                utils.config.get.invalidate();
            } else if (event.type === 'hide') {
                setHidden(event.value);
            } else if (event.type === 'clear') {
                // Mark all devices as clearing
                if (framesByDevice.size > 0) {
                    setClearingWaitForFinal(true);
                }
                setFramesByDevice(new Map());
                setEmptyDevices(new Set());
            }
        },
    });

    const handleEmpty = useCallback((deviceId: number) => {
        setEmptyDevices(prev => new Set(prev).add(deviceId));
    }, []);

    const handleFinalReceived = useCallback(() => {
        setClearingWaitForFinal(false);
    }, []);

    if (!config) return null;

    const { display, transcription } = config;
    const urlSpeakers = new URLSearchParams(window.location.search).getAll('speaker');

    const activeInputs = transcription.inputs.filter(input =>
        urlSpeakers.length === 0 || urlSpeakers.includes(input.id.toString())
    );

    const tracksWithContent = activeInputs.filter(input =>
        !emptyDevices.has(input.id) && framesByDevice.has(input.id)
    );
    const visibleCount = tracksWithContent.length || 1;
    const hasVisibleContent = tracksWithContent.length > 0;

    return (
        <div
            id="lc"
            ref={lcRef}
            style={{ display: hidden || !hasVisibleContent ? 'none' : 'flex' }}
        >
            {activeInputs.map(input => (
                <CaptionTrack
                    key={input.id}
                    deviceId={input.id}
                    color={input.color}
                    config={config}
                    latestFrame={framesByDevice.get(input.id) ?? null}
                    visibleCount={visibleCount}
                    onEmpty={handleEmpty}
                    clearingWaitForFinal={clearingWaitForFinal}
                    onFinalReceived={handleFinalReceived}
                />
            ))}
        </div>
    );
}
