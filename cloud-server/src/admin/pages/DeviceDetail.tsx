import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trpc } from '../api';

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

    const [editName, setEditName] = useState('');
    const [editPin, setEditPin] = useState('');
    const [editApiKey, setEditApiKey] = useState('');
    const [settingsJson, setSettingsJson] = useState('{\n  \n}');
    const [pushError, setPushError] = useState('');
    const [updateMsg, setUpdateMsg] = useState('');

    const update = trpc.admin.devices.update.useMutation({
        onSuccess: () => { utils.admin.devices.get.invalidate({ id: deviceId }); setUpdateMsg('Saved'); setTimeout(() => setUpdateMsg(''), 2000); },
    });

    const pushSettings = trpc.admin.devices.pushSettings.useMutation({
        onSuccess: () => { setPushError(''); alert('Settings queued — device will apply on next heartbeat'); },
        onError: (e) => setPushError(e.message),
    });

    const deleteDevice = trpc.admin.devices.delete.useMutation({
        onSuccess: () => navigate('/admin/devices'),
    });

    function handlePushSettings() {
        try {
            const settings = JSON.parse(settingsJson);
            pushSettings.mutate({ deviceId, settings });
        } catch {
            setPushError('Invalid JSON');
        }
    }

    if (!device) return <div className="text-gray-500">Loading...</div>;

    return (
        <div className="max-w-4xl">
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => navigate('/admin/devices')} className="text-gray-400 hover:text-gray-600 text-sm">← Back</button>
                <h2 className="text-2xl font-bold text-gray-900">{device.name}</h2>
                <span className="text-sm text-gray-400">ID: {device.id}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Device settings */}
                <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Device Settings</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                            <input type="text" defaultValue={device.name} onChange={e => setEditName(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">New PIN (leave blank to keep)</label>
                            <input type="text" value={editPin} onChange={e => setEditPin(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Google API Key JSON (leave blank to keep)</label>
                            <textarea value={editApiKey} onChange={e => setEditApiKey(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3} placeholder='{"type":"service_account",...}' />
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => update.mutate({ id: deviceId, name: editName || undefined, pin: editPin || undefined, apiKey: editApiKey || undefined })}
                                disabled={update.isPending}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >Save</button>
                            {updateMsg && <span className="text-sm text-green-600">{updateMsg}</span>}
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="font-semibold text-gray-900 mb-1">Usage (last 30 days)</h3>
                    <p className="text-sm text-gray-500 mb-4">Total: {usage?.total.toFixed(1) ?? 0} minutes</p>
                    <UsageChart rows={usage?.rows ?? []} />
                </div>
            </div>

            {/* Push settings */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="font-semibold text-gray-900 mb-1">Push Settings to Device</h3>
                <p className="text-sm text-gray-500 mb-3">Settings will be applied on the device's next heartbeat (within 5 minutes).</p>
                <textarea
                    value={settingsJson}
                    onChange={e => setSettingsJson(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                    rows={8}
                    placeholder='{"display":{"size":42},"transcription":{"engine":"googlev2"}}'
                />
                {pushError && <p className="text-sm text-red-600 mb-2">{pushError}</p>}
                <button onClick={handlePushSettings} disabled={pushSettings.isPending}
                    className="bg-orange-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-50">
                    {pushSettings.isPending ? 'Queuing...' : 'Queue Settings Push'}
                </button>
            </div>

            {/* Error logs */}
            <div className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-900">Recent Error Logs</h3>
                </div>
                <div className="divide-y divide-gray-50 max-h-96 overflow-auto">
                    {errors?.map(e => (
                        <div key={e.id} className="px-6 py-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-red-700 font-medium">{e.message}</p>
                                <span className="text-xs text-gray-400">{new Date(e.occurredAt).toLocaleString()}</span>
                            </div>
                            {e.context && Object.keys(e.context as object).length > 0 && (
                                <pre className="text-xs text-gray-500 mt-1 overflow-x-auto">{JSON.stringify(e.context, null, 2)}</pre>
                            )}
                        </div>
                    ))}
                    {!errors?.length && (
                        <div className="px-6 py-8 text-center text-gray-400 text-sm">No errors logged</div>
                    )}
                </div>
            </div>

            {/* Danger zone */}
            <div className="bg-white rounded-lg shadow p-6 mt-6 border border-red-100">
                <h3 className="font-semibold text-red-700 mb-3">Danger Zone</h3>
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
