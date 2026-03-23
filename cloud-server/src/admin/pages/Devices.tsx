import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../api';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

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
    const { data: apiKeys } = trpc.admin.apiKeys.list.useQuery();
    const [form, setForm] = useState({ name: '', tag: '', pin: '', apiKeyId: '' });
    const [error, setError] = useState('');

    const create = trpc.admin.devices.create.useMutation({
        onSuccess: () => { utils.admin.devices.list.invalidate(); onClose(); },
        onError: (e) => setError(e.message),
    });

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add Device</h3>
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Device Name</label>
                        <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            className={inp} placeholder="AV Cart 1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tag / Event Code</label>
                        <input type="text" value={form.tag} onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}
                            className={inp} placeholder="e.g. MI2025FIM" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PIN (min 4 chars)</label>
                        <input type="text" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                            className={inp} placeholder="1234" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
                        <select value={form.apiKeyId} onChange={e => setForm(f => ({ ...f, apiKeyId: e.target.value }))}
                            className={inp}>
                            <option value="">- None -</option>
                            {apiKeys?.map(k => (
                                <option key={k.id} value={k.id}>{k.title} ({k.keyType})</option>
                            ))}
                        </select>
                        {!apiKeys?.length && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                No API keys yet - <Link to="/admin/api-keys" className="text-blue-500 hover:underline">create one first</Link>
                            </p>
                        )}
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <div className="flex gap-3 mt-5">
                    <button onClick={onClose}
                        className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        Cancel
                    </button>
                    <button
                        onClick={() => create.mutate({
                            name: form.name,
                            tag: form.tag,
                            pin: form.pin,
                            apiKeyId: form.apiKeyId ? parseInt(form.apiKeyId) : null,
                        })}
                        disabled={create.isPending}
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
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Devices</h2>
                <button onClick={() => setShowCreate(true)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                    + Add Device
                </button>
            </div>

            {showCreate && <CreateDeviceModal onClose={() => setShowCreate(false)} />}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                            <th className="px-6 py-3 font-medium">Name</th>
                            <th className="px-6 py-3 font-medium">Tag</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                            <th className="px-6 py-3 font-medium">API Key</th>
                            <th className="px-6 py-3 font-medium">Last Seen</th>
                            <th className="px-6 py-3 font-medium">Last Heartbeat</th>
                            <th className="px-6 py-3 font-medium">Today (min)</th>
                            <th className="px-6 py-3 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
                        )}
                        {devices?.map(d => (
                            <tr key={d.id} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <td className="px-6 py-3">
                                    <Link to={`/admin/devices/${d.id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{d.name}</Link>
                                </td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">{d.tag || '-'}</td>
                                <td className="px-6 py-3">
                                    {d.online
                                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 rounded-full px-2 py-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Online
                                          </span>
                                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />Offline
                                          </span>
                                    }
                                </td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">
                                    {d.apiKeyTitle ?? <span className="text-gray-300 dark:text-gray-600">None</span>}
                                </td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{relativeTime(d.lastSeenAt)}</td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{relativeTime(d.lastHeartbeatAt)}</td>
                                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{d.todayMinutes.toFixed(1)}</td>
                                <td className="px-6 py-3">
                                    <button
                                        onClick={() => { if (confirm(`Delete "${d.name}"?`)) deleteDevice.mutate({ id: d.id }); }}
                                        className="text-red-500 hover:text-red-700 text-xs"
                                    >Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && !devices?.length && (
                            <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">No devices yet. Click "+ Add Device" to create one.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
