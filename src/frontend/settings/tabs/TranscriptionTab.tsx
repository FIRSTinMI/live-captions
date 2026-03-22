import React, { useState } from 'react';
import { AppConfig, InputConfig, PhysicalDevice } from '../../shared/types';
import { trpc } from '../../shared/trpc';
import { DeviceRow } from '../devices/DeviceRow';
import { VolumeEntry, ConnectionStatus } from '../useVolumes';
import styles from '../settings.module.css';

const DEFAULT_COLORS = ['#EF5350', '#42A5F5', '#FFC107', '#D500F9', '#8BC34A', '#FFFFFF'];
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

interface Props {
    config: AppConfig;
    physicalDevices: PhysicalDevice[];
    volumes: Map<number, VolumeEntry>;
    connected: ConnectionStatus;
    onRefresh: () => void;
}

function makeNewDevice(index: number): InputConfig {
    return {
        id: index,
        device: 0,
        speaker: '',
        channel: 0,
        sampleRate: 16000,
        color: DEFAULT_COLORS[index >= DEFAULT_COLORS.length ? DEFAULT_COLORS.length - 1 : index],
        driver: 7,
        threshold: 10,
        autoThreshold: true,
        thresholdLastSet: undefined,
        languages: ['en-us'],
    };
}

export function TranscriptionTab({ config, physicalDevices, volumes, connected, onRefresh }: Props) {
    const [devices, setDevices] = useState<InputConfig[]>(config.transcription.inputs);

    const setInputs = trpc.config.setInputs.useMutation();
    const setArray = trpc.config.setArray.useMutation({ onSuccess: onRefresh });
    const setEngine = trpc.config.set.useMutation({ onSuccess: onRefresh });
    const restart = trpc.server.restart.useMutation();

    function addDevice() {
        setDevices(prev => [...prev, makeNewDevice(prev.length)]);
    }

    function removeDevice(index: number) {
        setDevices(prev => prev.filter((_, i) => i !== index));
    }

    function updateDevice(index: number, updated: InputConfig) {
        setDevices(prev => prev.map((d, i) => i === index ? updated : d));
    }

    function applyAndRestart() {
        const toSave = devices.map((d, i) => ({ ...d, id: i, driver: 7 }));
        setInputs.mutate(toSave, {
            onSuccess: () => {
                restart.mutate(undefined, {
                    onSuccess: () => {
                        alert('Settings saved, restarting server.');
                        onRefresh();
                    },
                });
            },
        });
    }

    return (
        <div>
            <div className={styles.sectionHeader}>
                <h3>Devices</h3>
                <button className={`${styles.btn} ${styles.btnSuccess}`} onClick={addDevice}>
                    + Add Device
                </button>
            </div>

            {devices.length === 0 && (
                <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
                    No devices configured. Click "Add Device" to get started.
                </p>
            )}

            {devices.map((device, index) => (
                <DeviceRow
                    key={index}
                    device={device}
                    physicalDevices={physicalDevices}
                    volumeEntry={volumes.get(device.id)}
                    connected={connected === 'connected'}
                    onRemove={() => removeDevice(index)}
                    onChange={updated => updateDevice(index, updated)}
                />
            ))}

            <div className={styles.row} style={{ marginTop: 16 }}>
                <div className={styles.field}>
                    <label>Transcription Engine</label>
                    <select
                        defaultValue={config.transcription.engine}
                        onChange={e => setEngine.mutate({ key: 'transcription.engine', value: e.target.value })}
                    >
                        <option value="googlev1">Google V1</option>
                        <option value="googlev2">Google V2</option>
                        <option value="april">April ASR (local) - Beta</option>
                    </select>
                </div>
            </div>

            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Profanity Filter</label>
                    <textarea
                        className={styles.blurredTextarea}
                        defaultValue={config.transcription.filter.join('\n')}
                        onBlur={e => setArray.mutate({
                            key: 'transcription.filter',
                            value: e.target.value.split('\n').filter(Boolean),
                        })}
                    />
                    <span className={styles.supporting}>
                        One word per line - +word adds, -word removes. Click to reveal.
                    </span>
                </div>
            </div>

            <div className={styles.row}>
                <div className={styles.field}>
                    <label>Phrase Sets</label>
                    <textarea
                        defaultValue={config.transcription.phraseSets.join('\n')}
                        onBlur={e => setArray.mutate({
                            key: 'transcription.phraseSets',
                            value: e.target.value.split('\n').filter(Boolean),
                        })}
                    />
                    <span className={styles.supporting}>Must be configured with GCloud</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
                <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={applyAndRestart}
                    disabled={setInputs.isPending || restart.isPending}
                >
                    {(setInputs.isPending || restart.isPending) ? 'Saving…' : 'Apply & Restart'}
                </button>
                {restart.isSuccess && (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Restarted</span>
                )}
            </div>
        </div>
    );
}
