import { existsSync, mkdirSync } from 'fs';
import { RtAudio, RtAudioApi } from 'audify';
import { Server } from './server';
import { Speech } from './speech';
import { ConfigManager } from './util/configManager';
import { InputConfig } from './types/Config';
import { updateBadWordsList, updateTransformations } from './util/downloadBadWordsFIM';
import { update } from './util/updater';
import { GoogleV2 } from './engines/GoogleV2';
import { GoogleV1 } from './engines/GoogleV1';
import { April, downloadDependencies } from './engines/April';
import { createAppRouter } from './trpc/router';
import { micBus } from './util/eventBus';
import { CloudSync } from './util/cloudSync';

export const PROGRAM_FOLDER = process.platform === 'win32'
    ? process.env.APPDATA + '/live-captions'
    : process.env.HOME + '/.config/live-captions';

let server: Server;
let cloudSync: CloudSync | null = null;

let speechServices: Speech<GoogleV1 | GoogleV2 | April>[] = [];
let isStarting: boolean = false;

if (!process.argv.includes('--skip-update-check')) {
    update().then(start);
} else {
    start();
}

let volumeInterval: NodeJS.Timeout;
let updateInterval: NodeJS.Timeout;

async function start() {
    // Prevent multiple simultaneous start() calls
    if (isStarting) {
        console.log('start() already in progress, skipping duplicate call');
        return;
    }
    isStarting = true;
    // Create program folder
    if (!existsSync(PROGRAM_FOLDER)) {
        mkdirSync(PROGRAM_FOLDER);
        console.log('Created ' + PROGRAM_FOLDER);
    }

    // Generate/load config
    const config = new ConfigManager(PROGRAM_FOLDER + '/config.json');
    try {
        await updateBadWordsList(config);
        await updateTransformations(config);
    } catch (err) {
        console.error('Failed to update bad words list or transformations', err);
    }

    const engine = config.transcription.engine;

    if (engine === 'april') {
        await downloadDependencies();
    }

    // Kill server and speeches if they're already running
    if (server) {
        server.stop();
    }

    if (engine === 'april' && speechServices.length > 0) {
        let promises = [];
        for (let speech of speechServices) {
            promises.push(speech.destroy());
        }
        await Promise.all(promises);
    } else {
        for (let speech of speechServices) {
            speech.destroy();
        }
    }
    speechServices = [];


    // Create a asio interface
    const rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);

    let noClientsPauseTimer: NodeJS.Timeout | undefined;

    function cancelPauseTimer() {
        if (noClientsPauseTimer) {
            clearTimeout(noClientsPauseTimer);
            noClientsPauseTimer = undefined;
        }
    }

    // Track subscription counts for pause/suspend scheduling
    let displaySubCount = 0;
    let settingsSubCount = 0;

    function schedulePauseIfEmpty() {
        // Pause only after 30s with no display or settings clients at all
        if (displaySubCount > 0 || settingsSubCount > 0) {
            cancelPauseTimer();
        } else if (!noClientsPauseTimer) {
            noClientsPauseTimer = setTimeout(() => {
                noClientsPauseTimer = undefined;
                console.log('No clients for 30s - pausing speech engines');
                speechServices.forEach(s => s.suspend());
            }, 30000);
        }
    }

    cloudSync?.stopConnections();
    cloudSync = new CloudSync(config, () => speechServices, () => rtAudio.getDevices(), start);
    await cloudSync.initialize();

    const appRouter = createAppRouter({
        config,
        cloudSync,
        getSpeechServices: () => speechServices,
        getRtAudio: () => rtAudio,
        restart: start,
        onDisplayConnect: () => {
            displaySubCount++;
            cancelPauseTimer();
            speechServices.forEach(s => s.unsuspend());
        },
        onDisplayDisconnect: () => {
            displaySubCount = Math.max(0, displaySubCount - 1);
            schedulePauseIfEmpty();
        },
        onSettingsConnect: () => {
            settingsSubCount++;
            cancelPauseTimer();
        },
        onSettingsDisconnect: () => {
            settingsSubCount = Math.max(0, settingsSubCount - 1);
            schedulePauseIfEmpty();
        },
    });

    // Start web server
    server = new Server(config, rtAudio, appRouter);
    server.start();


    if (volumeInterval) clearInterval(volumeInterval);

    let volumeTickCount = 0;
    volumeInterval = setInterval(() => {
        // Send mic active status to display clients once per second (every 20 × 50ms ticks)
        if (volumeTickCount % 20 === 0) {
            micBus.emit('status', {
                devices: speechServices.map((s: Speech<GoogleV1 | GoogleV2 | April>) => ({
                    id: s.inputConfig.id,
                    active: s.volume >= s.effectiveThreshold
                }))
            });
        }
        volumeTickCount++;
    }, 50);

    if (updateInterval) clearInterval(updateInterval);

    updateInterval = setInterval(async () => {
        try {
            await updateBadWordsList(config);
            await updateTransformations(config);
        } catch (err) {
            console.error('Failed to update bad words list or transformations', err);
        }
    }, 60e3 * 15); // 15 minutes

    // For development testing simulating semi-realistic captions
    if (process.argv.includes('--gibberish')) {
        require('./util/developmentGibberish').gibberish(null, 2);
        isStarting = false;
        return;
    }

    // Start speech recognition
    for (let input of <InputConfig[]>config.transcription.inputs) {
        if (engine === 'googlev1') {
            const speech = new Speech(config, input, GoogleV1, start);
            speech.startStreaming();
            speechServices.push(speech);
        } else if (engine === 'april') {
            const speech = new Speech(config, input, April, start);
            speech.startStreaming();
            speechServices.push(speech);
        } else {
            const speech = new Speech(config, input, GoogleV2, start);
            speech.startStreaming();
            speechServices.push(speech);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    isStarting = false;
};
