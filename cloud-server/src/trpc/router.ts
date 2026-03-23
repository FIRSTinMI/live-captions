import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and, isNotNull, desc, gte, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db, schema } from '../db';
import {
    signAdminToken,
    generateDeviceToken,
    hashDeviceToken,
    encryptApiKey,
    decryptApiKey,
    getEncryptionKey,
} from '../auth';
import { Context } from './context';
import { relay } from '../relay';
import {
    listPhraseSets,
    getPhraseSet,
    createPhraseSet,
    updatePhraseSet,
    deletePhraseSet,
} from '../util/phraseSetService';
import { discoverForProfile } from '../util/phraseSetDiscovery';

const t = initTRPC.context<Context>().create();

const isAdmin = t.middleware(({ ctx, next }) => {
    if (!ctx.adminId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return next({ ctx: { ...ctx, adminId: ctx.adminId } });
});

const isDevice = t.middleware(({ ctx, next }) => {
    if (!ctx.deviceId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return next({ ctx: { ...ctx, deviceId: ctx.deviceId } });
});

const publicProcedure = t.procedure;
const adminProcedure = t.procedure.use(isAdmin);
const deviceProcedure = t.procedure.use(isDevice);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function deepMergeSettings(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] !== null && typeof target[key] === 'object') {
            result[key] = deepMergeSettings(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}



export function createRouter() {
    return t.router({
        // --- Device routes ---
        device: t.router({
            auth: publicProcedure
                .input(z.object({ pin: z.string() }))
                .mutation(async ({ input }) => {
                    const allDevices = await db.query.devices.findMany();
                    const matched = allDevices.find(d => d.pin === input.pin) ?? null;
                    if (!matched) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid PIN' });

                    const token = generateDeviceToken();
                    const tokenHash = hashDeviceToken(token);
                    await db.update(schema.devices)
                        .set({ tokenHash, lastSeenAt: new Date() })
                        .where(eq(schema.devices.id, matched.id));

                    return { token, deviceName: matched.name };
                }),

            config: deviceProcedure.query(async ({ ctx }) => {
                const device = await db.query.devices.findFirst({
                    where: eq(schema.devices.id, ctx.deviceId),
                    with: { apiKey: true },
                });
                if (!device) throw new TRPCError({ code: 'NOT_FOUND' });

                let apiKey: string | null = null;
                let apiKeyType = 'google-v2';
                if (device.apiKey) {
                    try {
                        apiKey = decryptApiKey(device.apiKey.key, getEncryptionKey());
                        apiKeyType = device.apiKey.keyType;
                    } catch { /* bad key */ }
                }

                return {
                    apiKey,
                    apiKeyType,
                    pendingSettings: device.pushedSettings ? [device.pushedSettings] : [],
                };
            }),

            heartbeat: deviceProcedure
                .input(z.object({
                    minutesUsed: z.number().min(0),
                    errors: z.array(z.object({
                        message: z.string(),
                        context: z.record(z.any()).optional(),
                        occurredAt: z.string().optional(),
                    })).default([]),
                }))
                .mutation(async ({ ctx, input }) => {
                    const now = new Date();
                    await db.update(schema.devices)
                        .set({ lastSeenAt: now, lastHeartbeatAt: now })
                        .where(eq(schema.devices.id, ctx.deviceId));

                    if (input.minutesUsed > 0) {
                        await db.insert(schema.usageLogs).values({
                            deviceId: ctx.deviceId,
                            minutesUsed: input.minutesUsed.toFixed(3),
                            recordedAt: now,
                        });
                    }

                    if (input.errors.length > 0) {
                        await db.insert(schema.errorLogs).values(
                            input.errors.map(e => ({
                                deviceId: ctx.deviceId,
                                message: e.message,
                                context: e.context ?? {},
                                occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
                            }))
                        );
                    }

                    const device = await db.query.devices.findFirst({
                        where: eq(schema.devices.id, ctx.deviceId),
                    });

                    return {
                        pendingSettings: device?.pushedSettings ? [device.pushedSettings] : [],
                    };
                }),
        }),

        // --- Admin routes ---
        admin: t.router({
            login: publicProcedure
                .input(z.object({ username: z.string(), password: z.string() }))
                .mutation(async ({ input }) => {
                    const user = await db.query.users.findFirst({
                        where: eq(schema.users.username, input.username),
                    });
                    if (!user || !(await bcrypt.compare(input.password, user.password))) {
                        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
                    }
                    return { token: signAdminToken(user.id) };
                }),

            me: adminProcedure.query(async ({ ctx }) => {
                const user = await db.query.users.findFirst({
                    where: eq(schema.users.id, ctx.adminId),
                });
                if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
                return { id: user.id, username: user.username };
            }),

            apiKeys: t.router({
                list: adminProcedure.query(async () => {
                    const keys = await db.query.apiKeys.findMany({
                        orderBy: [desc(schema.apiKeys.createdAt)],
                    });

                    const deviceCounts = await db
                        .select({
                            apiKeyId: schema.devices.apiKeyId,
                            count: sql<number>`count(*)`,
                        })
                        .from(schema.devices)
                        .where(isNotNull(schema.devices.apiKeyId))
                        .groupBy(schema.devices.apiKeyId);

                    const countMap = new Map(deviceCounts.map(d => [d.apiKeyId!, Number(d.count)]));

                    return keys.map(k => ({
                        id: k.id,
                        title: k.title,
                        keyType: k.keyType,
                        deviceCount: countMap.get(k.id) ?? 0,
                        createdAt: k.createdAt,
                        updatedAt: k.updatedAt,
                    }));
                }),

                create: adminProcedure
                    .input(z.object({
                        title: z.string().min(1),
                        key: z.string().min(1),
                        keyType: z.enum(['google-v1', 'google-v2']),
                    }))
                    .mutation(async ({ input }) => {
                        const encrypted = encryptApiKey(JSON.stringify(JSON.parse(input.key)), getEncryptionKey());
                        const [apiKey] = await db.insert(schema.apiKeys).values({
                            title: input.title,
                            key: encrypted,
                            keyType: input.keyType,
                        }).returning({ id: schema.apiKeys.id, title: schema.apiKeys.title });
                        return apiKey;
                    }),

                update: adminProcedure
                    .input(z.object({
                        id: z.number(),
                        title: z.string().min(1).optional(),
                        key: z.string().min(1).optional(),
                        keyType: z.enum(['google-v1', 'google-v2']).optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.apiKeys.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.title) updates.title = input.title;
                        if (input.keyType) updates.keyType = input.keyType;
                        if (input.key) updates.key = encryptApiKey(JSON.stringify(JSON.parse(input.key)), getEncryptionKey());
                        await db.update(schema.apiKeys).set(updates).where(eq(schema.apiKeys.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, input.id));
                    }),
            }),

            devices: t.router({
                list: adminProcedure.query(async () => {
                    const devs = await db.query.devices.findMany({
                        orderBy: [desc(schema.devices.createdAt)],
                        with: { apiKey: true },
                    });

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const usageToday = await db
                        .select({
                            deviceId: schema.usageLogs.deviceId,
                            total: sql<number>`sum(${schema.usageLogs.minutesUsed})`,
                        })
                        .from(schema.usageLogs)
                        .where(gte(schema.usageLogs.recordedAt, today))
                        .groupBy(schema.usageLogs.deviceId);

                    const usageMap = new Map(usageToday.map(u => [u.deviceId, Number(u.total)]));

                    return devs.map(d => ({
                        id: d.id,
                        name: d.name,
                        tag: d.tag,
                        apiKeyId: d.apiKeyId,
                        apiKeyTitle: d.apiKey?.title ?? null,
                        apiKeyType: d.apiKey?.keyType ?? null,
                        hasApiKey: !!d.apiKeyId,
                        online: relay.isOnline(d.id),
                        lastSeenAt: d.lastSeenAt,
                        lastHeartbeatAt: d.lastHeartbeatAt,
                        todayMinutes: usageMap.get(d.id) ?? 0,
                        createdAt: d.createdAt,
                    }));
                }),

                get: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .query(async ({ input }) => {
                        const device = await db.query.devices.findFirst({
                            where: eq(schema.devices.id, input.id),
                            with: { apiKey: true },
                        });
                        if (!device) throw new TRPCError({ code: 'NOT_FOUND' });
                        return {
                            id: device.id,
                            name: device.name,
                            tag: device.tag,
                            pin: device.pin,
                            apiKeyId: device.apiKeyId,
                            apiKeyTitle: device.apiKey?.title ?? null,
                            apiKeyType: device.apiKey?.keyType ?? null,
                            hasApiKey: !!device.apiKeyId,
                            groupId: device.groupId,
                            settings: device.settings,
                            pushedSettings: device.pushedSettings,
                            lastSeenAt: device.lastSeenAt,
                            lastHeartbeatAt: device.lastHeartbeatAt,
                            createdAt: device.createdAt,
                        };
                    }),

                create: adminProcedure
                    .input(z.object({
                        name: z.string().min(1),
                        tag: z.string().default(''),
                        apiKeyId: z.number().nullable().optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const pin = generatePin();
                        const [device] = await db.insert(schema.devices).values({
                            name: input.name,
                            tag: input.tag,
                            pin,
                            apiKeyId: input.apiKeyId ?? null,
                        }).returning({ id: schema.devices.id, name: schema.devices.name, pin: schema.devices.pin });
                        return device;
                    }),

                update: adminProcedure
                    .input(z.object({
                        id: z.number(),
                        name: z.string().min(1).optional(),
                        tag: z.string().optional(),
                        apiKeyId: z.number().nullable().optional(),
                        groupId: z.number().nullable().optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.devices.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.name) updates.name = input.name;
                        if (input.tag !== undefined) updates.tag = input.tag;
                        if ('apiKeyId' in input) updates.apiKeyId = input.apiKeyId ?? null;
                        if ('groupId' in input) updates.groupId = input.groupId ?? null;
                        await db.update(schema.devices).set(updates).where(eq(schema.devices.id, input.id));
                    }),

                regeneratePin: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        const pin = generatePin();
                        await db.update(schema.devices)
                            .set({ pin, updatedAt: new Date() })
                            .where(eq(schema.devices.id, input.id));
                        return { pin };
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        await db.delete(schema.devices).where(eq(schema.devices.id, input.id));
                    }),

                saveSettings: adminProcedure
                    .input(z.object({
                        deviceId: z.number(),
                        settings: z.record(z.any()),
                    }))
                    .mutation(async ({ input }) => {
                        const existing = await db.query.devices.findFirst({
                            where: eq(schema.devices.id, input.deviceId),
                            columns: { pushedSettings: true },
                        });
                        const merged = deepMergeSettings(
                            (existing?.pushedSettings as Record<string, unknown>) ?? {},
                            input.settings
                        );
                        await db.update(schema.devices)
                            .set({ pushedSettings: merged, updatedAt: new Date() })
                            .where(eq(schema.devices.id, input.deviceId));
                        if (relay.isOnline(input.deviceId)) {
                            relay.sendToDevice(input.deviceId, { type: 'pushSettings', settings: merged });
                        }
                    }),

                errors: adminProcedure
                    .input(z.object({ deviceId: z.number(), limit: z.number().default(100) }))
                    .query(async ({ input }) => {
                        return db.query.errorLogs.findMany({
                            where: eq(schema.errorLogs.deviceId, input.deviceId),
                            orderBy: [desc(schema.errorLogs.occurredAt)],
                            limit: input.limit,
                        });
                    }),

                clearErrors: adminProcedure
                    .input(z.object({ deviceId: z.number() }))
                    .mutation(async ({ input }) => {
                        await db.delete(schema.errorLogs).where(eq(schema.errorLogs.deviceId, input.deviceId));
                    }),

                usage: adminProcedure
                    .input(z.object({
                        deviceId: z.number(),
                        days: z.number().default(30),
                    }))
                    .query(async ({ input }) => {
                        const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
                        const rows = await db
                            .select({
                                day: sql<string>`date_trunc('day', ${schema.usageLogs.recordedAt})::date::text`,
                                minutes: sql<number>`sum(${schema.usageLogs.minutesUsed})`,
                            })
                            .from(schema.usageLogs)
                            .where(
                                and(
                                    eq(schema.usageLogs.deviceId, input.deviceId),
                                    gte(schema.usageLogs.recordedAt, since)
                                )
                            )
                            .groupBy(sql`date_trunc('day', ${schema.usageLogs.recordedAt})`)
                            .orderBy(sql`date_trunc('day', ${schema.usageLogs.recordedAt})`);

                        const total = rows.reduce((sum, r) => sum + Number(r.minutes), 0);
                        return { rows: rows.map(r => ({ day: r.day, minutes: Number(r.minutes) })), total };
                    }),

                usageSummary: adminProcedure.query(async () => {
                    const now = new Date();
                    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                    const rows = await db
                        .select({
                            deviceId: schema.usageLogs.deviceId,
                            total: sql<number>`sum(${schema.usageLogs.minutesUsed})`,
                        })
                        .from(schema.usageLogs)
                        .where(gte(schema.usageLogs.recordedAt, firstOfMonth))
                        .groupBy(schema.usageLogs.deviceId);
                    return rows.map(r => ({ deviceId: r.deviceId, minutesThisMonth: Number(r.total) }));
                }),
            }),

            deviceGroups: t.router({
                list: adminProcedure.query(async () => {
                    const groups = await db.query.deviceGroups.findMany({
                        orderBy: [schema.deviceGroups.name],
                        with: { devices: { columns: { id: true } } },
                    });
                    return groups.map(g => ({
                        id: g.id,
                        name: g.name,
                        deviceCount: g.devices.length,
                        createdAt: g.createdAt,
                    }));
                }),

                get: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .query(async ({ input }) => {
                        const group = await db.query.deviceGroups.findFirst({
                            where: eq(schema.deviceGroups.id, input.id),
                            with: {
                                devices: {
                                    with: { apiKey: true },
                                },
                            },
                        });
                        if (!group) throw new TRPCError({ code: 'NOT_FOUND' });
                        return {
                            id: group.id,
                            name: group.name,
                            createdAt: group.createdAt,
                            devices: group.devices.map(d => ({
                                id: d.id,
                                name: d.name,
                                tag: d.tag,
                                online: relay.isOnline(d.id),
                                settings: d.settings,
                                pushedSettings: d.pushedSettings,
                            })),
                        };
                    }),

                create: adminProcedure
                    .input(z.object({ name: z.string().min(1) }))
                    .mutation(async ({ input }) => {
                        const [group] = await db.insert(schema.deviceGroups)
                            .values({ name: input.name })
                            .returning({ id: schema.deviceGroups.id, name: schema.deviceGroups.name });
                        return group;
                    }),

                update: adminProcedure
                    .input(z.object({ id: z.number(), name: z.string().min(1) }))
                    .mutation(async ({ input }) => {
                        await db.update(schema.deviceGroups)
                            .set({ name: input.name, updatedAt: new Date() })
                            .where(eq(schema.deviceGroups.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        // Unassign all devices in this group first
                        await db.update(schema.devices)
                            .set({ groupId: null, updatedAt: new Date() })
                            .where(eq(schema.devices.groupId, input.id));
                        await db.delete(schema.deviceGroups).where(eq(schema.deviceGroups.id, input.id));
                    }),

                saveSettings: adminProcedure
                    .input(z.object({
                        groupId: z.number(),
                        settings: z.record(z.any()),
                    }))
                    .mutation(async ({ input }) => {
                        const devices = await db.query.devices.findMany({
                            where: eq(schema.devices.groupId, input.groupId),
                            columns: { id: true, pushedSettings: true },
                        });
                        for (const device of devices) {
                            const merged = deepMergeSettings(
                                (device.pushedSettings as Record<string, unknown>) ?? {},
                                input.settings
                            );
                            await db.update(schema.devices)
                                .set({ pushedSettings: merged, updatedAt: new Date() })
                                .where(eq(schema.devices.id, device.id));
                            if (relay.isOnline(device.id)) {
                                relay.sendToDevice(device.id, { type: 'pushSettings', settings: merged });
                            }
                        }
                    }),

                pushPhraseSets: adminProcedure
                    .input(z.object({
                        groupId: z.number(),
                        deploymentIds: z.array(z.number()),
                    }))
                    .mutation(async ({ input }) => {
                        const groupDevices = await db.query.devices.findMany({
                            where: eq(schema.devices.groupId, input.groupId),
                            columns: { id: true, pushedSettings: true },
                        });

                        if (input.deploymentIds.length === 0) {
                            for (const device of groupDevices) {
                                const merged = {
                                    ...((device.pushedSettings as Record<string, unknown>) ?? {}),
                                    transcription: {
                                        ...(((device.pushedSettings as Record<string, unknown>)?.transcription as Record<string, unknown>) ?? {}),
                                        phraseSets: [],
                                        phraseSetDeploymentIds: [],
                                    },
                                };
                                await db.update(schema.devices)
                                    .set({ pushedSettings: merged, updatedAt: new Date() })
                                    .where(eq(schema.devices.id, device.id));
                                relay.sendToDevice(device.id, { type: 'setArray', key: 'transcription.phraseSets', value: [] });
                            }
                            return { pushed: 0 };
                        }

                        const deployments = await db.query.phraseSetDeployments.findMany({
                            where: (d, { inArray }) => inArray(d.id, input.deploymentIds),
                        });

                        const missing = deployments.filter(d => d.state === 'missing');
                        if (missing.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: `${missing.length} deployment(s) are missing from GCP` });
                        const pending = deployments.filter(d => d.state === 'pending');
                        if (pending.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: `${pending.length} deployment(s) have unsynchronised changes` });

                        const resourceNames = deployments.map(d => d.resourceName);

                        for (const device of groupDevices) {
                            relay.sendToDevice(device.id, { type: 'setArray', key: 'transcription.phraseSets', value: resourceNames });
                            const merged = {
                                ...((device.pushedSettings as Record<string, unknown>) ?? {}),
                                transcription: {
                                    ...(((device.pushedSettings as Record<string, unknown>)?.transcription as Record<string, unknown>) ?? {}),
                                    phraseSets: resourceNames,
                                    phraseSetDeploymentIds: input.deploymentIds,
                                },
                            };
                            await db.update(schema.devices)
                                .set({ pushedSettings: merged, updatedAt: new Date() })
                                .where(eq(schema.devices.id, device.id));
                        }
                        return { pushed: resourceNames.length };
                    }),
            }),

            users: t.router({
                list: adminProcedure.query(async () => {
                    const rows = await db.query.users.findMany({ orderBy: [schema.users.username] });
                    return rows.map(u => ({ id: u.id, username: u.username, createdAt: u.createdAt }));
                }),

                create: adminProcedure
                    .input(z.object({ username: z.string().min(1), password: z.string().min(8) }))
                    .mutation(async ({ input }) => {
                        const existing = await db.query.users.findFirst({
                            where: eq(schema.users.username, input.username),
                        });
                        if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Username already taken' });
                        const hash = await bcrypt.hash(input.password, 10);
                        const [user] = await db.insert(schema.users).values({
                            username: input.username,
                            password: hash,
                        }).returning({ id: schema.users.id, username: schema.users.username });
                        return user;
                    }),

                updatePassword: adminProcedure
                    .input(z.object({ id: z.number(), password: z.string().min(8) }))
                    .mutation(async ({ input }) => {
                        const hash = await bcrypt.hash(input.password, 10);
                        await db.update(schema.users)
                            .set({ password: hash, updatedAt: new Date() })
                            .where(eq(schema.users.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ ctx, input }) => {
                        if (ctx.adminId === input.id) {
                            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete yourself' });
                        }
                        await db.delete(schema.users).where(eq(schema.users.id, input.id));
                    }),
            }),

            // ── Admin credential profiles (for GCP PhraseSet CRUD) ────────────

            adminCredentials: t.router({
                list: adminProcedure.query(async () => {
                    const rows = await db.query.googleCredentialProfiles.findMany({
                        orderBy: [desc(schema.googleCredentialProfiles.createdAt)],
                    });
                    // Never return the encrypted credentials field
                    return rows.map(r => ({
                        id: r.id,
                        label: r.label,
                        role: r.role,
                        projectId: r.projectId,
                        scopes: r.scopes,
                        createdAt: r.createdAt,
                        updatedAt: r.updatedAt,
                    }));
                }),

                create: adminProcedure
                    .input(z.object({
                        label: z.string().min(1),
                        role: z.enum(['client', 'admin']),
                        projectId: z.string().min(1),
                        scopes: z.string().default('https://www.googleapis.com/auth/cloud-platform'),
                        credentials: z.string().min(1), // raw service account JSON
                    }))
                    .mutation(async ({ input }) => {
                        // Validate that the credentials string is valid JSON
                        try { JSON.parse(input.credentials); } catch {
                            throw new TRPCError({ code: 'BAD_REQUEST', message: 'credentials must be valid JSON' });
                        }
                        const encrypted = encryptApiKey(input.credentials, getEncryptionKey());
                        const [row] = await db.insert(schema.googleCredentialProfiles).values({
                            label: input.label,
                            role: input.role,
                            projectId: input.projectId,
                            scopes: input.scopes,
                            credentials: encrypted,
                        }).returning({ id: schema.googleCredentialProfiles.id });

                        // Kick off discovery for this profile after creation (non-blocking)
                        if (input.role === 'admin') {
                            discoverForProfile(row.id).catch(err =>
                                console.error(`[phrase-sets] Post-create discovery error for profile ${row.id}:`, err)
                            );
                        }

                        return { id: row.id };
                    }),

                update: adminProcedure
                    .input(z.object({
                        id: z.number(),
                        label: z.string().min(1).optional(),
                        credentials: z.string().min(1).optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.googleCredentialProfiles.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.label) updates.label = input.label;
                        if (input.credentials) {
                            try { JSON.parse(input.credentials); } catch {
                                throw new TRPCError({ code: 'BAD_REQUEST', message: 'credentials must be valid JSON' });
                            }
                            updates.credentials = encryptApiKey(input.credentials, getEncryptionKey());
                        }
                        await db.update(schema.googleCredentialProfiles)
                            .set(updates)
                            .where(eq(schema.googleCredentialProfiles.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        const deployments = await db.query.phraseSetDeployments.findMany({
                            where: eq(schema.phraseSetDeployments.adminCredentialProfileId, input.id),
                        });
                        if (deployments.length > 0) {
                            throw new TRPCError({
                                code: 'PRECONDITION_FAILED',
                                message: `Cannot delete: ${deployments.length} deployment(s) reference this credential. Remove deployments first.`,
                            });
                        }
                        await db.delete(schema.googleCredentialProfiles)
                            .where(eq(schema.googleCredentialProfiles.id, input.id));
                    }),

                rediscover: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        const result = await discoverForProfile(input.id);
                        return result;
                    }),
            }),

            // ── Phrase set definitions ─────────────────────────────────────────

            phraseSetDefinitions: t.router({
                list: adminProcedure.query(async () => {
                    const defs = await db.query.phraseSetDefinitions.findMany({
                        orderBy: [desc(schema.phraseSetDefinitions.createdAt)],
                        with: { deployments: true },
                    });

                    return defs.map(d => {
                        const states = d.deployments.map(dep => dep.state);
                        const worstState = states.includes('missing') ? 'missing'
                            : states.includes('drifted') ? 'drifted'
                            : states.includes('pending') ? 'pending'
                            : states.includes('unknown') ? 'unknown'
                            : states.length > 0 ? 'synced'
                            : null;
                        return {
                            id: d.id,
                            name: d.name,
                            phrases: d.phrases,
                            deploymentCount: d.deployments.length,
                            worstState,
                            createdAt: d.createdAt,
                            updatedAt: d.updatedAt,
                        };
                    });
                }),

                create: adminProcedure
                    .input(z.object({
                        name: z.string().min(1),
                        phrases: z.array(z.object({
                            value: z.string().min(1),
                            boost: z.number().optional(),
                        })).default([]),
                    }))
                    .mutation(async ({ input }) => {
                        const [row] = await db.insert(schema.phraseSetDefinitions).values({
                            name: input.name,
                            phrases: input.phrases,
                        }).returning({ id: schema.phraseSetDefinitions.id });
                        return { id: row.id };
                    }),

                update: adminProcedure
                    .input(z.object({
                        id: z.number(),
                        name: z.string().min(1).optional(),
                        phrases: z.array(z.object({
                            value: z.string().min(1),
                            boost: z.number().optional(),
                        })).optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.phraseSetDefinitions.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.name) updates.name = input.name;
                        if (input.phrases !== undefined) {
                            updates.phrases = input.phrases;
                            // Mark all deployments for this definition as pending
                            await db.update(schema.phraseSetDeployments)
                                .set({ state: 'pending', updatedAt: new Date() })
                                .where(eq(schema.phraseSetDeployments.definitionId, input.id));
                        }
                        await db.update(schema.phraseSetDefinitions)
                            .set(updates)
                            .where(eq(schema.phraseSetDefinitions.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        const deployments = await db.query.phraseSetDeployments.findMany({
                            where: eq(schema.phraseSetDeployments.definitionId, input.id),
                        });
                        if (deployments.length > 0) {
                            throw new TRPCError({
                                code: 'PRECONDITION_FAILED',
                                message: `Cannot delete: ${deployments.length} deployment(s) exist. Remove deployments first.`,
                            });
                        }
                        await db.delete(schema.phraseSetDefinitions)
                            .where(eq(schema.phraseSetDefinitions.id, input.id));
                    }),
            }),

            // ── Phrase set deployments ─────────────────────────────────────────

            phraseSetDeployments: t.router({
                list: adminProcedure
                    .input(z.object({ definitionId: z.number().optional() }))
                    .query(async ({ input }) => {
                        const rows = await db.query.phraseSetDeployments.findMany({
                            ...(input.definitionId
                                ? { where: eq(schema.phraseSetDeployments.definitionId, input.definitionId) }
                                : {}),
                            orderBy: [desc(schema.phraseSetDeployments.createdAt)],
                            with: { definition: true, adminCredentialProfile: true },
                        });
                        return rows.map(r => ({
                            id: r.id,
                            definitionId: r.definitionId,
                            definitionName: r.definition?.name ?? '',
                            adminCredentialProfileId: r.adminCredentialProfileId,
                            adminCredentialLabel: r.adminCredentialProfile?.label ?? '',
                            projectId: r.projectId,
                            location: r.location,
                            resourceName: r.resourceName,
                            state: r.state,
                            lastVerifiedAt: r.lastVerifiedAt,
                            importedFrom: r.importedFrom,
                            createdAt: r.createdAt,
                        }));
                    }),

                deploy: adminProcedure
                    .input(z.object({
                        definitionId: z.number(),
                        adminCredentialProfileId: z.number(),
                        projectId: z.string().min(1),
                        location: z.string().default('global'),
                        resourceId: z.string().min(1),
                    }))
                    .mutation(async ({ input }) => {
                        const def = await db.query.phraseSetDefinitions.findFirst({
                            where: eq(schema.phraseSetDefinitions.id, input.definitionId),
                        });
                        if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Definition not found' });

                        const profile = await db.query.googleCredentialProfiles.findFirst({
                            where: eq(schema.googleCredentialProfiles.id, input.adminCredentialProfileId),
                        });
                        if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential profile not found' });

                        const credJson = decryptApiKey(profile.credentials, getEncryptionKey());

                        // Check if a deployment already exists for this resource
                        const existing = await db.query.phraseSetDeployments.findFirst({
                            where: and(
                                eq(schema.phraseSetDeployments.definitionId, input.definitionId),
                                eq(schema.phraseSetDeployments.projectId, input.projectId),
                                eq(schema.phraseSetDeployments.location, input.location),
                            ),
                        });

                        let resourceName: string;
                        const expectedResourceName = `projects/${input.projectId}/locations/${input.location}/phraseSets/${input.resourceId}`;

                        try {
                            if (existing) {
                                await updatePhraseSet(profile.projectId, profile.scopes, credJson, existing.resourceName, def.phrases as { value: string; boost?: number }[]);
                                resourceName = existing.resourceName;
                            } else {
                                resourceName = await createPhraseSet(
                                    input.projectId,
                                    profile.scopes,
                                    credJson,
                                    input.location,
                                    input.resourceId,
                                    def.phrases as { value: string; boost?: number }[],
                                );
                            }
                        } catch (err: any) {
                            throw new TRPCError({
                                code: 'INTERNAL_SERVER_ERROR',
                                message: `GCP error: ${err?.message ?? String(err)}`,
                            });
                        }

                        if (existing) {
                            await db.update(schema.phraseSetDeployments)
                                .set({ state: 'synced', lastVerifiedAt: new Date(), updatedAt: new Date() })
                                .where(eq(schema.phraseSetDeployments.id, existing.id));
                            return { id: existing.id, resourceName };
                        } else {
                            const [row] = await db.insert(schema.phraseSetDeployments).values({
                                definitionId: input.definitionId,
                                adminCredentialProfileId: input.adminCredentialProfileId,
                                projectId: input.projectId,
                                location: input.location,
                                resourceName,
                                state: 'synced',
                                lastVerifiedAt: new Date(),
                            }).returning({ id: schema.phraseSetDeployments.id });
                            return { id: row.id, resourceName };
                        }
                    }),

                verify: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        const deployment = await db.query.phraseSetDeployments.findFirst({
                            where: eq(schema.phraseSetDeployments.id, input.id),
                            with: { definition: true, adminCredentialProfile: true },
                        });
                        if (!deployment) throw new TRPCError({ code: 'NOT_FOUND' });

                        const credJson = decryptApiKey(deployment.adminCredentialProfile.credentials, getEncryptionKey());

                        let newState: typeof deployment.state;
                        try {
                            const remote = await getPhraseSet(
                                deployment.adminCredentialProfile.projectId,
                                deployment.adminCredentialProfile.scopes,
                                credJson,
                                deployment.resourceName,
                            );

                            // Compare phrase content
                            const localPhrases = (deployment.definition?.phrases ?? []) as { value: string; boost?: number }[];
                            const remoteValues = new Set(remote.phrases.map(p => p.value));
                            const localValues = new Set(localPhrases.map(p => p.value));
                            const isDrifted = remoteValues.size !== localValues.size
                                || [...localValues].some(v => !remoteValues.has(v));

                            newState = isDrifted ? 'drifted' : 'synced';
                        } catch (err: any) {
                            const msg = String(err?.message ?? err);
                            newState = msg.includes('404') || msg.toLowerCase().includes('not found') ? 'missing' : 'unknown';
                        }

                        await db.update(schema.phraseSetDeployments)
                            .set({ state: newState, lastVerifiedAt: new Date(), updatedAt: new Date() })
                            .where(eq(schema.phraseSetDeployments.id, input.id));

                        return { state: newState };
                    }),

                undeploy: adminProcedure
                    .input(z.object({ id: z.number(), deleteFromGcp: z.boolean().default(false) }))
                    .mutation(async ({ input }) => {
                        const deployment = await db.query.phraseSetDeployments.findFirst({
                            where: eq(schema.phraseSetDeployments.id, input.id),
                            with: { adminCredentialProfile: true },
                        });
                        if (!deployment) throw new TRPCError({ code: 'NOT_FOUND' });

                        if (input.deleteFromGcp) {
                            try {
                                const credJson = decryptApiKey(deployment.adminCredentialProfile.credentials, getEncryptionKey());
                                await deletePhraseSet(
                                    deployment.adminCredentialProfile.projectId,
                                    deployment.adminCredentialProfile.scopes,
                                    credJson,
                                    deployment.resourceName,
                                );
                            } catch (err: any) {
                                // If already missing on GCP, still proceed with local removal
                                const msg = String(err?.message ?? err);
                                if (!msg.includes('404') && !msg.toLowerCase().includes('not found')) {
                                    throw new TRPCError({
                                        code: 'INTERNAL_SERVER_ERROR',
                                        message: `GCP delete failed: ${msg}`,
                                    });
                                }
                            }
                        }

                        await db.delete(schema.phraseSetDeployments)
                            .where(eq(schema.phraseSetDeployments.id, input.id));
                    }),

                syncAll: adminProcedure
                    .input(z.object({ definitionId: z.number() }))
                    .mutation(async ({ input }) => {
                        const def = await db.query.phraseSetDefinitions.findFirst({
                            where: eq(schema.phraseSetDefinitions.id, input.definitionId),
                        });
                        if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Definition not found' });

                        const deployments = await db.query.phraseSetDeployments.findMany({
                            where: eq(schema.phraseSetDeployments.definitionId, input.definitionId),
                            with: { adminCredentialProfile: true },
                        });

                        const errors: { id: number; error: string }[] = [];
                        for (const dep of deployments) {
                            try {
                                const credJson = decryptApiKey(dep.adminCredentialProfile.credentials, getEncryptionKey());
                                await updatePhraseSet(
                                    dep.adminCredentialProfile.projectId,
                                    dep.adminCredentialProfile.scopes,
                                    credJson,
                                    dep.resourceName,
                                    def.phrases as { value: string; boost?: number }[],
                                );
                                await db.update(schema.phraseSetDeployments)
                                    .set({ state: 'synced', lastVerifiedAt: new Date(), updatedAt: new Date() })
                                    .where(eq(schema.phraseSetDeployments.id, dep.id));
                            } catch (err: any) {
                                errors.push({ id: dep.id, error: err?.message ?? String(err) });
                            }
                        }

                        return {
                            synced: deployments.length - errors.length,
                            errors,
                        };
                    }),

                pushToDevice: adminProcedure
                    .input(z.object({
                        deviceId: z.number(),
                        deploymentIds: z.array(z.number()),
                    }))
                    .mutation(async ({ input }) => {
                        if (input.deploymentIds.length === 0) {
                            // Push empty array to clear phrase sets on device
                            relay.sendToDevice(input.deviceId, {
                                type: 'setArray',
                                key: 'transcription.phraseSets',
                                value: [],
                            });
                            await db.update(schema.devices)
                                .set({
                                    pushedSettings: { transcription: { phraseSets: [], phraseSetDeploymentIds: [] } },
                                    updatedAt: new Date(),
                                })
                                .where(eq(schema.devices.id, input.deviceId));
                            return { pushed: 0, warnings: [] as string[] };
                        }

                        const deployments = await db.query.phraseSetDeployments.findMany({
                            where: (d, { inArray }) => inArray(d.id, input.deploymentIds),
                        });

                        const missing = deployments.filter(d => d.state === 'missing');
                        if (missing.length > 0) {
                            throw new TRPCError({
                                code: 'BAD_REQUEST',
                                message: `${missing.length} deployment(s) are missing from GCP and cannot be pushed: ${missing.map(d => d.resourceName).join(', ')}`,
                            });
                        }

                        const pending = deployments.filter(d => d.state === 'pending');
                        if (pending.length > 0) {
                            throw new TRPCError({
                                code: 'BAD_REQUEST',
                                message: `${pending.length} deployment(s) have unsynchronised changes. Deploy to GCP first: ${pending.map(d => d.resourceName).join(', ')}`,
                            });
                        }

                        const warnings = deployments
                            .filter(d => d.state === 'drifted' || d.state === 'unknown')
                            .map(d => `${d.resourceName} (${d.state})`);

                        const resourceNames = deployments.map(d => d.resourceName);

                        relay.sendToDevice(input.deviceId, {
                            type: 'setArray',
                            key: 'transcription.phraseSets',
                            value: resourceNames,
                        });

                        // Store assignment in pushedSettings so offline devices receive it on heartbeat
                        // and so the admin panel can display what's currently assigned
                        const device = await db.query.devices.findFirst({
                            where: eq(schema.devices.id, input.deviceId),
                            columns: { pushedSettings: true },
                        });
                        const existingSettings = (device?.pushedSettings as Record<string, unknown>) ?? {};
                        const merged = {
                            ...existingSettings,
                            transcription: {
                                ...((existingSettings.transcription as Record<string, unknown>) ?? {}),
                                phraseSets: resourceNames,
                                phraseSetDeploymentIds: input.deploymentIds,
                            },
                        };
                        await db.update(schema.devices)
                            .set({ pushedSettings: merged, updatedAt: new Date() })
                            .where(eq(schema.devices.id, input.deviceId));

                        return { pushed: resourceNames.length, warnings };
                    }),
            }),
        }),
    });
}

export type AppRouter = ReturnType<typeof createRouter>;
