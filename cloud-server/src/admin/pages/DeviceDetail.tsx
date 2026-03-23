import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trpc } from '../api';
import { useDeviceRelay } from '../hooks/useDeviceRelay';
import { LiveSession } from '../components/LiveSession';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

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

type SettingsTab = 'display' | 'transcription';

type LocalSettings = {
    display: {
        position: number;
        size: number;
        lines: number;
        chromaKey: string;
        timeout: number;
        align: 'left' | 'center' | 'right';
    };
    transcription: {
        engine: 'googlev1' | 'googlev2' | 'april';
        phraseSets: string;
    };
};

const DEFAULTS: LocalSettings = {
    display: { position: 0, size: 42, lines: 2, chromaKey: '#00B140', timeout: 5, align: 'center' },
    transcription: { engine: 'googlev2', phraseSets: '' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initFromSettings(settings: any): LocalSettings {
    return {
        display: {
            position: settings?.display?.position ?? DEFAULTS.display.position,
            size: settings?.display?.size ?? DEFAULTS.display.size,
            lines: settings?.display?.lines ?? DEFAULTS.display.lines,
            chromaKey: settings?.display?.chromaKey ?? DEFAULTS.display.chromaKey,
            timeout: settings?.display?.timeout ?? DEFAULTS.display.timeout,
            align: settings?.display?.align ?? DEFAULTS.display.align,
        },
        transcription: {
            engine: settings?.transcription?.engine ?? DEFAULTS.transcription.engine,
            phraseSets: Array.isArray(settings?.transcription?.phraseSets)
                ? settings.transcription.phraseSets.join('\n')
                : DEFAULTS.transcription.phraseSets,
        },
    };
}

function Field({ label, supporting, children }: { label: string; supporting?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</label>
            {React.Children.map(children, child =>
                React.isValidElement(child)
                    ? React.cloneElement(child as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
                        className: `w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white ${(child.props as React.HTMLAttributes<HTMLElement>).className ?? ''}`,
                    })
                    : child
            )}
            {supporting && <span className="text-xs text-gray-400 dark:text-gray-500">{supporting}</span>}
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

    const [editName, setEditName] = useState('');
    const [editTag, setEditTag] = useState('');
    const [editPin, setEditPin] = useState('');
    const [editApiKeyId, setEditApiKeyId] = useState<string>('');
    const [showNewKey, setShowNewKey] = useState(false);
    const [newKeyTitle, setNewKeyTitle] = useState('');
    const [newKeyJson, setNewKeyJson] = useState('');
    const [newKeyType, setNewKeyType] = useState<'google-v1' | 'google-v2'>('google-v2');
    const [updateMsg, setUpdateMsg] = useState('');
    const [updateError, setUpdateError] = useState('');

    const [settingsTab, setSettingsTab] = useState<SettingsTab>('display');
    const [settings, setSettings] = useState<LocalSettings>(DEFAULTS);
    const [pushMsg, setPushMsg] = useState('');
    const [pushError, setPushError] = useState('');

    useEffect(() => {
        if (device) {
            setEditName(device.name);
            setEditTag(device.tag);
            setEditApiKeyId(device.apiKeyId ? String(device.apiKeyId) : '');
            setSettings(initFromSettings(device.settings));
        }
    }, [device?.id]);

    const [relayState, relaySend] = useDeviceRelay(deviceId);

    const createApiKey = trpc.admin.apiKeys.create.useMutation({
        onSuccess: (newKey) => {
            utils.admin.apiKeys.list.invalidate();
            setEditApiKeyId(String(newKey.id));
            setShowNewKey(false);
            setNewKeyTitle('');
            setNewKeyJson('');
        },
    });

    const update = trpc.admin.devices.update.useMutation({
        onSuccess: () => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            utils.admin.devices.list.invalidate();
            setUpdateMsg('Saved');
            setUpdateError('');
            setTimeout(() => setUpdateMsg(''), 2000);
        },
        onError: e => { setUpdateError(e.message); setUpdateMsg(''); },
    });

    const pushSettings = trpc.admin.devices.pushSettings.useMutation({
        onSuccess: () => {
            utils.admin.devices.get.invalidate({ id: deviceId });
            setPushError('');
            setPushMsg('Queued - device will apply on next heartbeat');
            setTimeout(() => setPushMsg(''), 4000);
        },
        onError: (e) => setPushError(e.message),
    });

    const deleteDevice = trpc.admin.devices.delete.useMutation({
        onSuccess: () => navigate('/admin/devices'),
    });

    function setDisplay<K extends keyof LocalSettings['display']>(key: K, value: LocalSettings['display'][K]) {
        setSettings(s => ({ ...s, display: { ...s.display, [key]: value } }));
    }

    function setTranscription<K extends keyof LocalSettings['transcription']>(key: K, value: LocalSettings['transcription'][K]) {
        setSettings(s => ({ ...s, transcription: { ...s.transcription, [key]: value } }));
    }

    function handleSave() {
        update.mutate({
            id: deviceId,
            name: editName || undefined,
            tag: editTag,
            pin: editPin || undefined,
            apiKeyId: editApiKeyId ? parseInt(editApiKeyId) : null,
        });
    }

    function handleCreateAndAssignKey() {
        createApiKey.mutate({ title: newKeyTitle, key: newKeyJson, keyType: newKeyType });
    }

    function handlePushSettings() {
        pushSettings.mutate({
            deviceId,
            settings: {
                display: { ...settings.display },
                transcription: {
                    engine: settings.transcription.engine,
                    phraseSets: settings.transcription.phraseSets.split('\n').map(s => s.trim()).filter(Boolean),
                },
            },
        });
    }

    if (!device) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>;

    return (
        <div className="max-w-4xl">
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => navigate('/admin/devices')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">- Back</button>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{device.name}</h2>
                {device.tag && <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">{device.tag}</span>}
                <span className="text-sm text-gray-400">ID: {device.id}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Device credentials */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Device Settings</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={inp} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tag / Event Code</label>
                            <input type="text" value={editTag} onChange={e => setEditTag(e.target.value)}
                                className={inp} placeholder="e.g. MI2025FIM" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">New PIN (leave blank to keep)</label>
                            <input type="text" value={editPin} onChange={e => setEditPin(e.target.value)}
                                className={inp} placeholder="••••" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                            <select value={editApiKeyId} onChange={e => {
                                if (e.target.value === '__create__') { setShowNewKey(true); }
                                else { setEditApiKeyId(e.target.value); setShowNewKey(false); }
                            }} className={inp}>
                                <option value="">- None -</option>
                                {apiKeys?.map(k => (
                                    <option key={k.id} value={k.id}>{k.title} ({k.keyType})</option>
                                ))}
                                <option value="__create__">+ Create new API key...</option>
                            </select>
                        </div>
                        {showNewKey && (
                            <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-4 space-y-3 bg-blue-50 dark:bg-blue-900/20">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">New API Key</p>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title</label>
                                    <input type="text" value={newKeyTitle} onChange={e => setNewKeyTitle(e.target.value)}
                                        className={inp} placeholder="e.g. FIRST Michigan 2025" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">JSON Credentials</label>
                                    <textarea value={newKeyJson} onChange={e => setNewKeyJson(e.target.value)}
                                        className={`${inp} font-mono`} rows={4}
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
                                    <button
                                        onClick={handleCreateAndAssignKey}
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
                        <div className="flex items-center gap-3 pt-1">
                            <button onClick={handleSave} disabled={update.isPending}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                Save
                            </button>
                            {updateMsg && <span className="text-sm text-green-600 dark:text-green-400">{updateMsg}</span>}
                            {updateError && <span className="text-sm text-red-600">{updateError}</span>}
                        </div>
                    </div>
                </div>

                {/* Usage */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Usage (last 30 days)</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Total: {usage?.total.toFixed(1) ?? 0} minutes</p>
                    <UsageChart rows={usage?.rows ?? []} />
                </div>
            </div>

            {/* Live Session */}
            <LiveSession deviceId={deviceId} state={relayState} send={relaySend} />

            {/* Push settings (collapsible, queued for offline use) */}
            <details className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 group">
                <summary className="px-6 py-4 cursor-pointer list-none flex items-center justify-between select-none">
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white inline">Push Settings</h3>
                        <span className="text-xs text-gray-400 ml-2">(queued, for offline use)</span>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Applied on next heartbeat (within 5 minutes){device.settings ? ' - showing last pushed values' : ''}
                        </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </summary>

                <div className="border-t border-gray-200 dark:border-gray-700">
                    <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
                        {(['display', 'transcription'] as SettingsTab[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setSettingsTab(tab)}
                                className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
                                    settingsTab === tab
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                            >{tab}</button>
                        ))}
                    </div>

                    <div className="p-6">
                        {settingsTab === 'display' && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                <Field label="Position">
                                    <select value={settings.display.position} onChange={e => setDisplay('position', Number(e.target.value))}>
                                        <option value={0}>Bottom</option>
                                        <option value={1}>Top</option>
                                        <option value={2}>Bottom (audience space)</option>
                                        <option value={3}>Top (audience space)</option>
                                    </select>
                                </Field>
                                <Field label="Alignment">
                                    <select value={settings.display.align} onChange={e => setDisplay('align', e.target.value as 'left' | 'center' | 'right')}>
                                        <option value="left">Left</option>
                                        <option value="center">Center</option>
                                        <option value="right">Right</option>
                                    </select>
                                </Field>
                                <Field label="Chroma Key">
                                    <input type="text" value={settings.display.chromaKey} onChange={e => setDisplay('chromaKey', e.target.value)} placeholder="#00B140" />
                                </Field>
                                <Field label="Text Size (px)">
                                    <input type="number" value={settings.display.size} onChange={e => setDisplay('size', Number(e.target.value))} />
                                </Field>
                                <Field label="Max Lines">
                                    <input type="number" value={settings.display.lines} onChange={e => setDisplay('lines', Number(e.target.value))} />
                                </Field>
                                <Field label="Timeout (s)">
                                    <input type="number" value={settings.display.timeout} onChange={e => setDisplay('timeout', Number(e.target.value))} />
                                </Field>
                            </div>
                        )}

                        {settingsTab === 'transcription' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Field label="Transcription Engine">
                                    <select value={settings.transcription.engine} onChange={e => setTranscription('engine', e.target.value as 'googlev1' | 'googlev2' | 'april')}>
                                        <option value="googlev1">Google V1</option>
                                        <option value="googlev2">Google V2</option>
                                        <option value="april">April ASR (local) - Beta</option>
                                    </select>
                                </Field>
                                <Field label="Phrase Sets" supporting="One per line. Must be configured in GCloud.">
                                    <textarea
                                        value={settings.transcription.phraseSets}
                                        onChange={e => setTranscription('phraseSets', e.target.value)}
                                        rows={4}
                                        className="font-mono resize-y"
                                    />
                                </Field>
                            </div>
                        )}

                        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                            <button onClick={handlePushSettings} disabled={pushSettings.isPending}
                                className="bg-orange-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-50">
                                {pushSettings.isPending ? 'Queuing...' : 'Push Settings to Device'}
                            </button>
                            {pushMsg && <span className="text-sm text-green-600 dark:text-green-400">{pushMsg}</span>}
                            {pushError && <span className="text-sm text-red-600">{pushError}</span>}
                        </div>
                    </div>
                </div>
            </details>

            {/* Error logs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Recent Error Logs</h3>
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
                <button
                    onClick={() => { if (confirm(`Permanently delete "${device.name}"?`)) deleteDevice.mutate({ id: deviceId }); }}
                    className="bg-red-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-red-700"
                >
                    Delete Device
                </button>
            </div>
        </div>
    );
}
