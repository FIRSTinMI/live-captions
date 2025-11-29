import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Speech, StreamingState } from '../speech';
import { GoogleV2 } from '../engines/GoogleV2';
import { ConfigManager } from '../util/configManager';
import WebSocket from 'ws';
import { InputConfig } from '../types/Config';
import { RtAudioApi } from 'audify';
import { join } from 'path';
import { PROGRAM_FOLDER } from '..';

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Speech Class with Manual PCM Feeding', () => {
    let configManager: ConfigManager;

    beforeAll(() => {
        // Load actual config from config.json to get real API credentials
        const configPath = join(PROGRAM_FOLDER, 'config.json');
        configManager = new ConfigManager(configPath);

        // Override transcription settings for test purposes
        configManager.transcription.filter = [];
        configManager.transcription.streamingTimeout = 2000; // 2 seconds = 200 frames (each frame is 10ms)
        configManager.transcription.inputs = [];
    });

    function createSpeechInstance(): Speech<GoogleV2> {
        const mockClients: WebSocket[] = [];
        const inputConfig: InputConfig = {
            id: 1,
            device: 0,
            speaker: 'Test Speaker',
            channel: 0,
            sampleRate: 16000,
            color: '#FFFFFF',
            driver: RtAudioApi.WINDOWS_ASIO,
            threshold: 0.01 // Low threshold so generated noise triggers it
        };

        const restartFn = () => {
            // Restart handler
        };

        // Create Speech instance in mock mode (no rtAudio input)
        // This allows us to manually feed PCM data for testing
        return new Speech<GoogleV2>(
            configManager,
            mockClients,
            inputConfig,
            GoogleV2,
            restartFn,
            true // mockMode = true
        );
    }

    it('should process audio above threshold as speaking', () => {
        const speech = createSpeechInstance();

        // Create a PCM buffer with noise (above threshold)
        const noiseBuffer = createNoisePCMBuffer();

        const initialVolume = speech.volume;
        speech.feedPCMData(noiseBuffer);

        // Volume should increase after feeding noisy data
        expect(speech.volume).toBeGreaterThan(initialVolume);

        speech.destroy();
    });

    it('should pause stream after 2 seconds of silence', async () => {
        const speech = createSpeechInstance();

        // Feed 2 seconds of noise (200 frames of 10ms each)
        console.log('Feeding 2 seconds of noise...');
        for (let i = 0; i < 200; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10); // Each frame is 10ms
        }

        // Now feed silence for 2+ seconds (200+ frames)
        // With streamingTimeout of 2000ms, it should pause after 200 frames
        console.log('Feeding 2+ seconds of silence...');
        for (let i = 0; i < 220; i++) {
            const silenceBuffer = createSilencePCMBuffer();
            speech.feedPCMData(silenceBuffer);
            await sleep(10); // Each frame is 10ms
        }

        // After sufficient silence, streamingShutoff should be true
        expect(speech.getState).toBe(StreamingState.PAUSED);

        speech.destroy();
    });

    it('should resume stream when sound is detected after pause', async () => {
        const speech = createSpeechInstance();

        // Feed silence to trigger pause
        console.log('Feeding silence to trigger pause...');
        for (let i = 0; i < 220; i++) {
            const silenceBuffer = createSilencePCMBuffer();
            speech.feedPCMData(silenceBuffer);
            await sleep(10); // Each frame is 10ms
        }

        // Verify streamingShutoff is true (paused)
        expect(speech.getState).toBe(StreamingState.PAUSED);

        // Feed noise to resume
        console.log('Feeding noise to resume...');
        for (let i = 0; i < 10; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10); // Each frame is 10ms
        }

        // streamingShutoff should be false (resumed)
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        speech.destroy();
    });

    it('should follow the complete cycle: speak -> silence -> pause -> speak -> resume', async () => {
        const speech = createSpeechInstance();

        // Phase 1: 2 seconds of speech (200 frames)
        console.log('Phase 1: Feeding 2 seconds of noise (speaking)...');
        for (let i = 0; i < 200; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10); // Each frame is 10ms
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE); // Should not be paused during speech

        // Phase 2: 2+ seconds of silence (220 frames)
        console.log('Phase 2: Feeding 2+ seconds of silence...');
        for (let i = 0; i < 220; i++) {
            const silenceBuffer = createSilencePCMBuffer();
            speech.feedPCMData(silenceBuffer);
            await sleep(10); // Each frame is 10ms
        }
        expect(speech.getState).toBe(StreamingState.PAUSED); // Should be paused after silence timeout

        // Phase 3: Resume speaking (20 frames)
        console.log('Phase 3: Feeding noise to resume...');
        for (let i = 0; i < 20; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10); // Each frame is 10ms
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE); // Should be resumed when noise is detected

        console.log('✓ Complete cycle test passed');

        speech.destroy();
    });

    it('should handle immediate speech after exact 2 seconds of silence', async () => {
        const speech = createSpeechInstance();

        // Feed initial noise
        for (let i = 0; i < 50; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10);
        }

        // Feed exactly 2 seconds of silence (200 frames)
        console.log('Feeding exactly 2 seconds of silence...');
        for (let i = 0; i < 200; i++) {
            const silenceBuffer = createSilencePCMBuffer();
            speech.feedPCMData(silenceBuffer);
            await sleep(10);
        }

        // Should still be active at exactly 2 seconds
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        // Immediately feed noise (before the +1 frame that would trigger pause)
        console.log('Immediately resuming with noise...');
        for (let i = 0; i < 50; i++) {
            const noiseBuffer = createNoisePCMBuffer();
            speech.feedPCMData(noiseBuffer);
            await sleep(10);
        }

        // Should remain ACTIVE
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        speech.destroy();
    });

    it('should handle quick silence-speech-silence cycles', async () => {
        const speech = createSpeechInstance();

        // Cycle 1: Speak -> Silence -> Speak
        console.log('Cycle 1: Speak');
        for (let i = 0; i < 100; i++) {
            speech.feedPCMData(createNoisePCMBuffer());
            if (i % 10 === 0) await sleep(5); // Sleep periodically to reduce pressure
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        console.log('Cycle 1: Silence');
        for (let i = 0; i < 150; i++) {
            speech.feedPCMData(createSilencePCMBuffer());
            if (i % 10 === 0) await sleep(5);
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE); // Still active (not at timeout yet)

        console.log('Cycle 1: Speak again');
        for (let i = 0; i < 100; i++) {
            speech.feedPCMData(createNoisePCMBuffer());
            if (i % 10 === 0) await sleep(5);
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        // Cycle 2: Long silence to trigger pause
        console.log('Cycle 2: Long silence to pause');
        for (let i = 0; i < 220; i++) {
            speech.feedPCMData(createSilencePCMBuffer());
            if (i % 20 === 0) await sleep(5);
        }
        expect(speech.getState).toBe(StreamingState.PAUSED);

        // Cycle 3: Resume after pause
        console.log('Cycle 3: Resume');
        for (let i = 0; i < 50; i++) {
            speech.feedPCMData(createNoisePCMBuffer());
            if (i % 10 === 0) await sleep(5);
        }
        expect(speech.getState).toBe(StreamingState.ACTIVE);

        speech.destroy();
    });

    it('should handle multiple concurrent Speech instances independently', async () => {
        const speech1 = createSpeechInstance();
        const speech2 = createSpeechInstance();

        // Instance 1: Only noise
        console.log('Instance 1: Feeding noise...');
        for (let i = 0; i < 100; i++) {
            speech1.feedPCMData(createNoisePCMBuffer());
            if (i % 10 === 0) await sleep(5);
        }

        // Instance 2: Noise then pause (in parallel-ish fashion)
        console.log('Instance 2: Feeding noise...');
        for (let i = 0; i < 50; i++) {
            speech2.feedPCMData(createNoisePCMBuffer());
            if (i % 10 === 0) await sleep(5);
        }

        console.log('Instance 2: Feeding silence to pause...');
        for (let i = 0; i < 220; i++) {
            speech2.feedPCMData(createSilencePCMBuffer());
            if (i % 20 === 0) await sleep(5);
        }

        // Verify independent states
        expect(speech1.getState).toBe(StreamingState.ACTIVE);
        expect(speech2.getState).toBe(StreamingState.PAUSED);

        console.log('Instance states: 1=ACTIVE, 2=PAUSED');

        speech1.destroy();
        speech2.destroy();
    });

    it('should maintain independent state after interleaved operations', async () => {
        const speech1 = createSpeechInstance();
        const speech2 = createSpeechInstance();

        // Interleave operations between instances with fewer frames
        console.log('Interleaving operations...');
        for (let round = 0; round < 50; round++) {
            // Speech1 processes noise
            speech1.feedPCMData(createNoisePCMBuffer());

            // Speech2 processes silence
            speech2.feedPCMData(createSilencePCMBuffer());

            if (round % 10 === 0) await sleep(5);
        }

        expect(speech1.getState).toBe(StreamingState.ACTIVE);
        expect(speech2.getState).toBe(StreamingState.ACTIVE); // Not paused yet

        // Feed more silence to speech2 to trigger pause
        console.log('Feeding more silence to Instance 2...');
        for (let i = 50; i < 220; i++) {
            speech2.feedPCMData(createSilencePCMBuffer());
            if ((i - 50) % 20 === 0) await sleep(5);
        }

        // Verify states remain independent
        expect(speech1.getState).toBe(StreamingState.ACTIVE);
        expect(speech2.getState).toBe(StreamingState.PAUSED);

        speech1.destroy();
        speech2.destroy();
    });
});

/**
 * Creates a PCM buffer filled with noise (simulating speech)
 * Buffer contains 480 samples (10ms at 16kHz) of pseudo-random noise
 */
function createNoisePCMBuffer(): Buffer {
    const buffer = Buffer.alloc(480 * 2); // 480 samples * 2 bytes (16-bit)

    for (let i = 0; i < 480; i++) {
        // Generate pseudo-random noise with moderate amplitude
        const sample = Math.sin(i * 0.1) * 16000 + Math.random() * 8000;
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }

    return buffer;
}

/**
 * Creates a PCM buffer filled with silence (near-zero samples)
 * Buffer contains 480 samples (10ms at 16kHz) of near-silence
 */
function createSilencePCMBuffer(): Buffer {
    const buffer = Buffer.alloc(480 * 2); // 480 samples * 2 bytes (16-bit)

    for (let i = 0; i < 480; i++) {
        // Very low amplitude noise (near silence)
        const sample = Math.random() * 100 - 50; // Very quiet
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }

    return buffer;
}
