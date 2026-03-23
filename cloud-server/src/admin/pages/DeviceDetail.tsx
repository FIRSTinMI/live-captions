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
    const [editApiKeyId, setEditApiKeyId] = useState<string>('');
    const [showNewKey, setShowNewKey] = useState(false);
    const [newKeyTitle, setNewKeyTitle] = useState('');
    const [newKeyJson, setNewKeyJson] = useState('');
    const [newKeyType, setNewKeyType] = useState<'google-v1' | 'google-v2'>('google-v2');
    const [updateMsg, setUpdateMsg] = useState('');
    const [updateError, setUpdateError] = useState('');

    useEffect(() => {
        if (device) {
            setEditName(device.name);
            setEditTag(device.tag);
            setEditApiKeyId(device.apiKeyId ? String(device.apiKeyId) : '');
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

    const regeneratePin = trpc.admin.devices.regeneratePin.useMutation({
        onSuccess: () => utils.admin.devices.get.invalidate({ id: deviceId }),
    });

    const clearErrors = trpc.admin.devices.clearErrors.useMutation({
        onSuccess: () => utils.admin.devices.errors.invalidate({ deviceId }),
    });

    const deleteDevice = trpc.admin.devices.delete.useMutation({
        onSuccess: () => navigate('/admin/devices'),
    });

    function handleSave() {
        update.mutate({
            id: deviceId,
            name: editName || undefined,
            tag: editTag,
            apiKeyId: editApiKeyId ? parseInt(editApiKeyId) : null,
        });
    }

    function handleCreateAndAssignKey() {
        createApiKey.mutate({ title: newKeyTitle, key: newKeyJson, keyType: newKeyType });
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
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Device PIN</label>
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-lg tracking-widest text-gray-900 dark:text-white">{device.pin || '------'}</span>
                                <button
                                    onClick={() => { if (confirm('Generate a new PIN? The device will need to re-authenticate.')) regeneratePin.mutate({ id: deviceId }); }}
                                    disabled={regeneratePin.isPending}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                >
                                    {regeneratePin.isPending ? 'Regenerating...' : 'Regenerate'}
                                </button>
                            </div>
                        </div>
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
            <LiveSession deviceId={deviceId} state={relayState} send={relaySend} offlineSettings={device.pushedSettings ?? device.settings} />

            {/* Error logs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Error Logs</h3>
                    {!!errors?.length && (
                        <button
                            onClick={() => { if (confirm('Clear all error logs for this device?')) clearErrors.mutate({ deviceId }); }}
                            disabled={clearErrors.isPending}
                            className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
                        >
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
