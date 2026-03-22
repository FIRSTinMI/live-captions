import React, { useEffect, useRef } from 'react';
import { Frame, AppConfig } from '../shared/types';

interface Props {
    deviceId: number;
    color: string;
    config: AppConfig;
    latestFrame: Frame | null;
    visibleCount: number;
    onEmpty: (deviceId: number) => void;
    clearingWaitForFinal: boolean;
    onFinalReceived: () => void;
}

function capitalize(text: string): string {
    return text
        .split('.')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('.')
        .replace(/(rainbow(?: rumble)?)/gi, '<span class="r">$1</span>');
}

export function CaptionTrack({
    deviceId, color, config, latestFrame, visibleCount, onEmpty, clearingWaitForFinal, onFinalReceived
}: Props) {
    const divRef = useRef<HTMLDivElement>(null);
    const transcriptRef = useRef('');
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const staleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hasInterimRef = useRef(false);

    const { display } = config;
    const fontSize = display.size;
    const lineH = fontSize + 6;
    const maxH = visibleCount > 1
        ? (display.lines > 2 * visibleCount ? lineH * display.lines / visibleCount : lineH)
        : lineH * display.lines;

    useEffect(() => {
        if (!latestFrame || !divRef.current) return;

        const div = divRef.current;
        const transcript = transcriptRef.current;

        clearTimeout(timeoutRef.current);

        if (clearingWaitForFinal && latestFrame.isFinal) {
            transcriptRef.current = '';
            div.innerHTML = '';
            hasInterimRef.current = false;
            clearTimeout(staleTimeoutRef.current);
            onFinalReceived();
            return;
        }
        if (clearingWaitForFinal) return;

        if (!latestFrame.isFinal) {
            div.innerHTML = capitalize(transcript + latestFrame.text);
            hasInterimRef.current = true;
            clearTimeout(staleTimeoutRef.current);
            staleTimeoutRef.current = setTimeout(() => {
                div.innerHTML = capitalize(transcriptRef.current) || '';
                hasInterimRef.current = false;
            }, 8000);
        } else {
            clearTimeout(staleTimeoutRef.current);
            hasInterimRef.current = false;
            const committed = transcript + capitalize(latestFrame.text) + '\n';
            transcriptRef.current = committed;
            div.innerHTML = committed;

            timeoutRef.current = setTimeout(() => {
                transcriptRef.current = '';
                div.innerHTML = '';
                onEmpty(deviceId);
            }, display.timeout * 1000);
        }

        div.scrollTop = div.scrollHeight;
    }, [latestFrame]);

    // Reset on clear
    useEffect(() => {
        return () => {
            clearTimeout(timeoutRef.current);
            clearTimeout(staleTimeoutRef.current);
        };
    }, []);

    return (
        <div
            ref={divRef}
            className="lc-track"
            style={{
                color,
                fontSize: `${fontSize}px`,
                lineHeight: `${lineH}px`,
                maxHeight: `${maxH}px`,
            }}
        />
    );
}
