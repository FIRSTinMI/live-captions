import { pgTable, serial, text, timestamp, integer, numeric, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const apiKeyTypeEnum = pgEnum('api_key_type', ['google-v1', 'google-v2']);

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    password: text('password').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    key: text('key').notNull(), // AES-256 encrypted JSON credentials
    keyType: apiKeyTypeEnum('key_type').notNull().default('google-v2'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const devices = pgTable('devices', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    tag: text('tag').notNull().default(''),
    pin: text('pin').notNull(),
    tokenHash: text('token_hash'),
    apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    settings: jsonb('settings'),       // last reported by device (read-only from admin)
    pushedSettings: jsonb('pushed_settings'), // admin override, cleared when device acks
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at'),
    lastHeartbeatAt: timestamp('last_heartbeat_at'),
});

export const usageLogs = pgTable('usage_logs', {
    id: serial('id').primaryKey(),
    deviceId: integer('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    minutesUsed: numeric('minutes_used', { precision: 10, scale: 3 }).notNull(),
    recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

export const errorLogs = pgTable('error_logs', {
    id: serial('id').primaryKey(),
    deviceId: integer('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    context: jsonb('context'),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
});

// Relations
export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
    devices: many(devices),
}));

export const devicesRelations = relations(devices, ({ many, one }) => ({
    usageLogs: many(usageLogs),
    errorLogs: many(errorLogs),
    apiKey: one(apiKeys, { fields: [devices.apiKeyId], references: [apiKeys.id] }),
}));

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
    device: one(devices, { fields: [usageLogs.deviceId], references: [devices.id] }),
}));

export const errorLogsRelations = relations(errorLogs, ({ one }) => ({
    device: one(devices, { fields: [errorLogs.deviceId], references: [devices.id] }),
}));

