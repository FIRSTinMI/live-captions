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

async function getDecryptedApiKeyForDevice(deviceId: number): Promise<{ key: string; keyType: string } | null> {
    const device = await db.query.devices.findFirst({
        where: eq(schema.devices.id, deviceId),
        with: { apiKey: true },
    });
    if (!device?.apiKey) return null;
    try {
        return {
            key: decryptApiKey(device.apiKey.key, getEncryptionKey()),
            keyType: device.apiKey.keyType,
        };
    } catch {
        return null;
    }
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

                const withinWindow = device.lastHeartbeatAt &&
                    Date.now() - device.lastHeartbeatAt.getTime() < SEVEN_DAYS_MS;
                let apiKey: string | null = null;
                let apiKeyType = 'google-v2';
                if (withinWindow && device.apiKey) {
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

                    const [device, keyData] = await Promise.all([
                        db.query.devices.findFirst({ where: eq(schema.devices.id, ctx.deviceId) }),
                        getDecryptedApiKeyForDevice(ctx.deviceId),
                    ]);

                    return {
                        apiKey: keyData?.key ?? null,
                        apiKeyType: keyData?.keyType ?? 'google-v2',
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
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.devices.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.name) updates.name = input.name;
                        if (input.tag !== undefined) updates.tag = input.tag;
                        if ('apiKeyId' in input) updates.apiKeyId = input.apiKeyId ?? null;
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
        }),
    });
}

export type AppRouter = ReturnType<typeof createRouter>;
