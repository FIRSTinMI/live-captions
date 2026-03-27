import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import { RtAudio } from 'audify';
import { ConfigManager } from '../util/configManager';
import { Speech } from '../speech';
import { GoogleV1 } from '../engines/GoogleV1';
import { GoogleV2 } from '../engines/GoogleV2';
import { April } from '../engines/April';
import { captionBus, micBus, displayCtrlBus, MicStatusPayload, DisplayControlEvent } from '../util/eventBus';
import { Frame } from '../types/Frame';
import { Context, createContext } from './context';
import { CloudSync } from '../util/cloudSync';

export interface RouterDeps {
    config: ConfigManager;
    cloudSync: CloudSync;
    getSpeechServices: () => Speech<GoogleV1 | GoogleV2 | April>[];
    getRtAudio: () => RtAudio;
    restart: () => void;
    onDisplayConnect: () => void;
    onDisplayDisconnect: () => void;
    onSettingsConnect: () => void;
    onSettingsDisconnect: () => void;
}

export function createAppRouter(deps: RouterDeps) {
    const t = initTRPC.context<Context>().create();
    const router = t.router;
    const publicProcedure = t.procedure;

    return router({
        config: router({
            get: publicProcedure.query(() => {
                return deps.config.get();
            }),
            set: publicProcedure
                .input(z.object({ key: z.string(), value: z.string() }))
                .mutation(({ input }) => {
                    deps.config.set(input.key, input.value);
                    deps.config.save();
                    displayCtrlBus.emit('event', { type: 'config' });
                    deps.cloudSync.pushConfig();
                }),
            setJson: publicProcedure
                .input(z.object({ key: z.string(), value: z.any() }))
                .mutation(({ input }) => {
                    if (input.key === 'server.google') {
                        deps.config.server.google = input.value;
                    }
                    deps.config.save();
                    displayCtrlBus.emit('event', { type: 'config' });
                    deps.cloudSync.pushConfig();
                }),
            setArray: publicProcedure
                .input(z.object({ key: z.enum(['transcription.filter', 'transcription.phraseSets']), value: z.array(z.string()) }))
                .mutation(({ input }) => {
                    if (input.key === 'transcription.filter') {
                        deps.config.transcription.filter = input.value;
                    } else {
                        deps.config.transcription.phraseSets = input.value;
                    }
                    deps.config.save();
                    deps.cloudSync.pushConfig();
                }),
            setInputs: publicProcedure
                .input(z.array(z.any()))
                .mutation(({ input }) => {
                    deps.config.transcription.inputs = input as any;
                    deps.config.save();
                    deps.cloudSync.pushConfig();
                }),
        }),

        display: router({
            hide: publicProcedure
                .input(z.object({ value: z.boolean() }))
                .mutation(({ input }) => {
                    deps.config.display.hidden = input.value;
                    deps.config.save();
                    displayCtrlBus.emit('event', { type: 'hide', value: input.value });
                    deps.cloudSync.pushConfig();
                }),
            clear: publicProcedure
                .mutation(() => {
                    displayCtrlBus.emit('event', { type: 'clear' });
                }),
        }),

        server: router({
            restart: publicProcedure.mutation(() => {
                console.log('[RESTART] triggered via TRPC server.restart mutation');
                deps.restart();
            }),
        }),

        devices: router({
            list: publicProcedure.query(() => {
                return deps.getRtAudio().getDevices();
            }),
        }),

        cloud: router({
            connect: publicProcedure
                .input(z.object({ pin: z.string() }))
                .mutation(async ({ input }) => {
                    return deps.cloudSync.connect(input.pin);
                }),
            disconnect: publicProcedure
                .mutation(() => {
                    deps.cloudSync.disconnect();
                }),
            status: publicProcedure.query(() => {
                return {
                    connected: !!deps.config.server.cloud.deviceToken,
                    deviceName: deps.config.server.cloud.deviceName,
                };
            }),
        }),

        volumes: publicProcedure.subscription(() => {
            return observable<{ devices: { id: number; volume: number; threshold: number; state: number; }[] }>((emit) => {
                deps.onSettingsConnect();

                const interval = setInterval(() => {
                    const services = deps.getSpeechServices();
                    emit.next({
                        devices: services.map(s => ({
                            id: s.inputConfig.id,
                            volume: Math.round(s.volume),
                            threshold: Math.round(s.effectiveThreshold),
                            state: s.getState,
                        })),
                    });
                }, 50);

                return () => {
                    clearInterval(interval);
                    deps.onSettingsDisconnect();
                };
            });
        }),

        captions: publicProcedure.subscription(() => {
            return observable<Frame>((emit) => {
                deps.onDisplayConnect();

                const handler = (frame: Frame) => emit.next(frame);
                captionBus.on('frame', handler);

                return () => {
                    captionBus.off('frame', handler);
                    deps.onDisplayDisconnect();
                };
            });
        }),

        micStatus: publicProcedure.subscription(() => {
            return observable<MicStatusPayload>((emit) => {
                const handler = (payload: MicStatusPayload) => emit.next(payload);
                micBus.on('status', handler);
                return () => {
                    micBus.off('status', handler);
                };
            });
        }),

        displayControl: publicProcedure.subscription(() => {
            return observable<DisplayControlEvent>((emit) => {
                const handler = (event: DisplayControlEvent) => emit.next(event);
                displayCtrlBus.on('event', handler);
                return () => {
                    displayCtrlBus.off('event', handler);
                };
            });
        }),
    });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
