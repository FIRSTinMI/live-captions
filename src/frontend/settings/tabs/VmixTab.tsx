import React, { useState } from 'react';
import { AppConfig } from '../../shared/types';
import { trpc } from '../../shared/trpc';
import styles from '../settings.module.css';

interface Props {
    config: AppConfig;
    onRefresh: () => void;
}

export function VmixTab({ config, onRefresh }: Props) {
    const utils = trpc.useUtils();
    const setUrl = trpc.youtubeCaptions.setUrl.useMutation({
        onSuccess: () => { utils.youtubeCaptions.pushStatus.invalidate(); onRefresh(); },
    });
    const setEnabled = trpc.youtubeCaptions.setEnabled.useMutation({
        onSuccess: () => { utils.youtubeCaptions.pushStatus.invalidate(); onRefresh(); },
    });
    const ensureInput = trpc.vmix.ensureLiveCaptionsInput.useMutation();

    const { data: status } = trpc.youtubeCaptions.pushStatus.useQuery(undefined, {
        refetchInterval: 1000,
    });

    const [urlDraft, setUrlDraft] = useState(config.youtubeCaptions.url ?? '');
    const [ensureResult, setEnsureResult] = useState<{ kind: 'exists' | 'created' | 'error'; message: string } | null>(null);

    function handleEnsureInput() {
        setEnsureResult(null);
        ensureInput.mutate(undefined, {
            onSuccess: (res) => {
                if (res.status === 'exists') {
                    setEnsureResult({ kind: 'exists', message: 'Already exists.' });
                } else if (res.status === 'created') {
                    setEnsureResult({ kind: 'created', message: 'Added.' });
                } else {
                    setEnsureResult({ kind: 'error', message: res.error });
                }
            },
            onError: (err) => setEnsureResult({ kind: 'error', message: err.message }),
        });
    }

    const enabled = status?.enabled ?? config.youtubeCaptions.enabled;
    const lastPushLabel = status?.lastPushAt
        ? `${Math.max(0, Math.round((Date.now() - status.lastPushAt) / 1000))}s ago`
        : 'never';

    function commitUrl() {
        const trimmed = urlDraft.trim();
        const current = config.youtubeCaptions.url ?? '';
        if (trimmed === current) return;
        setUrl.mutate({ url: trimmed === '' ? null : trimmed });
    }

    return (
        <div>
            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Live Captions browser input</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={handleEnsureInput}
                            disabled={ensureInput.isPending}
                        >
                            {ensureInput.isPending ? 'Checking…' : 'Add Live Captions input to vMix'}
                        </button>
                        {ensureResult && (
                            <span
                                className={styles.supporting}
                                style={{
                                    color: ensureResult.kind === 'error' ? 'var(--danger)'
                                        : ensureResult.kind === 'created' ? 'var(--success)'
                                        : 'var(--text-secondary)',
                                }}
                            >
                                {ensureResult.message}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className={styles.sectionHeader} style={{ marginTop: 24 }}>
                <h3>How to hide captions from livestream/recordings</h3>
            </div>
            <div className={styles.aboutPre} style={{ marginBottom: 16 }}>
                <ol style={{ marginLeft: 20, lineHeight: 1.7 }}>
                    <li>Click the button above.</li>
                    <li>Assign the Live Captions input to Overlay 8.</li>
                    <li>In Settings, Outputs / NDI / SRT, Output 2 tab: set source to Output and uncheck Overlay 8.</li>
                    <li>Stream/record from Output 2.</li>
                </ol>
            </div>

            <div className={styles.sectionHeader} style={{ marginTop: 24 }}>
                <h3>YouTube caption push</h3>
            </div>

            <div className={styles.row}>
                <div className={styles.field}>
                    <label>YouTube HTTP caption ingestion URL</label>
                    <input
                        type="text"
                        value={urlDraft}
                        onChange={e => setUrlDraft(e.target.value)}
                        onBlur={commitUrl}
                        placeholder="http://upload.youtube.com/closedcaption?cid=...&seq=..."
                    />
                    <span className={styles.supporting}>
                        From YouTube Studio with Captions set to HTTP POST.
                    </span>
                </div>
            </div>

            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Push captions to YouTube</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={enabled}
                            disabled={!config.youtubeCaptions.url}
                            onChange={e => setEnabled.mutate({ enabled: e.target.checked })}
                        />
                        Enabled
                    </label>
                    {!config.youtubeCaptions.url && (
                        <span className={styles.supporting}>Save an ingestion URL first.</span>
                    )}
                </div>
            </div>

            {status && (
                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Push status</label>
                        <div className={styles.aboutPre} style={{ margin: 0 }}>
                            <div>Running: {status.running ? 'yes' : 'no'}</div>
                            <div>Last push: {lastPushLabel}</div>
                            <div>Queue depth: {status.queueDepth}</div>
                            {status.lastError && (
                                <div style={{ color: 'var(--danger)' }}>Last error: {status.lastError}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
