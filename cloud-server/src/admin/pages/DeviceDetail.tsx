import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trpc } from '../api';
import { useDeviceRelay } from '../hooks/useDeviceRelay';
import type { RemoteInput, PhysicalDevice } from '../hooks/useDeviceRelay';
import { LiveSession } from '../components/LiveSession';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';
const inpSm = 'w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

type DisplayLocal = {
    position: number;
    size: number;
    lines: number;
    chromaKey: string;
    timeout: number;
    align: string;
};

const DEFAULT_DISPLAY: DisplayLocal = {
    position: 0, size: 42, lines: 2, chromaKey: '#00B140', timeout: 5, align: 'center',
};

const DEFAULT_INPUT: RemoteInput = {
    id: Date.now(), device: 0, speaker: '', channel: 0, sampleRate: 16000,
    color: '#ffffff', threshold: 10, autoThreshold: false, languages: ['en-US'], driver: 0,
};

function UsageChart({ rows }: { rows: { day: string; minutes: number }[] }) {
    if (!rows.length) return <p className="text-gray-400 text-sm py-4">No usage data</p>;
    const max = Math.max(...rows.map(r => r.minutes), 1);
    return (
        <div className="flex items-end gap-1 h-24">
            {rows.map(r => (
                <div key={r.day} className="flex-1 flex flex-col items-center gap-1" title={`${r.day}: ${r.minutes.toFixed(1)} min`}>
                    <div
                        className="w-full bg-blue-500 rounded-t"
                        style={{ height: `${(r.minutes / max) * 100}%`, minHeight: r.minutes > 0 ? '2px' : '0' }}
                    />
                </div>
            ))}
        </div>
    );
}

function VolumeBar({ volume, threshold }: { volume: number; threshold: number }) {
    const active = volume >= threshold;
    return (
        <div className="relative h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-visible">
            <div className="h-full rounded-full transition-all duration-50"
                style={{ width: `${Math.min(volume, 100)}%`, background: active ? '#4caf50' : '#ef4444' }} />
            <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-gray-700 dark:bg-gray-300 rounded"
                style={{ left: `${Math.min(threshold, 100)}%` }} />
        </div>
    );
}

function StateBadge({ state }: { state: number }) {
    if (state === 0) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Streaming</span>;
    if (state === 1) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">Paused</span>;
    if (state === 3) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Error</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Stopped</span>;
}

