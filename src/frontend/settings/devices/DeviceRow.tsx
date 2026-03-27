import React, { useState, useEffect } from 'react';
import { InputConfig, PhysicalDevice } from '../../shared/types';
import { VolumeBar } from './VolumeBar';
import { LanguageSelect } from './LanguageSelect';
import { VolumeEntry, StreamingState } from '../useVolumes';
import styles from '../settings.module.css';

const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

interface Props {
    device: InputConfig;
    physicalDevices: PhysicalDevice[];
    volumeEntry: VolumeEntry | undefined;
    connected: boolean;
    onRemove: () => void;
    onChange: (updated: InputConfig) => void;
}

export function DeviceRow({ device, physicalDevices, volumeEntry, connected, onRemove, onChange }: Props) {
    const isStale = !device.thresholdLastSet || (Date.now() - device.thresholdLastSet > FOUR_DAYS_MS);
    const [local, setLocal] = useState<InputConfig>({
        ...device,
        autoThreshold: device.autoThreshold ?? isStale,
        languages: device.languages ?? ['en-us'],
    });

    useEffect(() => {
        onChange(local);
    }, [local]);

    const update = (patch: Partial<InputConfig>) => setLocal(prev => ({ ...prev, ...patch }));

    const liveThreshold = (local.autoThreshold && volumeEntry) ? volumeEntry.threshold : local.threshold;
    const liveVolume = volumeEntry?.volume ?? 0;
    const isActive = liveVolume > liveThreshold;
    const engineState = volumeEntry?.state;

    const micDotClass = !connected
        ? styles.micDotOffline
        : isActive
            ? styles.micDotActive
            : styles.micDotInactive;

    const stateLabel = !connected ? null
        : engineState === StreamingState.ACTIVE  ? { text: 'Streaming', cls: styles.stateBadgeStreaming }
        : engineState === StreamingState.PAUSED  ? { text: 'Paused',    cls: styles.stateBadgePaused }
        : engineState === StreamingState.DESTROYED ? { text: 'Stopped', cls: styles.stateBadgeStopped }
        : null;

    return (
        <div className={styles.deviceCard}>
            <div className={styles.deviceHeader}>
                <div
                    className={`${styles.micDot} ${micDotClass}`}
                    title={!connected ? 'Offline' : isActive ? 'Speaking' : 'Silent'}
                />
                <span className={styles.deviceTitle}>
                    {local.speaker || 'Unnamed device'}
                </span>
                {stateLabel && (
                    <span className={`${styles.stateBadge} ${stateLabel.cls}`}>
                        {stateLabel.text}
                    </span>
                )}
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={onRemove}>
                    Remove
                </button>
            </div>

            <div className={styles.deviceFields}>
                <div className={styles.field} style={{ minWidth: 130 }}>
                    <label>Speaker Name</label>
                    <input
                        type="text"
                        value={local.speaker ?? ''}
                        onChange={e => update({ speaker: e.target.value })}
                        placeholder="e.g. Presenter"
                    />
                </div>

                <div className={styles.field} style={{ minWidth: 200 }}>
                    <label>Input Device</label>
                    <select
                        value={local.device}
                        onChange={e => {
                            const id = parseInt(e.target.value);
                            const pd = physicalDevices.find(d => d.id === id);
                            update({ device: id, deviceName: pd?.name });
                        }}
                    >
                        <option value="">Default</option>
                        {physicalDevices.map(pd => (
                            <option key={pd.id} value={pd.id}>{pd.name}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.field} style={{ minWidth: 110 }}>
                    <label>Color</label>
                    <div className={styles.colorSwatch}>
                        <div
                            className={styles.colorSwatchDot}
                            style={{ background: /^#[0-9a-fA-F]{3,6}$/.test(local.color) ? local.color : '#fff' }}
                        />
                        <input
                            type="text"
                            value={local.color}
                            onChange={e => update({ color: e.target.value })}
                            placeholder="#FFFFFF"
                            style={{ fontFamily: 'monospace', flex: 1 }}
                        />
                    </div>
                </div>

                <div className={styles.field} style={{ minWidth: 90 }}>
                    <label>Channel</label>
                    <input
                        type="number"
                        min={1}
                        value={(local.channel ?? 0) + 1}
                        onChange={e => update({ channel: parseInt(e.target.value) - 1 })}
                    />
                </div>

                <div className={styles.field} style={{ minWidth: 160 }}>
                    <label>Language</label>
                    <LanguageSelect
                        value={local.languages}
                        onChange={langs => update({ languages: langs })}
                    />
                </div>
            </div>

            {/* Auto / manual toggle inside the VolumeBar area */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label className={styles.autoLabel}>
                    <input
                        type="checkbox"
                        checked={!!local.autoThreshold}
                        onChange={e => {
                            const auto = e.target.checked;
                            update({
                                autoThreshold: auto,
                                thresholdLastSet: auto ? local.thresholdLastSet : Date.now(),
                            });
                        }}
                    />
                    Auto threshold
                </label>
                {local.autoThreshold && (
                    <span className={styles.supporting} style={{ fontSize: 11 }}>
                        (adjusts based on ambient noise)
                    </span>
                )}
            </div>

            <VolumeBar
                volume={liveVolume}
                threshold={liveThreshold}
                auto={!!local.autoThreshold}
                onThresholdChange={val => update({ threshold: val, thresholdLastSet: Date.now(), autoThreshold: false })}
            />
        </div>
    );
}
