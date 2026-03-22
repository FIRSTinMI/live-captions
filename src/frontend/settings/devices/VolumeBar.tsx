import React from 'react';
import styles from '../settings.module.css';

interface Props {
    volume: number;
    threshold: number;
    auto: boolean;
    onThresholdChange: (value: number) => void;
}

export function VolumeBar({ volume, threshold, auto, onThresholdChange }: Props) {
    const isActive = volume > threshold;
    const clampedVolume = Math.max(0, Math.min(100, volume));
    const clampedThreshold = Math.max(0, Math.min(100, threshold));

    return (
        <div className={styles.thresholdSection}>
            <div className={styles.thresholdHeader}>
                <div className={styles.thresholdHeaderLeft}>
                    <span>Noise Gate</span>
                    <label className={styles.autoLabel}>
                        {auto ? 'Auto' : 'Manual'}
                    </label>
                </div>
                <span className={styles.thresholdValue}>{Math.round(clampedThreshold)}</span>
            </div>

            {/* Volume bar - block, above slider */}
            <div className={styles.volumeBarWrap}>
                <div
                    className={`${styles.volumeBar} ${isActive ? styles.volumeBarActive : ''}`}
                    style={{ width: `${clampedVolume}%` }}
                />
            </div>

            {/* Threshold slider - block, below bar, no overlap */}
            <input
                type="range"
                className={styles.thresholdSlider}
                min={0}
                max={100}
                value={clampedThreshold}
                disabled={auto}
                onChange={e => onThresholdChange(parseInt(e.target.value))}
            />
        </div>
    );
}
