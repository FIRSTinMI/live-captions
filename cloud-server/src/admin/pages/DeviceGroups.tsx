import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc } from '../api';

export function DeviceGroups() {
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const { data: groups } = trpc.admin.deviceGroups.list.useQuery();

    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');

    const createGroup = trpc.admin.deviceGroups.create.useMutation({
        onSuccess: (group) => {
            utils.admin.deviceGroups.list.invalidate();
            setShowCreate(false);
            setNewName('');
            navigate(`/admin/device-groups/${group.id}`);
        },
    });

    const updateGroup = trpc.admin.deviceGroups.update.useMutation({
        onSuccess: () => {
            utils.admin.deviceGroups.list.invalidate();
            setEditingId(null);
        },
    });

    const deleteGroup = trpc.admin.deviceGroups.delete.useMutation({
        onSuccess: () => utils.admin.deviceGroups.list.invalidate(),
    });

    return (
        <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Device Groups</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Control settings across multiple devices at once.</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    New Group
                </button>
            </div>

            {showCreate && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Create Group</h3>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            autoFocus
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createGroup.mutate({ name: newName.trim() }); }}
                            placeholder="Group name (e.g. Field 1-4)"
                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        />
                        <button
                            onClick={() => { if (newName.trim()) createGroup.mutate({ name: newName.trim() }); }}
                            disabled={createGroup.isPending || !newName.trim()}
                            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                            Create
                        </button>
                        <button
                            onClick={() => { setShowCreate(false); setNewName(''); }}
                            className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                {!groups?.length ? (
                    <div className="p-12 text-center text-gray-400">
                        <p className="text-lg mb-2">No device groups yet</p>
                        <p className="text-sm">Create a group to control settings across multiple devices at once.</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Devices</th>
                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {groups.map(group => (
                                <tr key={group.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                    <td className="px-6 py-4">
                                        {editingId === group.id ? (
                                            <form onSubmit={e => { e.preventDefault(); if (editName.trim()) updateGroup.mutate({ id: group.id, name: editName.trim() }); }} className="flex gap-2">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                                />
                                                <button type="submit" disabled={updateGroup.isPending} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Save</button>
                                                <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                                            </form>
                                        ) : (
                                            <button
                                                onClick={() => navigate(`/admin/device-groups/${group.id}`)}
                                                className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                                            >
                                                {group.name}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                            {group.deviceCount} {group.deviceCount === 1 ? 'device' : 'devices'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <button
                                                onClick={() => navigate(`/admin/device-groups/${group.id}`)}
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                            >
                                                Manage
                                            </button>
                                            <button
                                                onClick={() => { setEditingId(group.id); setEditName(group.name); }}
                                                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                            >
                                                Rename
                                            </button>
                                            <button
                                                onClick={() => { if (confirm(`Delete group "${group.name}"? Devices will not be deleted.`)) deleteGroup.mutate({ id: group.id }); }}
                                                disabled={deleteGroup.isPending}
                                                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
