import React, { useState, useEffect, useRef } from 'react';
import type { RelayState, RemoteInput, PhysicalDevice, CaptionEntry } from '../hooks/useDeviceRelay';
import { trpc } from '../api';

type LiveTab = 'live' | 'display' | 'transcription';

function VolumeBar({ volume, threshold }: { volume: number; threshold: number }) {
    const active = volume >= threshold;
    return (
        <div className="relative h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-visible">
            <div
                className="h-full rounded-full transition-all duration-50"
                style={{ width: `${Math.min(volume, 100)}%`, background: active ? '#4caf50' : '#ef4444' }}
            />
            <div
                className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-gray-700 dark:bg-gray-300 rounded"
                style={{ left: `${Math.min(threshold, 100)}%` }}
            />
        </div>
    );
}

function StateBadge({ state }: { state: number }) {
    if (state === 0) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Streaming</span>;
    if (state === 1) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">Paused</span>;
    if (state === 3) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Error</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Stopped</span>;
}

type DisplayLocal = {
    position: number;
    size: number;
    lines: number;
    chromaKey: string;
    timeout: number;
    align: string;
};

type TranscriptionLocal = {
    engine: string;
    phraseSets: string;
    inputs: RemoteInput[];
};

const DEFAULT_DISPLAY: DisplayLocal = {
    position: 0,
    size: 42,
    lines: 2,
    chromaKey: '#00B140',
    timeout: 5,
    align: 'center',
};

const DEFAULT_INPUT: RemoteInput = {
    id: Date.now(),
    device: 0,
    speaker: '',
    channel: 0,
    sampleRate: 16000,
    color: '#ffffff',
    threshold: 10,
    autoThreshold: false,
    languages: ['en-US'],
    driver: 0,
};

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

