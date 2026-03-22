import { useEffect, useRef } from 'react';
import { trpc } from '../shared/trpc';

const WATCHDOG_TRIGGER_MS = 20000;
const WATCHDOG_GRACE_MS = 15000;

export function useWatchdog() {
    const lastFrameTime = useRef(0);
    const micActiveLastSeen = useRef(0);
    const pageLoadTime = useRef(Date.now());
    const restart = trpc.server.restart.useMutation();

    function recordFrame() {
        lastFrameTime.current = Date.now();
        sessionStorage.setItem('watchdogReloads', '0');
    }

    function recordMicActive() {
        micActiveLastSeen.current = Date.now();
    }

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            if (now - pageLoadTime.current < WATCHDOG_GRACE_MS) return;
            if (now - micActiveLastSeen.current > 3000) return;
            if (lastFrameTime.current > 0 && now - lastFrameTime.current < WATCHDOG_TRIGGER_MS) return;
            if (lastFrameTime.current === 0 && now - pageLoadTime.current < WATCHDOG_TRIGGER_MS) return;

            const reloads = parseInt(sessionStorage.getItem('watchdogReloads') || '0');
            if (reloads < 1) {
                sessionStorage.setItem('watchdogReloads', String(reloads + 1));
                window.location.reload();
            } else {
                sessionStorage.setItem('watchdogReloads', '0');
                restart.mutate(undefined, {
                    onSettled: () => setTimeout(() => window.location.reload(), 3000),
                });
            }
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    return { recordFrame, recordMicActive };
}
