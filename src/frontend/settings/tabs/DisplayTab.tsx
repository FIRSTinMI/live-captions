import React from 'react';
import { AppConfig } from '../../shared/types';
import { trpc } from '../../shared/trpc';
import styles from '../settings.module.css';

interface Props {
    config: AppConfig;
    onRefresh: () => void;
}

export function DisplayTab({ config, onRefresh }: Props) {
    const set = trpc.config.set.useMutation({ onSuccess: onRefresh });
    const hide = trpc.display.hide.useMutation({ onSuccess: onRefresh });
    const clear = trpc.display.clear.useMutation();

    const { display } = config;

    return (
        <div>
            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Position</label>
                    <select
                        defaultValue={display.position}
                        onChange={e => set.mutate({ key: 'display.position', value: e.target.value })}
                    >
                        <option value="0">Bottom</option>
                        <option value="1">Top</option>
                        <option value="2">Bottom with space for audience display</option>
                        <option value="3">Top with space for audience display</option>
                    </select>
                </div>
                <div className={styles.field}>
                    <label>Alignment</label>
                    <select
                        defaultValue={display.align}
                        onChange={e => set.mutate({ key: 'display.align', value: e.target.value })}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                </div>
                <div className={styles.field}>
                    <label>Chroma Key</label>
                    <input
                        type="text"
                        defaultValue={display.chromaKey}
                        onBlur={e => set.mutate({ key: 'display.chromaKey', value: e.target.value })}
                        placeholder="rgba(0,0,0,0)"
                    />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Text Size (px)</label>
                    <input
                        type="number"
                        defaultValue={display.size}
                        onBlur={e => set.mutate({ key: 'display.size', value: e.target.value })}
                    />
                </div>
                <div className={styles.field}>
                    <label>Max Lines</label>
                    <input
                        type="number"
                        defaultValue={display.lines}
                        onBlur={e => set.mutate({ key: 'display.lines', value: e.target.value })}
                    />
                </div>
                <div className={styles.field}>
                    <label>Timeout (s)</label>
                    <input
                        type="number"
                        defaultValue={display.timeout}
                        onBlur={e => set.mutate({ key: 'display.timeout', value: e.target.value })}
                    />
                </div>
            </div>
            <div className={styles.row}>
                <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => hide.mutate({ value: !display.hidden })}
                >
                    {display.hidden ? 'Show Captions' : 'Hide Captions'}
                </button>
                <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => clear.mutate()}
                >
                    Clear Captions
                </button>
            </div>
        </div>
    );
}