function LiveTab({ state, send }: { state: RelayState; send: (msg: unknown) => void }) {
    const inputs = state.config?.transcription.inputs ?? [];
    const volumes = state.volumes;

    // Use inputs from config if available, else fall back to volume entries
    const rows = inputs.length > 0 ? inputs.map(inp => {
        const vol = volumes.find(v => v.id === inp.id);
        const physDev = state.physicalDevices.find(d => d.id === inp.device);
        return {
            id: inp.id,
            label: `${physDev?.name ?? `Device ${inp.device}`}${inp.speaker ? ` - ${inp.speaker}` : ''}`,
            color: inp.color,
            volume: vol?.volume ?? 0,
            threshold: vol?.threshold ?? inp.threshold,
            devState: vol?.state ?? 2,
        };
    }) : volumes.map(v => ({
        id: v.id,
        label: `Input ${v.id}`,
        color: '#ffffff',
        volume: v.volume,
        threshold: v.threshold,
        devState: v.state,
    }));

    return (
        <div className="space-y-4">
            {rows.length === 0 && (
                <p className="text-center py-4 text-gray-400 text-sm">No inputs configured on this device.</p>
            )}
            {rows.map(row => (
                <div key={row.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full border border-gray-300 dark:border-gray-500 flex-shrink-0" style={{ background: row.color }} />
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{row.label}</span>
                        </div>
                        <StateBadge state={row.devState} />
                    </div>
                    <VolumeBar volume={row.volume} threshold={row.threshold} />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>Volume: {row.volume.toFixed(0)}%</span>
                        <span>Threshold: {row.threshold.toFixed(0)}%</span>
                    </div>
                </div>
            ))}

            {/* Caption log */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Live Transcript</h4>
                    <span className="text-xs text-gray-400">{state.captions.length} lines</span>
                </div>
                <CaptionLog captions={state.captions} inputs={inputs} />
            </div>
        </div>
    );
}

function DisplayTab({ state, send, offlineSettings, onSave, isSaving, saveMsg }: {
    state: RelayState;
    send: (msg: unknown) => void;
    offlineSettings?: unknown;
    onSave: (settings: Record<string, unknown>) => void;
    isSaving: boolean;
    saveMsg: string;
}) {
    const [local, setLocal] = useState<DisplayLocal>(DEFAULT_DISPLAY);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!initialized) {
            const src = (state.config ?? offlineSettings) as { display?: Partial<DisplayLocal> } | null;
            if (src?.display) {
                setLocal({
                    position: src.display.position ?? DEFAULT_DISPLAY.position,
                    size: src.display.size ?? DEFAULT_DISPLAY.size,
                    lines: src.display.lines ?? DEFAULT_DISPLAY.lines,
                    chromaKey: src.display.chromaKey ?? DEFAULT_DISPLAY.chromaKey,
                    timeout: src.display.timeout ?? DEFAULT_DISPLAY.timeout,
                    align: src.display.align ?? DEFAULT_DISPLAY.align,
                });
                setInitialized(true);
            }
        }
    }, [state.config, offlineSettings]);

    function sendSet(key: string, value: string) {
        send({ type: 'set', key: `display.${key}`, value });
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Position</label>
                    <select
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        value={local.position}
                        onChange={e => {
                            const v = Number(e.target.value);
                            setLocal(s => ({ ...s, position: v }));
                            sendSet('position', String(v));
                        }}
                    >
                        <option value={0}>Bottom</option>
                        <option value={1}>Top</option>
                        <option value={2}>Bottom (audience)</option>
                        <option value={3}>Top (audience)</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Alignment</label>
                    <select
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        value={local.align}
                        onChange={e => {
                            const v = e.target.value;
                            setLocal(s => ({ ...s, align: v }));
                            sendSet('align', v);
                        }}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Chroma Key</label>
                    <input
                        type="text"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        value={local.chromaKey}
                        onChange={e => setLocal(s => ({ ...s, chromaKey: e.target.value }))}
                        onBlur={e => sendSet('chromaKey', e.target.value)}
                        placeholder="#00B140"
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Text Size (px)</label>
                    <input
                        type="number"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        value={local.size}
                        onChange={e => setLocal(s => ({ ...s, size: Number(e.target.value) }))}
                        onBlur={e => sendSet('size', e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Max Lines</label>
                    <input
                        type="number"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        value={local.lines}
                        onChange={e => setLocal(s => ({ ...s, lines: Number(e.target.value) }))}
                        onBlur={e => sendSet('lines', e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Timeout (s)</label>
                    <input
                        type="number"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        value={local.timeout}
                        onChange={e => setLocal(s => ({ ...s, timeout: Number(e.target.value) }))}
                        onBlur={e => sendSet('timeout', e.target.value)}
                    />
                </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                <button
                    onClick={() => send({ type: 'hide', value: !state.config?.display.hidden })}
                    className="bg-gray-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-gray-700"
                >
                    {state.config?.display.hidden ? 'Show Captions' : 'Hide Captions'}
                </button>
                <button
                    onClick={() => send({ type: 'clear' })}
                    className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded px-4 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                    Clear Captions
                </button>
                <button
                    onClick={() => send({ type: 'reloadDisplay' })}
                    disabled={!state.online}
                    className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded px-4 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Refresh Display Clients
                </button>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                <button
                    onClick={() => onSave({ display: local })}
                    disabled={isSaving}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : state.online ? 'Save & Push' : 'Save (sync on next connection)'}
                </button>
                {saveMsg && <span className="text-sm text-green-600 dark:text-green-400">{saveMsg}</span>}
            </div>
        </div>
    );
}

function TranscriptionTab({ state, send, offlineSettings, onSave, isSaving, saveMsg }: {
    state: RelayState;
    send: (msg: unknown) => void;
    offlineSettings?: unknown;
    onSave: (settings: Record<string, unknown>) => void;
    isSaving: boolean;
    saveMsg: string;
}) {
    const [local, setLocal] = useState<TranscriptionLocal>({
        engine: 'googlev2',
        phraseSets: '',
        inputs: [],
    });
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!initialized) {
            const src = (state.config ?? offlineSettings) as { transcription?: { engine?: string; phraseSets?: string[]; inputs?: RemoteInput[] } } | null;
            if (src?.transcription) {
                setLocal({
                    engine: src.transcription.engine ?? 'googlev2',
                    phraseSets: Array.isArray(src.transcription.phraseSets)
                        ? src.transcription.phraseSets.join('\n')
                        : '',
                    inputs: src.transcription.inputs ? [...src.transcription.inputs] : [],
                });
                setInitialized(true);
            }
        }
    }, [state.config, offlineSettings]);

    function updateInput(index: number, patch: Partial<RemoteInput>) {
        setLocal(s => {
            const inputs = [...s.inputs];
            inputs[index] = { ...inputs[index], ...patch };
            return { ...s, inputs };
        });
    }

    function removeInput(index: number) {
        setLocal(s => ({ ...s, inputs: s.inputs.filter((_, i) => i !== index) }));
    }

    function addInput() {
        setLocal(s => ({
            ...s,
            inputs: [...s.inputs, { ...DEFAULT_INPUT, id: Date.now() }],
        }));
    }

    function applyAndRestart() {
        send({ type: 'setInputs', inputs: local.inputs });
        send({ type: 'restart' });
    }

    return (
        <div className="space-y-6">
            {/* Engine */}
            <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Transcription Engine</label>
                <select
                    className="w-full max-w-xs border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={local.engine}
                    onChange={e => {
                        const v = e.target.value;
                        setLocal(s => ({ ...s, engine: v }));
                        send({ type: 'set', key: 'transcription.engine', value: v });
                        if (confirm('Engine changed. Restart device to apply?')) {
                            send({ type: 'restart' });
                        }
                    }}
                >
                    <option value="googlev1">Google V1</option>
                    <option value="googlev2">Google V2</option>
                    <option value="april">April ASR</option>
                </select>
            </div>

            {/* Phrase Sets */}
            <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Phrase Sets</label>
                <span className="text-xs text-gray-400">One per line. Must be configured in GCloud.</span>
                <textarea
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y dark:bg-gray-700 dark:text-white"
                    rows={4}
                    value={local.phraseSets}
                    onChange={e => setLocal(s => ({ ...s, phraseSets: e.target.value }))}
                    onBlur={e => {
                        const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean);
                        send({ type: 'setArray', key: 'transcription.phraseSets', value: lines });
                    }}
                />
            </div>

            {/* Inputs */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Inputs</label>
                    <button
                        onClick={addInput}
                        className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-100"
                    >
                        + Add Input
                    </button>
                </div>

                <div className="space-y-4">
                    {local.inputs.map((inp, idx) => {
                        const physDev = state.physicalDevices.find(d => d.id === inp.device);
                        return (
                            <div key={inp.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Input {idx + 1}</span>
                                    <button
                                        onClick={() => removeInput(idx)}
                                        className="text-xs text-red-500 hover:text-red-700"
                                    >
                                        Remove
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Speaker</label>
                                        <input
                                            type="text"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                            value={inp.speaker ?? ''}
                                            onChange={e => updateInput(idx, { speaker: e.target.value })}
                                            placeholder="Speaker name"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Device</label>
                                        <select
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                            value={inp.device}
                                            onChange={e => updateInput(idx, { device: Number(e.target.value) })}
                                        >
                                            {state.physicalDevices.length === 0 && (
                                                <option value={inp.device}>Device {inp.device}</option>
                                            )}
                                            {state.physicalDevices.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Channel</label>
                                        <input
                                            type="number"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                            min={1}
                                            max={physDev?.inputChannels ?? 64}
                                            value={inp.channel + 1}
                                            onChange={e => updateInput(idx, { channel: Math.max(0, Number(e.target.value) - 1) })}
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Color</label>
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-7 h-7 rounded border border-gray-300 flex-shrink-0 cursor-pointer"
                                                style={{ background: inp.color }}
                                                onClick={() => {
                                                    const el = document.getElementById(`color-input-${inp.id}`);
                                                    if (el) (el as HTMLInputElement).click();
                                                }}
                                            />
                                            <input
                                                id={`color-input-${inp.id}`}
                                                type="color"
                                                className="sr-only"
                                                value={inp.color}
                                                onChange={e => updateInput(idx, { color: e.target.value })}
                                            />
                                            <input
                                                type="text"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                                value={inp.color}
                                                onChange={e => updateInput(idx, { color: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Languages</label>
                                        <input
                                            type="text"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                            value={inp.languages.join(', ')}
                                            onChange={e => updateInput(idx, {
                                                languages: e.target.value.split(/[,\s]+/).map(l => l.trim()).filter(Boolean),
                                            })}
                                            placeholder="en-US"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Threshold</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min={0}
                                                max={100}
                                                className="flex-1"
                                                value={inp.threshold}
                                                disabled={inp.autoThreshold}
                                                onChange={e => updateInput(idx, { threshold: Number(e.target.value) })}
                                            />
                                            <span className="text-xs text-gray-500 w-8 text-right">{inp.threshold}</span>
                                        </div>
                                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={inp.autoThreshold ?? false}
                                                onChange={e => updateInput(idx, { autoThreshold: e.target.checked })}
                                            />
                                            Auto threshold
                                        </label>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {local.inputs.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <button
                            onClick={applyAndRestart}
                            className="bg-orange-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-orange-700"
                        >
                            Apply & Restart
                        </button>
                        <span className="text-xs text-gray-400 ml-3">Restarts speech recognition on the device</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 pt-4 border-t border-gray-100 dark:border-gray-700 mt-4">
                <button
                    onClick={() => onSave({
                        transcription: {
                            engine: local.engine,
                            phraseSets: local.phraseSets.split('\n').map(l => l.trim()).filter(Boolean),
                        },
                    })}
                    disabled={isSaving}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : state.online ? 'Save & Push' : 'Save (sync on next connection)'}
                </button>
                {saveMsg && <span className="text-sm text-green-600 dark:text-green-400">{saveMsg}</span>}
            </div>
        </div>
    );
}

interface LiveSessionProps {
    deviceId: number;
    state: RelayState;
    send: (msg: unknown) => void;
    offlineSettings?: unknown;
}

export function LiveSession({ deviceId, state, send, offlineSettings }: LiveSessionProps) {
    const [tab, setTab] = useState<LiveTab>('live');
    const utils = trpc.useUtils();
    const [saveMsg, setSaveMsg] = useState('');

    const saveSettingsMutation = trpc.admin.devices.saveSettings.useMutation({
        onSuccess: () => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            setSaveMsg(state.online ? 'Pushed to device' : 'Saved - will sync on next connection');
            setTimeout(() => setSaveMsg(''), 3000);
        },
    });

    function handleSaveSettings(settings: Record<string, unknown>) {
        saveSettingsMutation.mutate({ deviceId, settings });
    }

    const tabs: { key: LiveTab; label: string }[] = [
        { key: 'live', label: 'Live' },
        { key: 'display', label: 'Display' },
        { key: 'transcription', label: 'Transcription' },
    ];

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Live Session</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Real-time view and control of the connected device</p>
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

            {state.config === null && state.online && (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">
                    Waiting for device to connect and send state...
                </div>
            )}

            {(state.config !== null || !state.online) && (
                <>
                    <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
                        {tabs.map(t => (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                    tab === t.key
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-6">
                        {tab === 'live' && <LiveTab state={state} send={send} />}
                        {tab === 'display' && <DisplayTab state={state} send={send} offlineSettings={offlineSettings} onSave={handleSaveSettings} isSaving={saveSettingsMutation.isPending} saveMsg={saveMsg} />}
                        {tab === 'transcription' && <TranscriptionTab state={state} send={send} offlineSettings={offlineSettings} onSave={handleSaveSettings} isSaving={saveSettingsMutation.isPending} saveMsg={saveMsg} />}
                    </div>
                </>
            )}
        </div>
    );
}
