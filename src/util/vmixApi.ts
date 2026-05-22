const VMIX_HOST = '127.0.0.1:8088';
const BASE_URL = `http://${VMIX_HOST}/api/`;

export interface VmixInput {
    key: string;
    number: string;
    title: string;
    type: string;
}

export class VmixUnreachableError extends Error {
    constructor() {
        super(`Could not reach vMix at ${VMIX_HOST} — is it running with the Web Controller enabled?`);
    }
}

export class VmixApiError extends Error {
    constructor(message: string) {
        super(message);
    }
}

async function call(params: Record<string, string>): Promise<string> {
    const qs = new URLSearchParams(params).toString();
    let res: Response;
    try {
        res = await fetch(`${BASE_URL}?${qs}`);
    } catch (err) {
        throw new VmixUnreachableError();
    }
    if (!res.ok) {
        throw new VmixApiError(`vMix API ${res.status} ${res.statusText}`);
    }
    return res.text();
}

export async function getInputs(): Promise<VmixInput[]> {
    let xml: string;
    try {
        const res = await fetch(BASE_URL);
        if (!res.ok) throw new VmixApiError(`vMix API ${res.status} ${res.statusText}`);
        xml = await res.text();
    } catch (err) {
        if (err instanceof VmixApiError) throw err;
        throw new VmixUnreachableError();
    }

    const inputs: VmixInput[] = [];
    const inputRegex = /<input\b([^>]*)>/g;
    let match: RegExpExecArray | null;
    while ((match = inputRegex.exec(xml)) !== null) {
        const attrs = match[1];
        inputs.push({
            key: extractAttr(attrs, 'key') ?? '',
            number: extractAttr(attrs, 'number') ?? '',
            title: extractAttr(attrs, 'title') ?? '',
            type: extractAttr(attrs, 'type') ?? '',
        });
    }
    return inputs;
}

function extractAttr(attrs: string, name: string): string | undefined {
    const re = new RegExp(`\\b${name}="([^"]*)"`);
    const m = attrs.match(re);
    if (!m) return undefined;
    return decodeXmlEntities(m[1]);
}

function decodeXmlEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

export async function addBrowserInput(url: string): Promise<string> {
    const beforeKeys = new Set((await getInputs()).map(i => i.key));
    await call({ Function: 'AddInput', Value: `Browser|${url}` });
    for (let attempt = 0; attempt < 20; attempt++) {
        const after = await getInputs();
        const created = after.find(i => !beforeKeys.has(i.key));
        if (created) return created.key;
        await new Promise(r => setTimeout(r, 150));
    }
    throw new VmixApiError('AddInput succeeded but the new input could not be located after 3s.');
}

export async function setInputName(key: string, name: string): Promise<void> {
    await call({ Function: 'SetInputName', Input: key, Value: name });
}

export async function overlayIn(channel: number, inputKey: string): Promise<void> {
    await call({ Function: `OverlayInput${channel}In`, Input: inputKey });
}
