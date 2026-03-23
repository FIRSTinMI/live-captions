import React, { useEffect, useRef } from 'react';
import type { RelayState, RemoteInput, CaptionEntry } from '../hooks/useDeviceRelay';

function CaptionLog({ captions, inputs }: { captions: CaptionEntry[]; inputs: RemoteInput[] }) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [captions.length]);

    if (captions.length === 0) {
        return (
            <div className="text-center py-6 text-gray-400 text-xs italic">
                No captions received yet - waiting for speech...
            </div>
        );
    }

    return (
        <div className="max-h-56 overflow-y-auto font-mono text-sm leading-relaxed space-y-0.5 pr-1">
            {captions.map((c, i) => {
                const input = inputs.find(inp => inp.id === c.device);
                const color = input?.color ?? '#9ca3af';
                const speaker = c.speaker || input?.speaker || `Input ${c.device}`;
                return (
                    <div key={i} className={`flex gap-2 ${c.isFinal ? '' : 'opacity-50 italic'}`}>
                        <span className="text-xs font-semibold shrink-0 mt-0.5" style={{ color, minWidth: 80 }}>
                            {speaker}
                        </span>
                        <span className="text-gray-800 dark:text-gray-200 break-words min-w-0">{c.text}</span>
                        {!c.isFinal && <span className="text-gray-400 text-xs shrink-0 mt-0.5">…</span>}
                    </div>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}

interface LiveSessionProps {
    state: RelayState;
    send: (msg: unknown) => void;
}

export function LiveSession({ state, send }: LiveSessionProps) {
    const inputs = state.config?.transcription.inputs ?? [];

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Live Monitor</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Real-time caption output</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    {state.online && (
                        <>
                            <button
                                onClick={() => { if (confirm('Restart speech recognition on this device?')) send({ type: 'restart' }); }}
                                className="bg-orange-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-orange-700"
                            >
                                Restart Recognition
                            </button>
                            <button
                                onClick={() => send({ type: 'reloadDisplay' })}
                                className="bg-gray-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-700"
                            >
                                Refresh Display
                            </button>
                        </>
                    )}
                    {state.online ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                            Online
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                            <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                            Offline
                        </span>
                    )}
                </div>
            </div>

            {!state.online && (
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 text-sm text-gray-400">
                    Device is offline - changes will not take effect until it reconnects.
                </div>
            )}

            <div className="p-6">
                {state.captions.length === 0 && !state.online ? (
                    <p className="text-center py-4 text-gray-400 text-sm italic">Device is offline.</p>
                ) : (
                    <CaptionLog captions={state.captions} inputs={inputs} />
                )}
            </div>
        </div>
    );
}
