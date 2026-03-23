import { v2 } from '@google-cloud/speech';

export interface PhraseSetPhrase {
    value: string;
    boost?: number;
}

export interface RemotePhraseSet {
    resourceName: string;
    displayName: string;
    phrases: PhraseSetPhrase[];
}

interface ServiceAccountCredentials {
    client_email: string;
    private_key: string;
    project_id?: string;
}

function buildClient(projectId: string, scopes: string, credJson: string): v2.SpeechClient {
    const creds = JSON.parse(credJson) as ServiceAccountCredentials;
    return new v2.SpeechClient({
        projectId,
        scopes,
        credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
        },
    });
}

export async function listPhraseSets(
    projectId: string,
    scopes: string,
    credJson: string,
    location = 'global',
): Promise<RemotePhraseSet[]> {
    const client = buildClient(projectId, scopes, credJson);
    const parent = `projects/${projectId}/locations/${location}`;
    const [phraseSets] = await client.listPhraseSets({ parent });
    return (phraseSets ?? []).map(ps => ({
        resourceName: ps.name ?? '',
        displayName: ps.displayName ?? ps.name?.split('/').pop() ?? '',
        phrases: (ps.phrases ?? []).map(p => ({
            value: p.value ?? '',
            ...(p.boost != null ? { boost: p.boost } : {}),
        })),
    }));
}

export async function getPhraseSet(
    projectId: string,
    scopes: string,
    credJson: string,
    resourceName: string,
): Promise<RemotePhraseSet> {
    const client = buildClient(projectId, scopes, credJson);
    const [ps] = await client.getPhraseSet({ name: resourceName });
    return {
        resourceName: ps.name ?? resourceName,
        displayName: ps.displayName ?? ps.name?.split('/').pop() ?? '',
        phrases: (ps.phrases ?? []).map(p => ({
            value: p.value ?? '',
            ...(p.boost != null ? { boost: p.boost } : {}),
        })),
    };
}

export async function createPhraseSet(
    projectId: string,
    scopes: string,
    credJson: string,
    location: string,
    phraseSetId: string,
    phrases: PhraseSetPhrase[],
): Promise<string> {
    const client = buildClient(projectId, scopes, credJson);
    const parent = `projects/${projectId}/locations/${location}`;
    const [operation] = await client.createPhraseSet({
        parent,
        phraseSetId,
        phraseSet: {
            phrases: phrases.map(p => ({ value: p.value, boost: p.boost ?? 0 })),
        },
    });
    const [result] = await operation.promise();
    return result.name ?? `${parent}/phraseSets/${phraseSetId}`;
}

export async function updatePhraseSet(
    projectId: string,
    scopes: string,
    credJson: string,
    resourceName: string,
    phrases: PhraseSetPhrase[],
): Promise<void> {
    const client = buildClient(projectId, scopes, credJson);
    const [operation] = await client.updatePhraseSet({
        phraseSet: {
            name: resourceName,
            phrases: phrases.map(p => ({ value: p.value, boost: p.boost ?? 0 })),
        },
        updateMask: { paths: ['phrases'] },
    });
    await operation.promise();
}

export async function deletePhraseSet(
    projectId: string,
    scopes: string,
    credJson: string,
    resourceName: string,
): Promise<void> {
    const client = buildClient(projectId, scopes, credJson);
    const [operation] = await client.deletePhraseSet({ name: resourceName });
    await operation.promise();
}
