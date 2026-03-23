import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { decryptApiKey, getEncryptionKey } from '../auth';
import { listPhraseSets, getPhraseSet } from './phraseSetService';

/**
 * Discovers GCP PhraseSets for a single admin credential profile and upserts
 * any that are not already tracked as deployments.
 *
 * Safe to call multiple times - existing deployments are never overwritten.
 */
export async function discoverForProfile(profileId: number): Promise<{ imported: number }> {
    const profile = await db.query.googleCredentialProfiles.findFirst({
        where: eq(schema.googleCredentialProfiles.id, profileId),
    });
    if (!profile || profile.role !== 'admin') return { imported: 0 };

    let credJson: string;
    try {
        credJson = decryptApiKey(profile.credentials, getEncryptionKey());
    } catch {
        console.error(`[phrase-sets] Failed to decrypt credentials for profile ${profile.id} (${profile.label})`);
        return { imported: 0 };
    }

    let remoteSets;
    try {
        remoteSets = await listPhraseSets(profile.projectId, profile.scopes, credJson);
    } catch (err) {
        console.error(`[phrase-sets] Discovery failed for profile ${profile.id} (${profile.label}):`, err);
        return { imported: 0 };
    }

    // Load existing deployments for this project to avoid duplicates
    const existing = await db.query.phraseSetDeployments.findMany({
        where: eq(schema.phraseSetDeployments.adminCredentialProfileId, profile.id),
    });
    const existingNames = new Set(existing.map(d => d.resourceName));

    let imported = 0;
    for (const remote of remoteSets) {
        if (!remote.resourceName || existingNames.has(remote.resourceName)) continue;

        // Fetch full phrase content
        let phrases: { value: string; boost?: number }[] = remote.phrases;
        if (phrases.length === 0) {
            try {
                const full = await getPhraseSet(profile.projectId, profile.scopes, credJson, remote.resourceName);
                phrases = full.phrases;
            } catch {
                // Proceed with empty phrases rather than failing the whole import
            }
        }

        // Derive a friendly name from the resource name (last path segment)
        const resourceId = remote.resourceName.split('/').pop() ?? remote.resourceName;

        // Create definition
        const [def] = await db.insert(schema.phraseSetDefinitions).values({
            name: remote.displayName || resourceId,
            phrases,
        }).returning({ id: schema.phraseSetDefinitions.id });

        // Parse location from resourceName: projects/{p}/locations/{loc}/phraseSets/{id}
        const parts = remote.resourceName.split('/');
        const location = parts[3] ?? 'global';

        // Create deployment (state = synced: GCP is the source of truth at import time)
        await db.insert(schema.phraseSetDeployments).values({
            definitionId: def.id,
            adminCredentialProfileId: profile.id,
            projectId: profile.projectId,
            location,
            resourceName: remote.resourceName,
            state: 'synced',
            lastVerifiedAt: new Date(),
            importedFrom: remote.resourceName,
        });

        imported++;
        console.log(`[phrase-sets] Imported: ${remote.resourceName}`);
    }

    return { imported };
}

/**
 * Runs discovery across ALL admin credential profiles.
 * Called automatically on server boot. Errors are caught per-profile and are not fatal.
 */
export async function discoverAllPhraseSets(): Promise<void> {
    let profiles;
    try {
        profiles = await db.query.googleCredentialProfiles.findMany({
            where: eq(schema.googleCredentialProfiles.role, 'admin'),
        });
    } catch (err) {
        console.error('[phrase-sets] Could not load credential profiles for discovery:', err);
        return;
    }

    if (profiles.length === 0) {
        console.log('[phrase-sets] No admin credential profiles configured - skipping discovery');
        return;
    }

    let total = 0;
    for (const profile of profiles) {
        const { imported } = await discoverForProfile(profile.id);
        total += imported;
    }

    console.log(`[phrase-sets] Discovery complete: ${total} new definition(s) imported`);
}
