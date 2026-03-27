import { useEffect, useRef } from 'react';
import { trpc } from '../shared/trpc';

const WATCHDOG_TRIGGER_MS = 20000;   // no captions for this long → potential stuck state
const WATCHDOG_GRACE_MS = 15000;     // ignore watchdog immediately after page load
const WATCHDOG_MIC_CALLS_THRESHOLD = 45; // ~45 seconds of mic-above-threshold activity required

export function useWatchdog(enabled: boolean) {
    const lastFrameTime = useRef(0);
    const micActiveCallsSinceFrame = useRef(0);
    const lastMicActiveTime = useRef(0);
    const pageLoadTime = useRef(Date.now());
    const restart = trpc.server.restart.useMutation();

    function recordFrame() {
        lastFrameTime.current = Date.now();
        micActiveCallsSinceFrame.current = 0;
        sessionStorage.setItem('watchdogReloads', '0');
    }

    function recordMicActive() {
        const now = Date.now();
        // Reset counter if mic has been quiet for more than 10 seconds (not continuous activity)
        if (lastMicActiveTime.current > 0 && now - lastMicActiveTime.current > 10000) {
            micActiveCallsSinceFrame.current = 0;
        }
        lastMicActiveTime.current = now;
        micActiveCallsSinceFrame.current++;
        console.log(`[WATCHDOG] recordMicActive called, micActiveCalls=${micActiveCallsSinceFrame.current}`);
    }

    useEffect(() => {
        const interval = setInterval(() => {
            if (!enabled) return;
            const now = Date.now();

            // Ignore during startup grace period
            if (now - pageLoadTime.current < WATCHDOG_GRACE_MS) return;

            // Only fire if captions previously worked — if lastFrameTime is 0
            // transcription never started this session and a restart won't help
            if (lastFrameTime.current === 0) return;

            // Captions still flowing recently
            if (now - lastFrameTime.current < WATCHDOG_TRIGGER_MS) return;

            // Require sustained mic activity (~45s) to confirm it's a real stuck state,
            // not just a quiet period with an occasional throat-clear
            if (micActiveCallsSinceFrame.current < WATCHDOG_MIC_CALLS_THRESHOLD) return;

            const reloads = parseInt(sessionStorage.getItem('watchdogReloads') || '0');
            console.log(`[WATCHDOG] firing: lastFrame=${now - lastFrameTime.current}ms ago, micActiveCalls=${micActiveCallsSinceFrame.current}, reloads=${reloads}`);
            if (reloads < 1) {
                sessionStorage.setItem('watchdogReloads', String(reloads + 1));
                console.log('[WATCHDOG] reloading page');
                window.location.reload();
            } else {
                sessionStorage.setItem('watchdogReloads', '0');
                console.log('[WATCHDOG] calling server.restart');
                restart.mutate(undefined, {
                    onSettled: () => setTimeout(() => window.location.reload(), 3000),
                });
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [enabled]);

    return { recordFrame, recordMicActive };
}
