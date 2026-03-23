import { pgTable, serial, text, timestamp, integer, numeric, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const apiKeyTypeEnum = pgEnum('api_key_type', ['google-v1', 'google-v2']);
export const adminCredentialRoleEnum = pgEnum('admin_credential_role', ['client', 'admin']);
export const phraseSetStateEnum = pgEnum('phrase_set_state', ['unknown', 'synced', 'pending', 'drifted', 'missing']);

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

export const deviceGroups = pgTable('device_groups', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const devices = pgTable('devices', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    tag: text('tag').notNull().default(''),
    pin: text('pin').notNull(), // stored plain - 6-digit code shown to operators
    tokenHash: text('token_hash'),
    apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    groupId: integer('group_id').references(() => deviceGroups.id, { onDelete: 'set null' }),
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

export const deviceGroupsRelations = relations(deviceGroups, ({ many }) => ({
    devices: many(devices),
}));

export const devicesRelations = relations(devices, ({ many, one }) => ({
    usageLogs: many(usageLogs),
    errorLogs: many(errorLogs),
    apiKey: one(apiKeys, { fields: [devices.apiKeyId], references: [apiKeys.id] }),
    group: one(deviceGroups, { fields: [devices.groupId], references: [deviceGroups.id] }),
}));

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
    device: one(devices, { fields: [usageLogs.deviceId], references: [devices.id] }),
}));

export const errorLogsRelations = relations(errorLogs, ({ one }) => ({
    device: one(devices, { fields: [errorLogs.deviceId], references: [devices.id] }),
}));

// ── Phrase set management ──────────────────────────────────────────────────

export const googleCredentialProfiles = pgTable('google_credential_profiles', {
    id: serial('id').primaryKey(),
    label: text('label').notNull(),
    role: adminCredentialRoleEnum('role').notNull(),
    projectId: text('project_id').notNull(),
    scopes: text('scopes').notNull().default('https://www.googleapis.com/auth/cloud-platform'),
    credentials: text('credentials').notNull(), // AES-256 encrypted JSON service account
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const phraseSetDefinitions = pgTable('phrase_set_definitions', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    phrases: jsonb('phrases').$type<{ value: string; boost?: number }[]>().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const phraseSetDeployments = pgTable('phrase_set_deployments', {
    id: serial('id').primaryKey(),
    definitionId: integer('definition_id').notNull().references(() => phraseSetDefinitions.id, { onDelete: 'restrict' }),
    adminCredentialProfileId: integer('admin_credential_profile_id').notNull().references(() => googleCredentialProfiles.id, { onDelete: 'restrict' }),
    projectId: text('project_id').notNull(),
    location: text('location').notNull().default('global'),
    resourceName: text('resource_name').notNull(),
    state: phraseSetStateEnum('state').notNull().default('unknown'),
    lastVerifiedAt: timestamp('last_verified_at'),
    importedFrom: text('imported_from'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const googleCredentialProfilesRelations = relations(googleCredentialProfiles, ({ many }) => ({
    deployments: many(phraseSetDeployments),
}));

export const phraseSetDefinitionsRelations = relations(phraseSetDefinitions, ({ many }) => ({
    deployments: many(phraseSetDeployments),
}));

export const phraseSetDeploymentsRelations = relations(phraseSetDeployments, ({ one }) => ({
    definition: one(phraseSetDefinitions, { fields: [phraseSetDeployments.definitionId], references: [phraseSetDefinitions.id] }),
    adminCredentialProfile: one(googleCredentialProfiles, { fields: [phraseSetDeployments.adminCredentialProfileId], references: [googleCredentialProfiles.id] }),
}));

