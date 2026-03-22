import React, { useState } from 'react';
import { AppConfig } from '../../shared/types';
import { trpc } from '../../shared/trpc';
import styles from '../settings.module.css';

interface Props {
    config: AppConfig;
    onRefresh: () => void;
}

export function ServerTab({ config, onRefresh }: Props) {
    const set = trpc.config.set.useMutation({ onSuccess: onRefresh });
    const setJson = trpc.config.setJson.useMutation({ onSuccess: onRefresh });
    const connect = trpc.cloud.connect.useMutation({ onSuccess: onRefresh });
    const disconnect = trpc.cloud.disconnect.useMutation({ onSuccess: onRefresh });
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
                        <div>
                            <p style={{ marginBottom: 8, color: '#4caf50', fontWeight: 'bold' }}>
                                ✓ Connected as: {cloudStatus?.deviceName ?? 'Unknown'}
                            </p>
                            <button onClick={handleDisconnect} disabled={disconnect.isPending}>
                                {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
                            </button>
                        </div>
                    ) : (
                        <div>
                            <input
                                type="text"
                                value={pin}
                                onChange={e => setPin(e.target.value)}
                                placeholder="Enter device PIN"
                                style={{ marginBottom: 8 }}
                            />
                            <button onClick={handleConnect} disabled={connect.isPending || !pin}>
                                {connect.isPending ? 'Connecting...' : 'Connect'}
                            </button>
                            {connectError && (
                                <p style={{ color: 'red', fontSize: 12, marginTop: 4 }}>{connectError}</p>
                            )}
                        </div>
                    )}
                    <span className={styles.supporting}>
                        Enter your device PIN to connect to cloud management. The API key will be managed for you.
                    </span>
                </div>
            </div>

            {/* Google credentials — hidden when managed */}
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

            {isManaged && (
                <div className={styles.row}>
                    <div className={styles.field}>
                        <span className={styles.supporting} style={{ fontStyle: 'italic' }}>
                            Google API credentials are managed by your administrator.
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
