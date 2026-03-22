import React, { useState, useEffect } from 'react';
import { trpc } from '../shared/trpc';
import { AppConfig, PhysicalDevice } from '../shared/types';
import { useVolumes, ConnectionStatus } from './useVolumes';
import { DisplayTab } from './tabs/DisplayTab';
import { TranscriptionTab } from './tabs/TranscriptionTab';
import { ServerTab } from './tabs/ServerTab';
import { AboutTab } from './tabs/AboutTab';
import styles from './settings.module.css';

type Tab = 'display' | 'transcription' | 'server' | 'about';

const TABS: { id: Tab; label: string }[] = [
    { id: 'display',       label: 'Display' },
    { id: 'transcription', label: 'Transcription' },
    { id: 'server',        label: 'Server' },
    { id: 'about',         label: 'About' },
];

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
    const label = status === 'connected' ? 'Connected'
        : status === 'connecting'        ? 'Connecting…'
        :                                  'Disconnected';
    return (
        <div className={`${styles.connectionBadge} ${styles[status]}`}>
            <div className={styles.connectionDot} />
            {label}
        </div>
    );
}

export function SettingsApp() {
    const initialTab = (window.location.hash.slice(1) as Tab) || 'display';
    const [activeTab, setActiveTab] = useState<Tab>(
        TABS.some(t => t.id === initialTab) ? initialTab : 'display'
    );

    const configQuery = trpc.config.get.useQuery();
    const devicesQuery = trpc.devices.list.useQuery();
    const utils = trpc.useUtils();

    // Single volumes subscription - shared across header badge + TranscriptionTab
    const { volumes, connected } = useVolumes();

    useEffect(() => {
        window.history.replaceState(null, document.title, `/settings.html#${activeTab}`);
    }, [activeTab]);

    function refresh() {
        utils.config.get.invalidate();
        utils.devices.list.invalidate();
    }

    const isLoading = !configQuery.data || !devicesQuery.data;

    return (
        <div className={styles.container}>
            <div className={styles.appHeader}>
                <span className={styles.appTitle}>Live Captions - Settings</span>
                <ConnectionBadge status={connected} />
            </div>

            {connected === 'disconnected' && (
                <div className={`${styles.alertBanner} ${styles.error}`}>
                    ⚠ Lost connection to the server. Mic levels and changes may not apply until reconnected.
                </div>
            )}

            {isLoading ? (
                <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Loading settings…
                </div>
            ) : (
                <>
                    <div className={styles.tabs}>
                        {TABS.map(t => (
                            <button
                                key={t.id}
                                className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                                onClick={() => setActiveTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'display' && (
                        <DisplayTab config={configQuery.data as AppConfig} onRefresh={refresh} />
                    )}
                    {activeTab === 'transcription' && (
                        <TranscriptionTab
                            config={configQuery.data as AppConfig}
                            physicalDevices={devicesQuery.data as PhysicalDevice[]}
                            volumes={volumes}
                            connected={connected}
                            onRefresh={refresh}
                        />
                    )}
                    {activeTab === 'server' && (
                        <ServerTab config={configQuery.data as AppConfig} onRefresh={refresh} />
                    )}
                    {activeTab === 'about' && (
                        <AboutTab />
                    )}
                </>
            )}
        </div>
    );
}
