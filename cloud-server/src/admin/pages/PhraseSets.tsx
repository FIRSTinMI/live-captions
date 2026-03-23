import React, { useState } from 'react';
import { trpc } from '../api';
import { AdminCredentials } from './AdminCredentials';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

const STATE_STYLE: Record<string, { bg: string; label: string }> = {
    synced:  { bg: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',  label: 'Synced' },
    pending: { bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', label: 'Pending' },
    drifted: { bg: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', label: 'Drifted' },
    missing: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',          label: 'Missing' },
    unknown: { bg: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',          label: 'Unknown' },
};

function StateBadge({ state }: { state: string | null }) {
    const s = STATE_STYLE[state ?? 'unknown'] ?? STATE_STYLE.unknown;
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg}`}>{s.label}</span>;
}

interface Phrase { value: string; boost?: number }

function phrasesToText(phrases: Phrase[]): string {
    return phrases.map(p => p.value).join('\n');
}

function sharedBoostFromPhrases(phrases: Phrase[]): string {
    const first = phrases.find(p => p.boost !== undefined);
    return first?.boost !== undefined ? String(first.boost) : '';
}

function textToPhrases(text: string, boost: string): Phrase[] {
    const boostNum = boost.trim() === '' ? undefined : Number(boost);
    const seen = new Set<string>();
    return text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .filter(l => { if (seen.has(l)) return false; seen.add(l); return true; })
        .map(value => boostNum !== undefined ? { value, boost: boostNum } : { value });
}

export function PhraseSets() {
    const utils = trpc.useUtils();
    const { data: defs, isLoading: defsLoading } = trpc.admin.phraseSetDefinitions.list.useQuery();
    const { data: adminCreds } = trpc.admin.adminCredentials.list.useQuery();

    const [showCredsModal, setShowCredsModal] = useState(false);

    const [selectedDefId, setSelectedDefId] = useState<number | null>(null);
    const { data: deployments } = trpc.admin.phraseSetDeployments.list.useQuery(
        { definitionId: selectedDefId ?? undefined },
        { enabled: selectedDefId !== null }
    );

    // Create definition form
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPhrasesText, setNewPhrasesText] = useState('');
    const [newBoost, setNewBoost] = useState('');
    const [createError, setCreateError] = useState('');

    // Edit definition
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editPhrasesText, setEditPhrasesText] = useState('');
    const [editBoost, setEditBoost] = useState('');
    const [syncErrors, setSyncErrors] = useState<{ id: number; error: string }[]>([]);

    // Deploy form
    const [showDeployForm, setShowDeployForm] = useState(false);
    const [deployCredId, setDeployCredId] = useState('');
    const [deployProjectId, setDeployProjectId] = useState('');
    const [deployLocation, setDeployLocation] = useState('global');
    const [deployResourceId, setDeployResourceId] = useState('');
    const [deployError, setDeployError] = useState('');

    const createDef = trpc.admin.phraseSetDefinitions.create.useMutation({
        onSuccess: () => {
            utils.admin.phraseSetDefinitions.list.invalidate();
            setShowCreate(false);
            setNewName('');
            setNewPhrasesText('');
            setNewBoost('');
            setCreateError('');
        },
        onError: e => setCreateError(e.message),
    });

    const syncAllMut = trpc.admin.phraseSetDeployments.syncAll.useMutation({
        onSuccess: (data) => {
            utils.admin.phraseSetDeployments.list.invalidate({ definitionId: selectedDefId ?? undefined });
            utils.admin.phraseSetDefinitions.list.invalidate();
            if (data.errors.length > 0) setSyncErrors(data.errors);
        },
    });

    const updateDef = trpc.admin.phraseSetDefinitions.update.useMutation({
        onSuccess: (_, variables) => {
            utils.admin.phraseSetDefinitions.list.invalidate();
            setEditingId(null);
            setSyncErrors([]);
            syncAllMut.mutate({ definitionId: variables.id });
        },
    });

    const deleteDef = trpc.admin.phraseSetDefinitions.delete.useMutation({
        onSuccess: () => {
            utils.admin.phraseSetDefinitions.list.invalidate();
            if (selectedDefId === deleteDef.variables?.id) setSelectedDefId(null);
        },
    });

    const deployMut = trpc.admin.phraseSetDeployments.deploy.useMutation({
        onSuccess: () => {
            utils.admin.phraseSetDeployments.list.invalidate({ definitionId: selectedDefId ?? undefined });
            utils.admin.phraseSetDefinitions.list.invalidate();
            setShowDeployForm(false);
            setDeployError('');
        },
        onError: e => setDeployError(e.message),
    });

    const verifyMut = trpc.admin.phraseSetDeployments.verify.useMutation({
        onSuccess: () => utils.admin.phraseSetDeployments.list.invalidate({ definitionId: selectedDefId ?? undefined }),
    });

    const undeployMut = trpc.admin.phraseSetDeployments.undeploy.useMutation({
        onSuccess: () => {
            utils.admin.phraseSetDeployments.list.invalidate({ definitionId: selectedDefId ?? undefined });
            utils.admin.phraseSetDefinitions.list.invalidate();
        },
    });

    function startEdit(def: { id: number; name: string; phrases: unknown }) {
        const phrases = (def.phrases as Phrase[]) ?? [];
        setEditingId(def.id);
        setEditName(def.name);
        setEditPhrasesText(phrasesToText(phrases));
        setEditBoost(sharedBoostFromPhrases(phrases));
        setSyncErrors([]);
    }

    function saveEdit() {
        if (!editingId) return;
        updateDef.mutate({ id: editingId, name: editName, phrases: textToPhrases(editPhrasesText, editBoost) });
    }

    const adminOnly = adminCreds?.filter(c => c.role === 'admin') ?? [];

    return (
        <div className="max-w-5xl">
            {showCredsModal && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl mx-4 relative">
                        <button
                            onClick={() => setShowCredsModal(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                            aria-label="Close"
                        >
                            ✕
                        </button>
                        <div className="p-6">
                            <AdminCredentials />
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Phrase Sets</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Manage phrase sets and deploy them to GCP projects.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCredsModal(true)}
                        className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        Manage Credentials
                    </button>
                    <button
                        onClick={() => setShowCreate(s => !s)}
                        className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
                    >
                        + New Phrase Set
                    </button>
                </div>
            </div>

            {showCreate && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6 border border-blue-200 dark:border-blue-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">New Phrase Set</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                                className={inp} placeholder="e.g. FIM Team Names 2025" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phrases</label>
                            <textarea
                                value={newPhrasesText}
                                onChange={e => setNewPhrasesText(e.target.value)}
                                rows={8}
                                className={`${inp} font-mono`}
                                placeholder={'phrase one\nphrase two\nphrase three'}
                            />
                            <p className="text-xs text-gray-400 mt-1">One phrase per line. Blank lines and duplicates are ignored.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                Boost <span className="font-normal text-gray-400">(−20 to 20, optional)</span>
                            </label>
                            <input
                                type="number"
                                value={newBoost}
                                onChange={e => setNewBoost(e.target.value)}
                                min={-20} max={20}
                                className={`${inp} w-32`}
                                placeholder="e.g. 10"
                            />
                        </div>
                        {createError && <p className="text-sm text-red-600">{createError}</p>}
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => createDef.mutate({ name: newName, phrases: textToPhrases(newPhrasesText, newBoost) })}
                                disabled={createDef.isPending || !newName}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {createDef.isPending ? 'Creating...' : 'Create'}
                            </button>
                            <button onClick={() => setShowCreate(false)}
                                className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: definitions list */}
                <div className="lg:col-span-2">
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Definitions</h3>
                    {defsLoading ? (
                        <p className="text-gray-400 text-sm">Loading...</p>
                    ) : !defs?.length ? (
                        <p className="text-gray-400 text-sm">No phrase sets yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {defs.map(def => (
                                <div
                                    key={def.id}
                                    onClick={() => { setSelectedDefId(def.id); setEditingId(null); setShowDeployForm(false); }}
                                    className={`bg-white dark:bg-gray-800 rounded-lg shadow p-3 cursor-pointer border-2 transition-colors ${selectedDefId === def.id ? 'border-blue-500' : 'border-transparent'}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium text-sm text-gray-900 dark:text-white truncate flex-1">{def.name}</span>
                                        <StateBadge state={def.worstState} />
                                    </div>
                                    <p className="text-xs text-gray-400">
                                        {(def.phrases as Phrase[]).length} phrase(s) · {def.deploymentCount} deployment(s)
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right: detail panel */}
                <div className="lg:col-span-3">
                    {selectedDefId === null ? (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-400 text-sm">
                            Select a phrase set to view deployments
                        </div>
                    ) : (() => {
                        const def = defs?.find(d => d.id === selectedDefId);
                        if (!def) return null;

                        return (
                            <div className="space-y-4">
                                {/* Edit definition */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                                    {editingId === def.id ? (
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                                                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={inp} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phrases</label>
                                                <textarea
                                                    value={editPhrasesText}
                                                    onChange={e => setEditPhrasesText(e.target.value)}
                                                    rows={8}
                                                    className={`${inp} font-mono`}
                                                    placeholder={'phrase one\nphrase two\nphrase three'}
                                                />
                                                <p className="text-xs text-gray-400 mt-1">One phrase per line. Blank lines and duplicates are ignored.</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                    Boost <span className="font-normal text-gray-400">(−20 to 20, optional)</span>
                                                </label>
                                                <input
                                                    type="number"
                                                    value={editBoost}
                                                    onChange={e => setEditBoost(e.target.value)}
                                                    min={-20} max={20}
                                                    className={`${inp} w-32`}
                                                    placeholder="e.g. 10"
                                                />
                                            </div>
                                            {syncErrors.length > 0 && (
                                                <div className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
                                                    {syncErrors.map(e => (
                                                        <p key={e.id}>Sync failed for deployment {e.id}: {e.error}</p>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex gap-2 items-center">
                                                <button onClick={saveEdit} disabled={updateDef.isPending || syncAllMut.isPending}
                                                    className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                                                    {updateDef.isPending ? 'Saving...' : syncAllMut.isPending ? 'Syncing...' : 'Save'}
                                                </button>
                                                <button onClick={() => { setEditingId(null); setSyncErrors([]); }}
                                                    className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <h4 className="font-semibold text-gray-900 dark:text-white">{def.name}</h4>
                                                <p className="text-xs text-gray-400 mt-0.5">
                                                    {(def.phrases as Phrase[]).length} phrase(s)
                                                </p>
                                                {(def.phrases as Phrase[]).length > 0 && (
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                                                        {(def.phrases as Phrase[]).slice(0, 5).map(p => p.value).join(', ')}
                                                        {(def.phrases as Phrase[]).length > 5 ? ` +${(def.phrases as Phrase[]).length - 5} more` : ''}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button onClick={() => startEdit(def)}
                                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                                                <button
                                                    onClick={() => {
                                                        if (confirm(`Delete "${def.name}"? All deployments must be removed first.`)) {
                                                            deleteDef.mutate({ id: def.id });
                                                        }
                                                    }}
                                                    disabled={deleteDef.isPending}
                                                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">Delete</button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Deployments */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Deployments</h4>
                                        <button
                                            onClick={() => setShowDeployForm(s => !s)}
                                            className="text-xs bg-blue-600 text-white rounded px-2.5 py-1 hover:bg-blue-700">
                                            + Deploy to project
                                        </button>
                                    </div>

                                    {showDeployForm && (
                                        <div className="border border-blue-100 dark:border-blue-800 rounded-lg p-3 mb-3 space-y-2 bg-blue-50 dark:bg-blue-900/20">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Admin Credential</label>
                                                <select value={deployCredId} onChange={e => {
                                                    setDeployCredId(e.target.value);
                                                    const cred = adminOnly.find(c => c.id === Number(e.target.value));
                                                    if (cred) setDeployProjectId(cred.projectId);
                                                }} className={inp}>
                                                    <option value="">Select credential...</option>
                                                    {adminOnly.map(c => (
                                                        <option key={c.id} value={c.id}>{c.label} ({c.projectId})</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">GCP Project ID</label>
                                                <input type="text" value={deployProjectId} onChange={e => setDeployProjectId(e.target.value)} className={inp} />
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Location</label>
                                                    <input type="text" value={deployLocation} onChange={e => setDeployLocation(e.target.value)} className={inp} />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Resource ID</label>
                                                    <input type="text" value={deployResourceId} onChange={e => setDeployResourceId(e.target.value)}
                                                        className={inp} placeholder="e.g. fim-team-names" />
                                                </div>
                                            </div>
                                            {deployError && <p className="text-xs text-red-600">{deployError}</p>}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => deployMut.mutate({
                                                        definitionId: selectedDefId,
                                                        adminCredentialProfileId: Number(deployCredId),
                                                        projectId: deployProjectId,
                                                        location: deployLocation,
                                                        resourceId: deployResourceId,
                                                    })}
                                                    disabled={deployMut.isPending || !deployCredId || !deployProjectId || !deployResourceId}
                                                    className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {deployMut.isPending ? 'Deploying...' : 'Deploy'}
                                                </button>
                                                <button onClick={() => { setShowDeployForm(false); setDeployError(''); }}
                                                    className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {!deployments?.length ? (
                                        <p className="text-xs text-gray-400">No deployments yet. Deploy to a GCP project to start using this phrase set.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {deployments.map(dep => (
                                                <div key={dep.id} className="flex items-center gap-3 p-2 rounded border border-gray-100 dark:border-gray-700">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-0.5">
                                                            <StateBadge state={dep.state} />
                                                            <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">{dep.resourceName}</span>
                                                        </div>
                                                        <p className="text-xs text-gray-400">
                                                            {dep.adminCredentialLabel}
                                                            {dep.lastVerifiedAt
                                                                ? ` · verified ${new Date(dep.lastVerifiedAt).toLocaleDateString()}`
                                                                : ' · never verified'}
                                                        </p>
                                                    </div>
                                                    <div className="flex gap-2 shrink-0">
                                                        <button
                                                            onClick={() => verifyMut.mutate({ id: dep.id })}
                                                            disabled={verifyMut.isPending}
                                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                                                            Verify
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const fromGcp = confirm('Also delete from GCP? Click OK to delete from GCP too, or Cancel to remove only from this app.');
                                                                undeployMut.mutate({ id: dep.id, deleteFromGcp: fromGcp });
                                                            }}
                                                            disabled={undeployMut.isPending}
                                                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
