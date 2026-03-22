import React, { useState } from 'react';
import { trpc } from '../api';

export function Users() {
    const utils = trpc.useUtils();
    const { data: users } = trpc.admin.users.list.useQuery();
    const [showCreate, setShowCreate] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [createError, setCreateError] = useState('');
    const [changingPasswordId, setChangingPasswordId] = useState<number | null>(null);
    const [newPw, setNewPw] = useState('');

    const createUser = trpc.admin.users.create.useMutation({
        onSuccess: () => { utils.admin.users.list.invalidate(); setShowCreate(false); setNewUsername(''); setNewPassword(''); },
        onError: (e) => setCreateError(e.message),
    });

    const deleteUser = trpc.admin.users.delete.useMutation({
        onSuccess: () => utils.admin.users.list.invalidate(),
    });

    const updatePassword = trpc.admin.users.updatePassword.useMutation({
        onSuccess: () => { setChangingPasswordId(null); setNewPw(''); },
    });

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Admin Users</h2>
                <button onClick={() => setShowCreate(s => !s)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                    + Add User
                </button>
            </div>

            {showCreate && (
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h3 className="font-semibold text-gray-900 mb-4">New Admin User</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                            <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Password (min 8 chars)</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                    </div>
                    {createError && <p className="text-sm text-red-600 mt-2">{createError}</p>}
                    <div className="flex gap-3 mt-4">
                        <button onClick={() => setShowCreate(false)} className="border border-gray-300 text-gray-700 rounded px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
                        <button onClick={() => createUser.mutate({ username: newUsername, password: newPassword })} disabled={createUser.isPending}
                            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                            {createUser.isPending ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg shadow">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-200">
                            <th className="px-6 py-3 font-medium">Username</th>
                            <th className="px-6 py-3 font-medium">Created</th>
                            <th className="px-6 py-3 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {users?.map(u => (
                            <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="px-6 py-3 font-medium text-gray-900">{u.username}</td>
                                <td className="px-6 py-3 text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td className="px-6 py-3 flex gap-3 items-center">
                                    {changingPasswordId === u.id ? (
                                        <div className="flex gap-2 items-center">
                                            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                                                placeholder="New password" className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                            <button onClick={() => updatePassword.mutate({ id: u.id, password: newPw })}
                                                className="text-xs text-blue-600 hover:underline">Save</button>
                                            <button onClick={() => setChangingPasswordId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setChangingPasswordId(u.id)} className="text-xs text-gray-500 hover:text-gray-700">Change password</button>
                                    )}
                                    <button
                                        onClick={() => { if (confirm(`Delete user "${u.username}"?`)) deleteUser.mutate({ id: u.id }); }}
                                        className="text-xs text-red-500 hover:text-red-700"
                                    >Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!users?.length && (
                            <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No users</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
