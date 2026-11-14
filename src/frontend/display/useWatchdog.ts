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
    const report = trpc.server.watchdogFired.useMutation();

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

            // If a caption frame has never arrived this session, fall back to page-load
            // time as the reference point — a stream that fails on its very first attempt
            // (never worked, so lastFrameTime stays 0) is exactly as stuck as one that
            // worked and then died, and deserves the same recovery.
            const referenceTime = lastFrameTime.current || pageLoadTime.current;

            // Captions still flowing recently
            if (now - referenceTime < WATCHDOG_TRIGGER_MS) return;

            // Require sustained mic activity (~45s) to confirm it's a real stuck state,
            // not just a quiet period with an occasional throat-clear
            if (micActiveCallsSinceFrame.current < WATCHDOG_MIC_CALLS_THRESHOLD) return;

            const reloads = parseInt(sessionStorage.getItem('watchdogReloads') || '0');
            const reason = lastFrameTime.current === 0
                ? `no captions ever received, ${Math.round((now - referenceTime) / 1000)}s since page load, while mic active`
                : `no captions for ${Math.round((now - referenceTime) / 1000)}s while mic active`;
            console.log(`[WATCHDOG] firing: lastFrame=${now - lastFrameTime.current}ms ago, micActiveCalls=${micActiveCallsSinceFrame.current}, reloads=${reloads}`);
            if (reloads < 1) {
                sessionStorage.setItem('watchdogReloads', String(reloads + 1));
                console.log('[WATCHDOG] reloading page');
                // Report first (best effort), but never let the report hold up the reload.
                let reloaded = false;
                const reload = () => {
                    if (reloaded) return;
                    reloaded = true;
                    window.location.reload();
                };
                report.mutate({ action: 'reload', reason }, { onSettled: reload });
                setTimeout(reload, 1000);
            } else {
                sessionStorage.setItem('watchdogReloads', '0');
                console.log('[WATCHDOG] calling server.restart');
                report.mutate({ action: 'restart', reason });
                restart.mutate(undefined, {
                    onSettled: () => setTimeout(() => window.location.reload(), 3000),
                });
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [enabled]);

    return { recordFrame, recordMicActive };
}