const STATE_COLORS: Record<string, string> = {
    synced: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    drifted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    missing: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

function PhraseSetMultiSelect({
    deployments,
    selectedIds,
    onChange,
}: {
    deployments: { id: number; definitionName: string; state: string }[];
    selectedIds: number[];
    onChange: (ids: number[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selected = deployments.filter(d => selectedIds.includes(d.id));
    const available = deployments.filter(d => !selectedIds.includes(d.id) && d.state !== 'missing' && d.state !== 'pending');

    function remove(id: number) { onChange(selectedIds.filter(x => x !== id)); }
    function add(id: number) { onChange([...selectedIds, id]); setOpen(false); }

    return (
        <div ref={ref} className="relative">
            <div
                className="min-h-[38px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text bg-white dark:bg-gray-700"
                onClick={() => setOpen(true)}
            >
                {selected.map(dep => (
                    <span key={dep.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                        {dep.definitionName}
                        <span className={`ml-1 px-1 py-0 rounded text-xs ${STATE_COLORS[dep.state] ?? STATE_COLORS.unknown}`}>{dep.state}</span>
                        <button
                            onClick={e => { e.stopPropagation(); remove(dep.id); }}
                            className="ml-0.5 text-blue-500 hover:text-blue-800 dark:hover:text-blue-100"
                        >×</button>
                    </span>
                ))}
                {selected.length === 0 && (
                    <span className="text-gray-400 text-sm py-0.5">Click to select phrase sets...</span>
                )}
            </div>
            {open && available.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg max-h-52 overflow-auto">
                    {available.map(dep => (
                        <button
                            key={dep.id}
                            onClick={() => add(dep.id)}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                        >
                            <span className="flex-1 text-gray-900 dark:text-white">{dep.definitionName}</span>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${STATE_COLORS[dep.state] ?? STATE_COLORS.unknown}`}>{dep.state}</span>
                        </button>
                    ))}
                    {available.length === 0 && (
                        <p className="px-3 py-2 text-sm text-gray-400">No more phrase sets available</p>
                    )}
                </div>
            )}
            {open && available.length === 0 && selected.length === 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg p-3">
                    <p className="text-sm text-gray-400">No phrase sets available</p>
                </div>
            )}
        </div>
    );
}

export function DeviceDetail() {
    const { id } = useParams<{ id: string }>();
    const deviceId = parseInt(id!);
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const { data: device } = trpc.admin.devices.get.useQuery({ id: deviceId });
    const { data: usage } = trpc.admin.devices.usage.useQuery({ deviceId, days: 30 });
    const { data: errors } = trpc.admin.devices.errors.useQuery({ deviceId, limit: 50 });
    const { data: apiKeys } = trpc.admin.apiKeys.list.useQuery();
    const { data: allDeployments } = trpc.admin.phraseSetDeployments.list.useQuery({});

    const [relayState, relaySend] = useDeviceRelay(deviceId);

    // ── Device identity ──────────────────────────────────────────────────────
    const [editName, setEditName] = useState('');
    const [editTag, setEditTag] = useState('');
    const [editApiKeyId, setEditApiKeyId] = useState<string>('');
    const [showNewKey, setShowNewKey] = useState(false);
    const [newKeyTitle, setNewKeyTitle] = useState('');
    const [newKeyJson, setNewKeyJson] = useState('');
    const [newKeyType, setNewKeyType] = useState<'google-v1' | 'google-v2'>('google-v2');
    const [deviceMsg, setDeviceMsg] = useState('');
    const [deviceError, setDeviceError] = useState('');

    // ── Display settings ─────────────────────────────────────────────────────
    const [display, setDisplay] = useState<DisplayLocal>(DEFAULT_DISPLAY);
    const [displayInitialized, setDisplayInitialized] = useState(false);
    const [displayMsg, setDisplayMsg] = useState('');

    // ── Transcription ────────────────────────────────────────────────────────
    const [engine, setEngine] = useState('googlev2');
    const [inputs, setInputs] = useState<RemoteInput[]>([]);
    const [transcriptionInitialized, setTranscriptionInitialized] = useState(false);
    const [transcriptionMsg, setTranscriptionMsg] = useState('');
    const [inputsMsg, setInputsMsg] = useState('');

    // ── Phrase sets ──────────────────────────────────────────────────────────
    const [selectedDepIds, setSelectedDepIds] = useState<number[]>([]);
    const [phraseMsg, setPhraseMsg] = useState('');
    const [phraseError, setPhraseError] = useState('');

    // Initialize from device data
    useEffect(() => {
        if (!device) return;
        setEditName(device.name);
        setEditTag(device.tag);
        setEditApiKeyId(device.apiKeyId ? String(device.apiKeyId) : '');
        const pushed = (device as any)?.pushedSettings?.transcription?.phraseSetDeploymentIds ?? [];
        setSelectedDepIds(pushed);
    }, [device?.id]);

    // Initialize display/transcription from relay config or offline settings
    useEffect(() => {
        if (!displayInitialized || relayState.config) {
            const src = (relayState.config ?? (device?.pushedSettings ?? device?.settings)) as { display?: Partial<DisplayLocal> } | null;
            if (src?.display) {
                setDisplay({
                    position: src.display.position ?? DEFAULT_DISPLAY.position,
                    size: src.display.size ?? DEFAULT_DISPLAY.size,
                    lines: src.display.lines ?? DEFAULT_DISPLAY.lines,
                    chromaKey: src.display.chromaKey ?? DEFAULT_DISPLAY.chromaKey,
                    timeout: src.display.timeout ?? DEFAULT_DISPLAY.timeout,
                    align: src.display.align ?? DEFAULT_DISPLAY.align,
                });
                setDisplayInitialized(true);
            }
        }
    }, [relayState.config, device]);

    useEffect(() => {
        if (!transcriptionInitialized || relayState.config) {
            const src = (relayState.config ?? (device?.pushedSettings ?? device?.settings)) as { transcription?: { engine?: string; inputs?: RemoteInput[] } } | null;
            if (src?.transcription) {
                setEngine(src.transcription.engine ?? 'googlev2');
                setInputs(src.transcription.inputs ? [...src.transcription.inputs] : []);
                setTranscriptionInitialized(true);
            }
        }
    }, [relayState.config, device]);

    // ── Mutations ─────────────────────────────────────────────────────────────
    const createApiKey = trpc.admin.apiKeys.create.useMutation({
        onSuccess: (newKey) => {
            utils.admin.apiKeys.list.invalidate();
            setEditApiKeyId(String(newKey.id));
            setShowNewKey(false);
            setNewKeyTitle('');
            setNewKeyJson('');
        },
    });

    const updateDevice = trpc.admin.devices.update.useMutation({
        onSuccess: () => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            utils.admin.devices.list.invalidate();
            setDeviceMsg('Saved');
            setDeviceError('');
            setTimeout(() => setDeviceMsg(''), 2000);
        },
        onError: e => { setDeviceError(e.message); setDeviceMsg(''); },
    });

    const regeneratePin = trpc.admin.devices.regeneratePin.useMutation({
        onSuccess: () => utils.admin.devices.get.invalidate({ id: deviceId }),
    });

    const saveSettings = trpc.admin.devices.saveSettings.useMutation({
        onSuccess: (_, variables) => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            const isDisplay = 'display' in variables.settings;
            const isTranscription = 'transcription' in variables.settings && !('inputs' in (variables.settings.transcription as object));
            const isInputs = 'transcription' in variables.settings && 'inputs' in (variables.settings.transcription as object);
            const msg = relayState.online ? 'Pushed to device' : 'Saved';
            if (isDisplay) { setDisplayMsg(msg); setTimeout(() => setDisplayMsg(''), 2500); }
            else if (isTranscription) { setTranscriptionMsg(msg); setTimeout(() => setTranscriptionMsg(''), 2500); }
            else if (isInputs) { setInputsMsg(msg); setTimeout(() => setInputsMsg(''), 2500); }
        },
    });

    const pushPhraseSets = trpc.admin.phraseSetDeployments.pushToDevice.useMutation({
        onSuccess: () => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            setPhraseMsg('Pushed to device');
            setPhraseError('');
            setTimeout(() => setPhraseMsg(''), 2500);
        },
        onError: e => { setPhraseError(e.message); setPhraseMsg(''); },
    });

    const clearErrors = trpc.admin.devices.clearErrors.useMutation({
        onSuccess: () => utils.admin.devices.errors.invalidate({ deviceId }),
    });

    const deleteDevice = trpc.admin.devices.delete.useMutation({
        onSuccess: () => navigate('/admin/devices'),
    });

    // ── Handlers ──────────────────────────────────────────────────────────────
    function sendDisplayLive(key: string, value: string) {
        if (relayState.online) relaySend({ type: 'set', key: `display.${key}`, value });
    }

    function handleSaveDisplay() {
        saveSettings.mutate({ deviceId, settings: { display } });
        if (relayState.online) relaySend({ type: 'pushSettings', settings: { display } });
    }

    function handleSaveTranscriptionEngine() {
        saveSettings.mutate({ deviceId, settings: { transcription: { engine } } });
        if (relayState.online) relaySend({ type: 'set', key: 'transcription.engine', value: engine });
    }

    function handleSaveInputs() {
        saveSettings.mutate({ deviceId, settings: { transcription: { inputs } } });
        if (relayState.online) {
            relaySend({ type: 'setInputs', inputs });
            relaySend({ type: 'restart' });
        }
    }

    function updateInput(index: number, patch: Partial<RemoteInput>) {
        setInputs(prev => { const next = [...prev]; next[index] = { ...next[index], ...patch }; return next; });
    }

    if (!device) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>;

    const physicalDevices: PhysicalDevice[] = relayState.physicalDevices;

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => navigate('/admin/devices')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">← Back</button>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{device.name}</h2>
                {device.tag && <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">{device.tag}</span>}
                <span className="text-sm text-gray-400">ID: {device.id}</span>
            </div>

            {/* Live Monitor + Usage */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <LiveSession state={relayState} send={relaySend} />
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Usage (last 30 days)</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Total: {usage?.total.toFixed(1) ?? 0} minutes</p>
                    <UsageChart rows={usage?.rows ?? []} />
                </div>
            </div>

            {/* Inputs card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Inputs</h3>
                    <button
                        onClick={() => setInputs(prev => [...prev, { ...DEFAULT_INPUT, id: Date.now() }])}
                        className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded px-2 py-1 hover:bg-blue-100"
                    >
                        + Add Input
                    </button>
                </div>

                {inputs.length === 0 && (
                    <p className="text-sm text-gray-400 mb-4">No inputs configured.</p>
                )}

                <div className="space-y-4">
                    {inputs.map((input, idx) => {
                        const vol = relayState.volumes.find(v => v.id === input.id);
                        const physDev = physicalDevices.find(d => d.id === input.device);
                        return (
                            <div key={input.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full border border-gray-300 dark:border-gray-500" style={{ background: input.color }} />
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                                            {input.speaker || `Input ${idx + 1}`}
                                        </span>
                                        {vol && <StateBadge state={vol.state} />}
                                    </div>
                                    <button onClick={() => setInputs(prev => prev.filter((_, i) => i !== idx))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                                </div>

                                {vol && (
                                    <div>
                                        <VolumeBar volume={vol.volume} threshold={vol.threshold} />
                                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                                            <span>Volume: {vol.volume.toFixed(0)}%</span>
                                            <span>Threshold: {vol.threshold.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Speaker</label>
                                        <input type="text" className={inpSm} value={input.speaker ?? ''} onChange={e => updateInput(idx, { speaker: e.target.value })} placeholder="Speaker name" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Device</label>
                                        <select className={inpSm} value={input.device} onChange={e => {
                                                const id = Number(e.target.value);
                                                const pd = physicalDevices.find(d => d.id === id);
                                                updateInput(idx, { device: id, deviceName: pd?.name });
                                            }}>
                                            {physicalDevices.length === 0 && <option value={input.device}>Device {input.device}</option>}
                                            {physicalDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Channel</label>
                                        <input type="number" className={inpSm} min={1} max={physDev?.inputChannels ?? 64}
                                            value={input.channel + 1} onChange={e => updateInput(idx, { channel: Math.max(0, Number(e.target.value) - 1) })} />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Color</label>
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded border border-gray-300 flex-shrink-0 cursor-pointer" style={{ background: input.color }}
                                                onClick={() => (document.getElementById(`color-${input.id}`) as HTMLInputElement)?.click()} />
                                            <input id={`color-${input.id}`} type="color" className="sr-only" value={input.color} onChange={e => updateInput(idx, { color: e.target.value })} />
                                            <input type="text" className={inpSm} value={input.color} onChange={e => updateInput(idx, { color: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Languages</label>
                                        <input type="text" className={inpSm} value={(input.languages ?? []).join(', ')}
                                            onChange={e => updateInput(idx, { languages: e.target.value.split(/[,\s]+/).map(l => l.trim()).filter(Boolean) })}
                                            placeholder="en-US" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Threshold</label>
                                        <div className="flex items-center gap-2">
                                            <input type="range" min={0} max={100} className="flex-1" value={input.threshold} disabled={input.autoThreshold}
                                                onChange={e => updateInput(idx, { threshold: Number(e.target.value) })} />
                                            <span className="text-xs text-gray-500 w-8 text-right">{input.threshold}</span>
                                        </div>
                                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                            <input type="checkbox" checked={input.autoThreshold ?? false} onChange={e => updateInput(idx, { autoThreshold: e.target.checked })} />
                                            Auto threshold
                                        </label>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <button
                        onClick={handleSaveInputs}
                        disabled={saveSettings.isPending}
                        className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saveSettings.isPending ? 'Saving...' : relayState.online ? 'Save & Apply' : 'Save (sync on next connection)'}
                    </button>
                    {relayState.online && <span className="text-xs text-gray-400">Will restart speech recognition</span>}
                    {inputsMsg && <span className="text-sm text-green-600 dark:text-green-400">{inputsMsg}</span>}
                </div>
            </div>

            {/* Settings card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 p-6 space-y-8">
                <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Settings</h3>

                {/* ── Device ─────────────────────────────────────────── */}
                <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Device</h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={inp} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tag / Event Code</label>
                            <input type="text" value={editTag} onChange={e => setEditTag(e.target.value)} className={inp} placeholder="e.g. MI2025FIM" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                            <select value={editApiKeyId} onChange={e => {
                                if (e.target.value === '__create__') setShowNewKey(true);
                                else { setEditApiKeyId(e.target.value); setShowNewKey(false); }
                            }} className={inp}>
                                <option value="">- None -</option>
                                {apiKeys?.map(k => <option key={k.id} value={k.id}>{k.title} ({k.keyType})</option>)}
                                <option value="__create__">+ Create new API key...</option>
                            </select>
                        </div>
                        {showNewKey && (
                            <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-4 space-y-3 bg-blue-50 dark:bg-blue-900/20">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">New API Key</p>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title</label>
                                    <input type="text" value={newKeyTitle} onChange={e => setNewKeyTitle(e.target.value)} className={inp} placeholder="e.g. FIRST Michigan 2025" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">JSON Credentials</label>
                                    <textarea value={newKeyJson} onChange={e => setNewKeyJson(e.target.value)} className={`${inp} font-mono`} rows={4}
                                        placeholder='{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}' />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Version</label>
                                    <select value={newKeyType} onChange={e => setNewKeyType(e.target.value as 'google-v1' | 'google-v2')} className={inp}>
                                        <option value="google-v2">Google Speech v2 (recommended)</option>
                                        <option value="google-v1">Google Speech v1 (legacy)</option>
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => createApiKey.mutate({ title: newKeyTitle, key: newKeyJson, keyType: newKeyType })}
                                        disabled={createApiKey.isPending || !newKeyTitle || !newKeyJson}
                                        className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                                        {createApiKey.isPending ? 'Creating...' : 'Create & Assign'}
                                    </button>
                                    <button onClick={() => setShowNewKey(false)}
                                        className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Device PIN</label>
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-lg tracking-widest text-gray-900 dark:text-white">{device.pin || '------'}</span>
                                <button onClick={() => { if (confirm('Generate a new PIN? The device will need to re-authenticate.')) regeneratePin.mutate({ id: deviceId }); }}
                                    disabled={regeneratePin.isPending} className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                                    {regeneratePin.isPending ? 'Regenerating...' : 'Regenerate'}
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                            <button onClick={() => updateDevice.mutate({ id: deviceId, name: editName || undefined, tag: editTag, apiKeyId: editApiKeyId ? parseInt(editApiKeyId) : null })}
                                disabled={updateDevice.isPending}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {updateDevice.isPending ? 'Saving...' : 'Save Device'}
                            </button>
                            {deviceMsg && <span className="text-sm text-green-600 dark:text-green-400">{deviceMsg}</span>}
                            {deviceError && <span className="text-sm text-red-600">{deviceError}</span>}
                        </div>
                    </div>
                </section>

                {/* ── Display ────────────────────────────────────────── */}
                <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Display</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Position</label>
                            <select className={inp} value={display.position} onChange={e => {
                                const v = Number(e.target.value);
                                setDisplay(s => ({ ...s, position: v }));
                                sendDisplayLive('position', String(v));
                            }}>
                                <option value={0}>Bottom</option>
                                <option value={1}>Top</option>
                                <option value={2}>Bottom (audience)</option>
                                <option value={3}>Top (audience)</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Alignment</label>
                            <select className={inp} value={display.align} onChange={e => {
                                const v = e.target.value;
                                setDisplay(s => ({ ...s, align: v }));
                                sendDisplayLive('align', v);
                            }}>
                                <option value="left">Left</option>
                                <option value="center">Center</option>
                                <option value="right">Right</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Chroma Key</label>
                            <input type="text" className={inp} value={display.chromaKey}
                                onChange={e => setDisplay(s => ({ ...s, chromaKey: e.target.value }))}
                                onBlur={e => sendDisplayLive('chromaKey', e.target.value)} placeholder="#00B140" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Text Size (px)</label>
                            <input type="number" className={inp} value={display.size}
                                onChange={e => setDisplay(s => ({ ...s, size: Number(e.target.value) }))}
                                onBlur={e => sendDisplayLive('size', e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Max Lines</label>
                            <input type="number" className={inp} value={display.lines}
                                onChange={e => setDisplay(s => ({ ...s, lines: Number(e.target.value) }))}
                                onBlur={e => sendDisplayLive('lines', e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Timeout (s)</label>
                            <input type="number" className={inp} value={display.timeout}
                                onChange={e => setDisplay(s => ({ ...s, timeout: Number(e.target.value) }))}
                                onBlur={e => sendDisplayLive('timeout', e.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                        <button onClick={() => relaySend({ type: 'hide', value: !(relayState.config?.display.hidden) })}
                            className="bg-gray-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-700">
                            {relayState.config?.display.hidden ? 'Show Captions' : 'Hide Captions'}
                        </button>
                        <button onClick={() => relaySend({ type: 'clear' })}
                            className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-300 dark:hover:bg-gray-600">
                            Clear Captions
                        </button>
                        <button onClick={() => relaySend({ type: 'reloadDisplay' })} disabled={!relayState.online}
                            className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                            Refresh Display Clients
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleSaveDisplay} disabled={saveSettings.isPending}
                            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                            {saveSettings.isPending ? 'Saving...' : relayState.online ? 'Save & Push' : 'Save (sync on next connection)'}
                        </button>
                        {displayMsg && <span className="text-sm text-green-600 dark:text-green-400">{displayMsg}</span>}
                    </div>
                </section>

                {/* ── Transcription Engine ────────────────────────────── */}
                <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Transcription Engine</h4>
                    <div className="flex flex-col gap-1 mb-4 max-w-xs">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Engine</label>
                        <select className={inp} value={engine} onChange={e => setEngine(e.target.value)}>
                            <option value="googlev1">Google V1</option>
                            <option value="googlev2">Google V2</option>
                            <option value="april">April ASR</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 mb-4">
                        <input
                            type="checkbox"
                            id="watchdogEnabled"
                            checked={(relayState.config?.transcription as any)?.watchdogEnabled ?? true}
                            onChange={e => {
                                if (relayState.online) relaySend({ type: 'set', key: 'transcription.watchdogEnabled', value: String(e.target.checked) });
                                saveSettings.mutate({ deviceId, settings: { transcription: { watchdogEnabled: e.target.checked } } });
                            }}
                        />
                        <label htmlFor="watchdogEnabled" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                            Watchdog (auto-restart if mic active ~45s with no captions)
                        </label>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleSaveTranscriptionEngine} disabled={saveSettings.isPending}
                            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                            {saveSettings.isPending ? 'Saving...' : relayState.online ? 'Save & Push' : 'Save (sync on next connection)'}
                        </button>
                        {transcriptionMsg && <span className="text-sm text-green-600 dark:text-green-400">{transcriptionMsg}</span>}
                    </div>
                </section>

                {/* ── Phrase Sets ─────────────────────────────────────── */}
                {allDeployments && allDeployments.length > 0 && (
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Phrase Sets</h4>
                        <p className="text-xs text-gray-400 mb-2">Select phrase sets to use for transcription on this device.</p>
                        <PhraseSetMultiSelect
                            deployments={allDeployments}
                            selectedIds={selectedDepIds}
                            onChange={setSelectedDepIds}
                        />
                        <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => pushPhraseSets.mutate({ deviceId, deploymentIds: selectedDepIds })}
                                disabled={pushPhraseSets.isPending}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {pushPhraseSets.isPending ? 'Pushing...' : relayState.online ? 'Save & Push' : 'Save (sync on next connection)'}
                            </button>
                            {phraseMsg && <span className="text-sm text-green-600 dark:text-green-400">{phraseMsg}</span>}
                            {phraseError && <span className="text-sm text-red-600">{phraseError}</span>}
                        </div>
                    </section>
                )}
            </div>

            {/* Error logs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Error Logs</h3>
                    {!!errors?.length && (
                        <button onClick={() => { if (confirm('Clear all error logs for this device?')) clearErrors.mutate({ deviceId }); }}
                            disabled={clearErrors.isPending} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50">
                            Clear all
                        </button>
                    )}
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-96 overflow-auto">
                    {errors?.map(e => (
                        <div key={e.id} className="px-6 py-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-red-700 dark:text-red-400 font-medium">{e.message}</p>
                                <span className="text-xs text-gray-400">{new Date(e.occurredAt).toLocaleString()}</span>
                            </div>
                            {e.context && Object.keys(e.context as object).length > 0 && (
                                <pre className="text-xs text-gray-500 dark:text-gray-400 mt-1 overflow-x-auto">{JSON.stringify(e.context, null, 2)}</pre>
                            )}
                        </div>
                    ))}
                    {!errors?.length && (
                        <div className="px-6 py-8 text-center text-gray-400 text-sm">No errors logged</div>
                    )}
                </div>
            </div>

            {/* Danger zone */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-red-100 dark:border-red-900">
                <h3 className="font-semibold text-red-700 dark:text-red-400 mb-3">Danger Zone</h3>
                <button onClick={() => { if (confirm(`Permanently delete "${device.name}"?`)) deleteDevice.mutate({ id: deviceId }); }}
                    className="bg-red-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-red-700">
                    Delete Device
                </button>
            </div>
        </div>
    );
}
