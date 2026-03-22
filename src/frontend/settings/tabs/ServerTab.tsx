import React, { useState } from 'react';
import { AppConfig } from '../../shared/types';
import { trpc } from '../../shared/trpc';
import styles from '../settings.module.css';

interface Props {
    config: AppConfig;
    onRefresh: () => void;
}

export function ServerTab({ config, onRefresh }: Props) {
    const utils = trpc.useUtils();
    const set = trpc.config.set.useMutation({ onSuccess: onRefresh });
    const setJson = trpc.config.setJson.useMutation({ onSuccess: onRefresh });
    const connect = trpc.cloud.connect.useMutation({
        onSuccess: () => { utils.cloud.status.invalidate(); onRefresh(); },
    });
    const disconnect = trpc.cloud.disconnect.useMutation({
        onSuccess: () => { utils.cloud.status.invalidate(); onRefresh(); },
    });
    const { data: cloudStatus } = trpc.cloud.status.useQuery();

    const [pin, setPin] = useState('');
    const [connectError, setConnectError] = useState('');

    const isManaged = cloudStatus?.connected ?? false;

    function handleConnect() {
        setConnectError('');
        connect.mutate(
            { pin },
            {
                onSuccess: () => setPin(''),
                onError: (e) => setConnectError(e.message),
            }
        );
    }

    function handleDisconnect() {
        if (confirm('Disconnect from cloud management? API key will be cleared.')) {
            disconnect.mutate();
        }
    }

    return (
        <div>
            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Port</label>
                    <input
                        type="number"
                        defaultValue={config.server.port}
                        onBlur={e => set.mutate({ key: 'server.port', value: e.target.value })}
                    />
                    <span className={styles.supporting}>Port for webserver</span>
                </div>
            </div>

            {/* Cloud managed device section */}
            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Managed Device</label>
                    {isManaged ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <p style={{ color: 'var(--success)', fontWeight: 600 }}>
                                ✓ Connected as: {cloudStatus?.deviceName ?? 'Unknown'}
                            </p>
                            <span className={styles.supporting}>API key and credentials are managed by your administrator.</span>
                            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleDisconnect} disabled={disconnect.isPending}
                                style={{ alignSelf: 'flex-start' }}>
                                {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    type="text"
                                    value={pin}
                                    onChange={e => setPin(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && pin && handleConnect()}
                                    placeholder="Enter device PIN"
                                    style={{ flex: 1 }}
                                />
                                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleConnect} disabled={connect.isPending || !pin}>
                                    {connect.isPending ? 'Connecting...' : 'Connect'}
                                </button>
                            </div>
                            {connectError && (
                                <span className={styles.supporting} style={{ color: 'var(--danger)' }}>{connectError}</span>
                            )}
                            <span className={styles.supporting}>Enter your device PIN to connect to cloud management.</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Google credentials - hidden when managed */}
            {!isManaged && (
                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Google API Authentication</label>
                        <textarea
                            defaultValue={JSON.stringify(config.server.google, null, 4)}
                            onBlur={e => {
                                try {
                                    const parsed = JSON.parse(e.target.value);
                                    setJson.mutate({ key: 'server.google', value: parsed });
                                } catch {
                                    alert('Invalid JSON');
                                }
                            }}
                        />
                    </div>
                </div>
            )}

        </div>
    );
}
