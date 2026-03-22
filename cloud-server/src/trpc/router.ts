import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and, isNull, inArray, desc, gte, sql } from 'drizzle-orm';
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

async function getDecryptedApiKey(deviceId: number): Promise<string | null> {
    const device = await db.query.devices.findFirst({
        where: eq(schema.devices.id, deviceId),
    });
    if (!device || !device.apiKey) return null;
    try {
        return decryptApiKey(device.apiKey, getEncryptionKey());
    } catch {
        return null;
    }
}

async function getPendingSettings(deviceId: number) {
    return db.query.settingsQueue.findMany({
        where: and(eq(schema.settingsQueue.deviceId, deviceId), isNull(schema.settingsQueue.appliedAt)),
    });
}

export function createRouter() {
    return t.router({
        // ─── Device routes ───────────────────────────────────────────────
        device: t.router({
            auth: publicProcedure
                .input(z.object({ pin: z.string() }))
                .mutation(async ({ input }) => {
                    const allDevices = await db.query.devices.findMany();
                    let matched: typeof allDevices[0] | null = null;
                    for (const device of allDevices) {
                        if (await bcrypt.compare(input.pin, device.pin)) {
                            matched = device;
                            break;
                        }
                    }
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
                });
                if (!device) throw new TRPCError({ code: 'NOT_FOUND' });

                const withinWindow = device.lastHeartbeatAt &&
                    Date.now() - device.lastHeartbeatAt.getTime() < SEVEN_DAYS_MS;
                let apiKey: string | null = null;
                if (withinWindow && device.apiKey) {
                    try {
                        apiKey = decryptApiKey(device.apiKey, getEncryptionKey());
                    } catch { /* bad key */ }
                }

                const pending = await getPendingSettings(ctx.deviceId);
                return {
                    apiKey,
                    apiKeyType: device.apiKeyType,
                    pendingSettings: pending.map(p => p.settings),
                };
            }),

            heartbeat: deviceProcedure
                .input(z.object({
                    minutesUsed: z.number().min(0),
                    errors: z.array(z.object({
                        message: z.string(),
                        context: z.record(z.any()).optional(),
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
                                occurredAt: now,
                            }))
                        );
                    }

                    const pending = await getPendingSettings(ctx.deviceId);
                    if (pending.length > 0) {
                        await db.update(schema.settingsQueue)
                            .set({ appliedAt: now })
                            .where(inArray(schema.settingsQueue.id, pending.map(p => p.id)));
                    }

                    const apiKey = await getDecryptedApiKey(ctx.deviceId);
                    const device = await db.query.devices.findFirst({
                        where: eq(schema.devices.id, ctx.deviceId),
                    });

                    return {
                        apiKey,
                        apiKeyType: device?.apiKeyType ?? 'google-v2',
                        pendingSettings: pending.map(p => p.settings),
                    };
                }),
        }),

        // ─── Admin routes ─────────────────────────────────────────────────
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

            devices: t.router({
                list: adminProcedure.query(async () => {
                    const devs = await db.query.devices.findMany({
                        orderBy: [desc(schema.devices.createdAt)],
                    });

                    // Get today's usage for each device
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
                        apiKeyType: d.apiKeyType,
                        hasApiKey: !!d.apiKey,
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
                        });
                        if (!device) throw new TRPCError({ code: 'NOT_FOUND' });
                        return {
                            id: device.id,
                            name: device.name,
                            apiKeyType: device.apiKeyType,
                            hasApiKey: !!device.apiKey,
                            settings: device.settings,
                            lastSeenAt: device.lastSeenAt,
                            lastHeartbeatAt: device.lastHeartbeatAt,
                            createdAt: device.createdAt,
                        };
                    }),

                create: adminProcedure
                    .input(z.object({
                        name: z.string().min(1),
                        pin: z.string().min(4).max(20),
                        apiKey: z.string().min(1),
                        apiKeyType: z.enum(['google-v1', 'google-v2']),
                    }))
                    .mutation(async ({ input }) => {
                        const pinHash = await bcrypt.hash(input.pin, 10);
                        const encryptedKey = encryptApiKey(JSON.stringify(JSON.parse(input.apiKey)), getEncryptionKey());
                        const [device] = await db.insert(schema.devices).values({
                            name: input.name,
                            pin: pinHash,
                            apiKey: encryptedKey,
                            apiKeyType: input.apiKeyType,
                        }).returning({ id: schema.devices.id, name: schema.devices.name });
                        return device;
                    }),

                update: adminProcedure
                    .input(z.object({
                        id: z.number(),
                        name: z.string().min(1).optional(),
                        pin: z.string().min(4).max(20).optional(),
                        apiKey: z.string().min(1).optional(),
                        apiKeyType: z.enum(['google-v1', 'google-v2']).optional(),
                    }))
                    .mutation(async ({ input }) => {
                        const updates: Partial<typeof schema.devices.$inferInsert> = {
                            updatedAt: new Date(),
                        };
                        if (input.name) updates.name = input.name;
                        if (input.pin) updates.pin = await bcrypt.hash(input.pin, 10);
                        if (input.apiKey) updates.apiKey = encryptApiKey(JSON.stringify(JSON.parse(input.apiKey)), getEncryptionKey());
                        if (input.apiKeyType) updates.apiKeyType = input.apiKeyType;
                        await db.update(schema.devices).set(updates).where(eq(schema.devices.id, input.id));
                    }),

                delete: adminProcedure
                    .input(z.object({ id: z.number() }))
                    .mutation(async ({ input }) => {
                        await db.delete(schema.devices).where(eq(schema.devices.id, input.id));
                    }),

                pushSettings: adminProcedure
                    .input(z.object({
                        deviceId: z.number(),
                        settings: z.record(z.any()),
                    }))
                    .mutation(async ({ input }) => {
                        await db.insert(schema.settingsQueue).values({
                            deviceId: input.deviceId,
                            settings: input.settings,
                        });
                        await db.update(schema.devices)
                            .set({ settings: input.settings, updatedAt: new Date() })
                            .where(eq(schema.devices.id, input.deviceId));
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
