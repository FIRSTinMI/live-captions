import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../api';

function relativeTime(date: Date | string | null): string {
    if (!date) return 'Never';
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

function CreateDeviceModal({ onClose }: { onClose: () => void }) {
    const utils = trpc.useUtils();
    const [form, setForm] = useState({ name: '', pin: '', apiKey: '', apiKeyType: 'google-v2' as 'google-v1' | 'google-v2' });
    const [error, setError] = useState('');

    const create = trpc.admin.devices.create.useMutation({
        onSuccess: () => { utils.admin.devices.list.invalidate(); onClose(); },
        onError: (e) => setError(e.message),
    });

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Device</h3>
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
                        <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="AV Cart 1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">PIN (min 4 chars)</label>
                        <input type="text" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1234" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Google API Key (JSON credentials)</label>
                        <textarea value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" rows={5} placeholder='{"type":"service_account",...}' />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Version</label>
                        <select value={form.apiKeyType} onChange={e => setForm(f => ({ ...f, apiKeyType: e.target.value as any }))}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="google-v2">Google Speech v2 (recommended)</option>
                            <option value="google-v1">Google Speech v1 (legacy)</option>
                        </select>
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <div className="flex gap-3 mt-5">
                    <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 rounded px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={() => create.mutate(form)} disabled={create.isPending}
                        className="flex-1 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {create.isPending ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function Devices() {
    const { data: devices, isLoading } = trpc.admin.devices.list.useQuery();
    const utils = trpc.useUtils();
    const deleteDevice = trpc.admin.devices.delete.useMutation({
        onSuccess: () => utils.admin.devices.list.invalidate(),
    });
    const [showCreate, setShowCreate] = useState(false);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Devices</h2>
                <button onClick={() => setShowCreate(true)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                    + Add Device
                </button>
            </div>

            {showCreate && <CreateDeviceModal onClose={() => setShowCreate(false)} />}

            <div className="bg-white rounded-lg shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-200">
                            <th className="px-6 py-3 font-medium">Name</th>
                            <th className="px-6 py-3 font-medium">API</th>
                            <th className="px-6 py-3 font-medium">Last Seen</th>
                            <th className="px-6 py-3 font-medium">Last Heartbeat</th>
                            <th className="px-6 py-3 font-medium">Today (min)</th>
                            <th className="px-6 py-3 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
                        )}
                        {devices?.map(d => (
                            <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="px-6 py-3">
                                    <Link to={`/admin/devices/${d.id}`} className="text-blue-600 hover:underline font-medium">{d.name}</Link>
                                </td>
                                <td className="px-6 py-3 text-gray-500">{d.apiKeyType}</td>
                                <td className="px-6 py-3 text-gray-500">{relativeTime(d.lastSeenAt)}</td>
                                <td className="px-6 py-3 text-gray-500">{relativeTime(d.lastHeartbeatAt)}</td>
                                <td className="px-6 py-3 text-gray-700">{d.todayMinutes.toFixed(1)}</td>
                                <td className="px-6 py-3">
                                    <button
                                        onClick={() => { if (confirm(`Delete "${d.name}"?`)) deleteDevice.mutate({ id: d.id }); }}
                                        className="text-red-500 hover:text-red-700 text-xs"
                                    >Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && !devices?.length && (
                            <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No devices yet. Click "+ Add Device" to create one.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
