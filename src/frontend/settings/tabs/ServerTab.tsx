import React from 'react';
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
        </div>
    );
}
