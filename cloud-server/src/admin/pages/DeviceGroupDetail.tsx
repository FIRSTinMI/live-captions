import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { trpc } from '../api';

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white';

const STATE_COLORS: Record<string, string> = {
    synced: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    drifted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    missing: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

// Returns the consensus value if all values are equal, or undefined if they differ
function consensus<T>(values: T[]): T | undefined {
    if (values.length === 0) return undefined;
    const first = values[0];
    return values.every(v => JSON.stringify(v) === JSON.stringify(first)) ? first : undefined;
}

function GroupPhraseSetMultiSelect({
    deployments,
    selectedIds,
    onChange,
}: {
    deployments: { id: number; definitionName: string; state: string }[];
    selectedIds: number[] | undefined; // undefined = mixed/inconsistent
    onChange: (ids: number[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const [localIds, setLocalIds] = useState<number[]>(selectedIds ?? []);

    useEffect(() => {
        setLocalIds(selectedIds ?? []);
    }, [selectedIds]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selected = deployments.filter(d => localIds.includes(d.id));
    const available = deployments.filter(d => !localIds.includes(d.id) && d.state !== 'missing' && d.state !== 'pending');

    function remove(id: number) {
        const next = localIds.filter(x => x !== id);
        setLocalIds(next);
        onChange(next);
    }
    function add(id: number) {
        const next = [...localIds, id];
        setLocalIds(next);
        onChange(next);
        setOpen(false);
    }

    const isMixed = selectedIds === undefined;

    return (
        <div ref={ref} className="relative">
            <div
                className="min-h-[38px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text bg-white dark:bg-gray-700"
                onClick={() => setOpen(true)}
            >
                {isMixed && !open && localIds.length === 0 ? (
                    <span className="text-gray-400 text-sm py-0.5 italic">Mixed values - set new selection to apply to all</span>
                ) : selected.length === 0 ? (
                    <span className="text-gray-400 text-sm py-0.5">Click to select phrase sets...</span>
                ) : null}
                {selected.map(dep => (
                    <span key={dep.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                        {dep.definitionName}
                        <span className={`ml-1 px-1 py-0 rounded text-xs ${STATE_COLORS[dep.state] ?? STATE_COLORS.unknown}`}>{dep.state}</span>
                        <button onClick={e => { e.stopPropagation(); remove(dep.id); }} className="ml-0.5 text-blue-500 hover:text-blue-800 dark:hover:text-blue-100">×</button>
                    </span>
                ))}
            </div>
            {open && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg max-h-52 overflow-auto">
                    {available.map(dep => (
                        <button key={dep.id} onClick={() => add(dep.id)}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                            <span className="flex-1 text-gray-900 dark:text-white">{dep.definitionName}</span>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${STATE_COLORS[dep.state] ?? STATE_COLORS.unknown}`}>{dep.state}</span>
                        </button>
                    ))}
                    {available.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No more phrase sets available</p>}
                </div>
            )}
        </div>
    );
}

// A field that shows "Mixed values" placeholder when value is undefined
function MixedInput({ value, onChange, type = 'number', ...rest }: {
    value: string | number | undefined;
    onChange: (v: string) => void;
    type?: string;
    [key: string]: unknown;
}) {
    const isMixed = value === undefined;
    return (
        <input
            type={type}
            className={`${inp} ${isMixed ? 'text-gray-400 italic' : ''}`}
            value={isMixed ? '' : value}
            placeholder={isMixed ? 'Mixed values' : undefined}
            onChange={e => onChange(e.target.value)}
            {...rest}
        />
    );
}

function MixedSelect({ value, onChange, children }: {
    value: string | number | undefined;
    onChange: (v: string) => void;
    children: React.ReactNode;
}) {
    const isMixed = value === undefined;
    return (
        <select className={`${inp} ${isMixed ? 'text-gray-400 italic' : ''}`} value={isMixed ? '' : value}
            onChange={e => onChange(e.target.value)}>
            {isMixed && <option value="">Mixed values</option>}
            {children}
        </select>
    );
}

export function DeviceGroupDetail() {
    const { id } = useParams<{ id: string }>();
    const groupId = parseInt(id!);
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const { data: group } = trpc.admin.deviceGroups.get.useQuery({ id: groupId });
    const { data: allDevices } = trpc.admin.devices.list.useQuery();
    const { data: allDeployments } = trpc.admin.phraseSetDeployments.list.useQuery({});

    // ── Member management ────────────────────────────────────────────────────
    const [addDeviceId, setAddDeviceId] = useState('');
    const [memberMsg, setMemberMsg] = useState('');

    const assignDevice = trpc.admin.devices.update.useMutation({
        onSuccess: () => {
            utils.admin.deviceGroups.get.invalidate({ id: groupId });
            utils.admin.devices.list.invalidate();
            setAddDeviceId('');
            setMemberMsg('Device added');
            setTimeout(() => setMemberMsg(''), 2000);
        },
    });

    const removeDevice = trpc.admin.devices.update.useMutation({
        onSuccess: () => {
            utils.admin.deviceGroups.get.invalidate({ id: groupId });
            utils.admin.devices.list.invalidate();
        },
    });

    // ── Display settings (with mixed-value detection) ─────────────────────────
    const [displayPosition, setDisplayPosition] = useState<number | undefined>(undefined);
    const [displayAlign, setDisplayAlign] = useState<string | undefined>(undefined);
    const [displayChromaKey, setDisplayChromaKey] = useState<string | undefined>(undefined);
    const [displaySize, setDisplaySize] = useState<number | undefined>(undefined);
    const [displayLines, setDisplayLines] = useState<number | undefined>(undefined);
    const [displayTimeout, setDisplayTimeout] = useState<number | undefined>(undefined);
    const [displayMsg, setDisplayMsg] = useState('');

    // ── Transcription ─────────────────────────────────────────────────────────
    const [engine, setEngine] = useState<string | undefined>(undefined);
    const [transcriptionMsg, setTranscriptionMsg] = useState('');

    // ── Phrase sets ───────────────────────────────────────────────────────────
    const [phraseDepIds, setPhraseDepIds] = useState<number[] | undefined>(undefined);
    const [phraseMsg, setPhraseMsg] = useState('');
    const [phraseError, setPhraseError] = useState('');

    // Compute consensus values from all group member settings
    useEffect(() => {
        if (!group?.devices.length) return;

        function getSettings(d: typeof group.devices[0]) {
            return (d.pushedSettings ?? d.settings) as Record<string, unknown> | null;
        }

        const displays = group.devices.map(d => (getSettings(d) as { display?: Record<string, unknown> } | null)?.display);
        const transcriptions = group.devices.map(d => (getSettings(d) as { transcription?: Record<string, unknown> } | null)?.transcription);

        setDisplayPosition(consensus(displays.map(d => d?.position as number)));
        setDisplayAlign(consensus(displays.map(d => d?.align as string)));
        setDisplayChromaKey(consensus(displays.map(d => d?.chromaKey as string)));
        setDisplaySize(consensus(displays.map(d => d?.size as number)));
        setDisplayLines(consensus(displays.map(d => d?.lines as number)));
        setDisplayTimeout(consensus(displays.map(d => d?.timeout as number)));
        setEngine(consensus(transcriptions.map(d => d?.engine as string)));

        const allPhraseIds = group.devices.map(d => {
            const t = (getSettings(d) as { transcription?: { phraseSetDeploymentIds?: number[] } } | null)?.transcription;
            return t?.phraseSetDeploymentIds ?? [];
        });
        const consensusIds = consensus(allPhraseIds);
        setPhraseDepIds(consensusIds);
    }, [group?.devices]);

    // ── Mutations ─────────────────────────────────────────────────────────────
    const saveGroupSettings = trpc.admin.deviceGroups.saveSettings.useMutation({
        onSuccess: (_, variables) => {
            utils.admin.deviceGroups.get.invalidate({ id: groupId });
            const msg = 'Pushed to all devices';
            if ('display' in variables.settings) { setDisplayMsg(msg); setTimeout(() => setDisplayMsg(''), 2500); }
            else { setTranscriptionMsg(msg); setTimeout(() => setTranscriptionMsg(''), 2500); }
        },
    });

    const pushGroupPhraseSets = trpc.admin.deviceGroups.pushPhraseSets.useMutation({
        onSuccess: () => {
            utils.admin.deviceGroups.get.invalidate({ id: groupId });
            setPhraseMsg('Pushed to all devices');
            setPhraseError('');
            setTimeout(() => setPhraseMsg(''), 2500);
        },
        onError: e => { setPhraseError(e.message); setPhraseMsg(''); },
    });

    function handleSaveDisplay() {
        const settings: Record<string, unknown> = { display: {} };
        const d = settings.display as Record<string, unknown>;
        if (displayPosition !== undefined) d.position = displayPosition;
        if (displayAlign !== undefined) d.align = displayAlign;
        if (displayChromaKey !== undefined) d.chromaKey = displayChromaKey;
        if (displaySize !== undefined) d.size = displaySize;
        if (displayLines !== undefined) d.lines = displayLines;
        if (displayTimeout !== undefined) d.timeout = displayTimeout;
        saveGroupSettings.mutate({ groupId, settings });
    }

    function handleHideAll(hidden: boolean) {
        saveGroupSettings.mutate({ groupId, settings: { display: { hidden } } });
    }

    if (!group) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>;

    const memberIds = new Set(group.devices.map(d => d.id));
    const nonMembers = allDevices?.filter(d => !memberIds.has(d.id)) ?? [];

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => navigate('/admin/device-groups')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">← Back</button>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{group.name}</h2>
                <span className="text-sm text-gray-400">{group.devices.length} {group.devices.length === 1 ? 'device' : 'devices'}</span>
            </div>

            {/* Devices in group */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Devices in this group</h3>

                {group.devices.length === 0 ? (
                    <p className="text-sm text-gray-400 mb-4">No devices in this group yet.</p>
                ) : (
                    <div className="space-y-2 mb-4">
                        {group.devices.map(d => (
                            <div key={d.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <span className={`inline-block w-2 h-2 rounded-full ${d.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                                    <Link to={`/admin/devices/${d.id}`} className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
                                        {d.name}
                                    </Link>
                                    {d.tag && <span className="text-xs font-mono bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">{d.tag}</span>}
                                    <span className="text-xs text-gray-400">{d.online ? 'Online' : 'Offline'}</span>
                                </div>
                                <button
                                    onClick={() => { if (confirm(`Remove "${d.name}" from this group?`)) removeDevice.mutate({ id: d.id, groupId: null }); }}
                                    className="text-xs text-red-500 hover:text-red-700"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {nonMembers.length > 0 && (
                    <div className="flex gap-2">
                        <select
                            value={addDeviceId}
                            onChange={e => setAddDeviceId(e.target.value)}
                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        >
                            <option value="">Add a device...</option>
                            {nonMembers.map(d => (
                                <option key={d.id} value={d.id}>{d.name}{d.tag ? ` (${d.tag})` : ''}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => { if (addDeviceId) assignDevice.mutate({ id: parseInt(addDeviceId), groupId }); }}
                            disabled={!addDeviceId || assignDevice.isPending}
                            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                )}
                {memberMsg && <p className="text-sm text-green-600 dark:text-green-400 mt-2">{memberMsg}</p>}
            </div>

            {/* Group Settings */}
            {group.devices.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 p-6 space-y-8">
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Group Settings</h3>
                        <p className="text-xs text-gray-400 mt-1">
                            Changes here apply to <strong>all {group.devices.length} devices</strong> in this group.
                            Fields showing "Mixed values" have different values across devices - entering a new value will override all of them.
                        </p>
                    </div>

                    {/* ── Display ───────────────────────────────────────── */}
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Display</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Position</label>
                                <MixedSelect value={displayPosition} onChange={v => setDisplayPosition(Number(v))}>
                                    <option value={0}>Bottom</option>
                                    <option value={1}>Top</option>
                                    <option value={2}>Bottom (audience)</option>
                                    <option value={3}>Top (audience)</option>
                                </MixedSelect>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Alignment</label>
                                <MixedSelect value={displayAlign} onChange={v => setDisplayAlign(v)}>
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                </MixedSelect>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Chroma Key</label>
                                <MixedInput type="text" value={displayChromaKey} onChange={v => setDisplayChromaKey(v)} placeholder={displayChromaKey === undefined ? 'Mixed values' : '#00B140'} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Text Size (px)</label>
                                <MixedInput type="number" value={displaySize} onChange={v => setDisplaySize(Number(v))} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Max Lines</label>
                                <MixedInput type="number" value={displayLines} onChange={v => setDisplayLines(Number(v))} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Timeout (s)</label>
                                <MixedInput type="number" value={displayTimeout} onChange={v => setDisplayTimeout(Number(v))} />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            <button onClick={() => handleHideAll(true)}
                                className="bg-gray-700 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-800">
                                Hide All Captions
                            </button>
                            <button onClick={() => handleHideAll(false)}
                                className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-300 dark:hover:bg-gray-600">
                                Show All Captions
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={handleSaveDisplay} disabled={saveGroupSettings.isPending}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {saveGroupSettings.isPending ? 'Saving...' : 'Save Display for All Devices'}
                            </button>
                            {displayMsg && <span className="text-sm text-green-600 dark:text-green-400">{displayMsg}</span>}
                        </div>
                    </section>

                    {/* ── Transcription Engine ──────────────────────────── */}
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Transcription Engine</h4>
                        <div className="flex flex-col gap-1 mb-4 max-w-xs">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Engine</label>
                            <MixedSelect value={engine} onChange={v => setEngine(v)}>
                                <option value="googlev1">Google V1</option>
                                <option value="googlev2">Google V2</option>
                                <option value="april">April ASR</option>
                            </MixedSelect>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => { if (engine !== undefined) saveGroupSettings.mutate({ groupId, settings: { transcription: { engine } } }); }}
                                disabled={saveGroupSettings.isPending || engine === undefined}
                                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saveGroupSettings.isPending ? 'Saving...' : 'Save Transcription for All Devices'}
                            </button>
                            {transcriptionMsg && <span className="text-sm text-green-600 dark:text-green-400">{transcriptionMsg}</span>}
                        </div>
                    </section>

                    {/* ── Phrase Sets ───────────────────────────────────── */}
                    {allDeployments && allDeployments.length > 0 && (
                        <section>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">Phrase Sets</h4>
                            <p className="text-xs text-gray-400 mb-2">Select phrase sets to push to all devices in this group.</p>
                            <GroupPhraseSetMultiSelect
                                deployments={allDeployments}
                                selectedIds={phraseDepIds}
                                onChange={ids => setPhraseDepIds(ids)}
                            />
                            <div className="flex items-center gap-3 mt-3">
                                <button
                                    onClick={() => { if (phraseDepIds !== undefined) pushGroupPhraseSets.mutate({ groupId, deploymentIds: phraseDepIds }); }}
                                    disabled={pushGroupPhraseSets.isPending || phraseDepIds === undefined}
                                    className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {pushGroupPhraseSets.isPending ? 'Pushing...' : 'Push Phrase Sets to All Devices'}
                                </button>
                                {phraseDepIds === undefined && <span className="text-xs text-gray-400">Select phrase sets above to enable</span>}
                                {phraseMsg && <span className="text-sm text-green-600 dark:text-green-400">{phraseMsg}</span>}
                                {phraseError && <span className="text-sm text-red-600">{phraseError}</span>}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}
