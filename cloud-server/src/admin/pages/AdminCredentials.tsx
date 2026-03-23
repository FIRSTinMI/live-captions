import React, { useState } from 'react';
import { trpc } from '../api';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

const ROLE_BADGE: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    client: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

export function AdminCredentials() {
    const utils = trpc.useUtils();
    const { data: creds, isLoading } = trpc.admin.adminCredentials.list.useQuery();

    const [showForm, setShowForm] = useState(false);
    const [label, setLabel] = useState('');
    const [role, setRole] = useState<'admin' | 'client'>('admin');
    const [projectId, setProjectId] = useState('');
    const [credentialsJson, setCredentialsJson] = useState('');
    const [createError, setCreateError] = useState('');

    const [discoverMsg, setDiscoverMsg] = useState<Record<number, string>>({});

    const create = trpc.admin.adminCredentials.create.useMutation({
        onSuccess: () => {
            utils.admin.adminCredentials.list.invalidate();
            setShowForm(false);
            setLabel('');
            setProjectId('');
            setCredentialsJson('');
            setCreateError('');
        },
        onError: e => setCreateError(e.message),
    });

    const remove = trpc.admin.adminCredentials.delete.useMutation({
        onSuccess: () => utils.admin.adminCredentials.list.invalidate(),
    });

    const rediscover = trpc.admin.adminCredentials.rediscover.useMutation({
        onSuccess: (data, vars) => {
            utils.admin.adminCredentials.list.invalidate();
            setDiscoverMsg(prev => ({ ...prev, [vars.id]: `Imported ${data.imported} new definition(s)` }));
            setTimeout(() => setDiscoverMsg(prev => { const n = { ...prev }; delete n[vars.id]; return n; }), 4000);
        },
        onError: (e, vars) => {
            setDiscoverMsg(prev => ({ ...prev, [vars.id]: `Error: ${e.message}` }));
        },
    });

    function handleCreate() {
        setCreateError('');
        create.mutate({ label, role, projectId, credentials: credentialsJson });
    }

    return (
        <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Credentials</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        GCP service account credentials used by the cloud server for Phrase Set management.
                        These credentials never leave the server.
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(s => !s)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    + Add Credential
                </button>
            </div>

            {showForm && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6 border border-blue-200 dark:border-blue-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">New Admin Credential</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Label</label>
                            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
                                className={inp} placeholder="e.g. FIM Admin SA" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Role</label>
                            <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'client')} className={inp}>
                                <option value="admin">Admin (Phrase Set CRUD)</option>
                                <option value="client">Client (recognition only)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">GCP Project ID</label>
                            <input type="text" value={projectId} onChange={e => setProjectId(e.target.value)}
                                className={inp} placeholder="e.g. fim-closed-captions" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                Service Account JSON
                            </label>
                            <textarea value={credentialsJson} onChange={e => setCredentialsJson(e.target.value)}
                                className={`${inp} font-mono`} rows={5}
                                placeholder='{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}' />
                            <p className="text-xs text-gray-400 mt-1">
                                Paste the full service account JSON. It will be AES-256 encrypted before storage.
                            </p>
                        </div>
                        {createError && (
                            <p className="text-sm text-red-600">{createError}</p>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={handleCreate}
                                disabled={create.isPending || !label || !projectId || !credentialsJson}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {create.isPending ? 'Saving...' : 'Save'}
                            </button>
                            <button onClick={() => setShowForm(false)}
                                className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isLoading ? (
                <p className="text-gray-400">Loading...</p>
            ) : !creds?.length ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-400">
                    No credentials configured yet. Add one to start managing phrase sets.
                </div>
            ) : (
                <div className="space-y-3">
                    {creds.map(c => (
                        <div key={c.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-gray-900 dark:text-white">{c.label}</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[c.role]}`}>
                                        {c.role}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{c.projectId}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {c.role === 'admin' && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => rediscover.mutate({ id: c.id })}
                                            disabled={rediscover.isPending}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                        >
                                            {rediscover.isPending && rediscover.variables?.id === c.id
                                                ? 'Discovering...' : 'Re-discover'}
                                        </button>
                                        {discoverMsg[c.id] && (
                                            <span className="text-xs text-green-600 dark:text-green-400">{discoverMsg[c.id]}</span>
                                        )}
                                    </div>
                                )}
                                <button
                                    onClick={() => {
                                        if (confirm(`Delete credential "${c.label}"? This cannot be undone.`)) {
                                            remove.mutate({ id: c.id });
                                        }
                                    }}
                                    disabled={remove.isPending}
                                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
