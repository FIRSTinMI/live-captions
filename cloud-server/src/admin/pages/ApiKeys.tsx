import React, { useState } from 'react';
import { trpc } from '../api';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

function ApiKeyModal({
    initial,
    onClose,
    onSave,
    isPending,
    error,
}: {
    initial?: { title: string; keyType: 'google-v1' | 'google-v2' };
    onClose: () => void;
    onSave: (data: { title: string; key: string; keyType: 'google-v1' | 'google-v2' }) => void;
    isPending: boolean;
    error: string;
}) {
    const [title, setTitle] = useState(initial?.title ?? '');
    const [key, setKey] = useState('');
    const [keyType, setKeyType] = useState<'google-v1' | 'google-v2'>(initial?.keyType ?? 'google-v2');

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    {initial ? 'Edit API Key' : 'Add API Key'}
                </h3>
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                            className={inp} placeholder="e.g. FIRST Michigan 2025" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {initial ? 'New JSON Credentials (leave blank to keep existing)' : 'JSON Credentials'}
                        </label>
                        <textarea value={key} onChange={e => setKey(e.target.value)}
                            className={`${inp} font-mono`} rows={6}
                            placeholder={'{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}'} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Version</label>
                        <select value={keyType} onChange={e => setKeyType(e.target.value as 'google-v1' | 'google-v2')}
                            className={inp}>
                            <option value="google-v2">Google Speech v2 (recommended)</option>
                            <option value="google-v1">Google Speech v1 (legacy)</option>
                        </select>
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <div className="flex gap-3 mt-5">
                    <button onClick={onClose}
                        className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave({ title, key, keyType })}
                        disabled={isPending || !title || (!initial && !key)}
                        className="flex-1 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {isPending ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ApiKeys() {
    const utils = trpc.useUtils();
    const { data: apiKeys, isLoading } = trpc.admin.apiKeys.list.useQuery();
    const [showCreate, setShowCreate] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [createError, setCreateError] = useState('');
    const [editError, setEditError] = useState('');

    const create = trpc.admin.apiKeys.create.useMutation({
        onSuccess: () => { utils.admin.apiKeys.list.invalidate(); setShowCreate(false); setCreateError(''); },
        onError: e => setCreateError(e.message),
    });

    const update = trpc.admin.apiKeys.update.useMutation({
        onSuccess: () => { utils.admin.apiKeys.list.invalidate(); setEditId(null); setEditError(''); },
        onError: e => setEditError(e.message),
    });

    const deleteKey = trpc.admin.apiKeys.delete.useMutation({
        onSuccess: () => utils.admin.apiKeys.list.invalidate(),
    });

    const editingKey = editId ? apiKeys?.find(k => k.id === editId) : null;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h2>
                <button onClick={() => setShowCreate(true)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                    + Add API Key
                </button>
            </div>

            {showCreate && (
                <ApiKeyModal
                    onClose={() => { setShowCreate(false); setCreateError(''); }}
                    onSave={data => create.mutate(data)}
                    isPending={create.isPending}
                    error={createError}
                />
            )}

            {editingKey && (
                <ApiKeyModal
                    initial={{ title: editingKey.title, keyType: editingKey.keyType }}
                    onClose={() => { setEditId(null); setEditError(''); }}
                    onSave={({ title, key, keyType }) => update.mutate({
                        id: editId!,
                        title: title || undefined,
                        key: key || undefined,
                        keyType,
                    })}
                    isPending={update.isPending}
                    error={editError}
                />
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                            <th className="px-6 py-3 font-medium">Title</th>
                            <th className="px-6 py-3 font-medium">Type</th>
                            <th className="px-6 py-3 font-medium">Devices</th>
                            <th className="px-6 py-3 font-medium">Updated</th>
                            <th className="px-6 py-3 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
                        )}
                        {apiKeys?.map(k => (
                            <tr key={k.id} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{k.title}</td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{k.keyType}</td>
                                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                                    {k.deviceCount} {k.deviceCount === 1 ? 'device' : 'devices'}
                                </td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400">
                                    {new Date(k.updatedAt).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-3 flex gap-3">
                                    <button onClick={() => setEditId(k.id)}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                                    <button
                                        onClick={() => {
                                            if (k.deviceCount > 0) {
                                                if (!confirm(`This key is assigned to ${k.deviceCount} device(s). Delete anyway?`)) return;
                                            }
                                            deleteKey.mutate({ id: k.id });
                                        }}
                                        className="text-xs text-red-500 hover:text-red-700">Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && !apiKeys?.length && (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                                No API keys yet. Click "+ Add API Key" to create one.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
