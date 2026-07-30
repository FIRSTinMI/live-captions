import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { getJwtSecret, signAdminToken } from './index';

// #region config
// Additive "Log in with Authelia" OIDC (authorization-code + PKCE, client_secret_post).
// This lives entirely alongside the existing username/password login. When
// OIDC_CLIENT_SECRET is unset the whole feature is disabled and the app keeps
// running with password login only.

const OIDC_ISSUER = process.env.OIDC_ISSUER ?? 'https://auth.filipkin.com';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'captions';
const OIDC_REDIRECT_URI =
    process.env.OIDC_REDIRECT_URI ?? 'https://captions.filipkin.com/admin/oidc/callback';
const OIDC_SCOPES = 'openid profile email groups';
const REQUIRED_GROUP = 'admins';
const TX_COOKIE = 'oidc_tx';
const TX_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the round-trip

function clientSecret(): string | undefined {
    return process.env.OIDC_CLIENT_SECRET;
}

/** True when the operator has configured an OIDC client secret. */
export function isOidcEnabled(): boolean {
    return !!clientSecret();
}
// #endregion

// #region discovery
interface OidcEndpoints {
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
}

// Sensible fallbacks matching the Authelia deployment, used if discovery fails.
const FALLBACK_ENDPOINTS: OidcEndpoints = {
    authorization_endpoint: `${OIDC_ISSUER}/api/oidc/authorization`,
    token_endpoint: `${OIDC_ISSUER}/api/oidc/token`,
    userinfo_endpoint: `${OIDC_ISSUER}/api/oidc/userinfo`,
};

let cachedEndpoints: OidcEndpoints | null = null;

async function getEndpoints(): Promise<OidcEndpoints> {
    if (cachedEndpoints) return cachedEndpoints;
    try {
        const res = await fetch(`${OIDC_ISSUER}/.well-known/openid-configuration`);
        if (res.ok) {
            const doc = (await res.json()) as Partial<OidcEndpoints>;
            if (doc.authorization_endpoint && doc.token_endpoint && doc.userinfo_endpoint) {
                cachedEndpoints = {
                    authorization_endpoint: doc.authorization_endpoint,
                    token_endpoint: doc.token_endpoint,
                    userinfo_endpoint: doc.userinfo_endpoint,
                };
                return cachedEndpoints;
            }
        }
        console.warn('[oidc] Discovery document incomplete; using fallback endpoints');
    } catch (err) {
        console.warn('[oidc] Discovery failed; using fallback endpoints:', err);
    }
    cachedEndpoints = FALLBACK_ENDPOINTS;
    return cachedEndpoints;
}
// #endregion

// #region pkce + signed transaction cookie
function base64url(buf: Buffer): string {
    return buf.toString('base64url');
}

interface TxState {
    state: string;
    codeVerifier: string;
    ts: number;
}

function signTx(payload: TxState): string {
    const data = base64url(Buffer.from(JSON.stringify(payload)));
    const sig = createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verifyTx(token: string | undefined): TxState | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TxState;
        if (typeof payload.ts !== 'number' || Date.now() - payload.ts > TX_TTL_MS) return null;
        if (!payload.state || !payload.codeVerifier) return null;
        return payload;
    } catch {
        return null;
    }
}

function readCookie(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() === name) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return undefined;
}

const COOKIE_PATH = '/admin/oidc';

function setTxCookie(res: Response, value: string): void {
    res.cookie(TX_COOKIE, value, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: COOKIE_PATH,
        maxAge: TX_TTL_MS,
    });
}

function clearTxCookie(res: Response): void {
    res.clearCookie(TX_COOKIE, { path: COOKIE_PATH });
}
// #endregion

// #region routes
function loginErrorRedirect(res: Response, code: string): void {
    res.redirect(`/admin/login?error=${encodeURIComponent(code)}`);
}

async function handleLogin(_req: Request, res: Response): Promise<void> {
    if (!isOidcEnabled()) return loginErrorRedirect(res, 'oidc_disabled');

    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const state = base64url(randomBytes(16));

    setTxCookie(res, signTx({ state, codeVerifier, ts: Date.now() }));

    const { authorization_endpoint } = await getEndpoints();
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: OIDC_CLIENT_ID,
        redirect_uri: OIDC_REDIRECT_URI,
        scope: OIDC_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    res.redirect(`${authorization_endpoint}?${params.toString()}`);
}

async function handleCallback(req: Request, res: Response): Promise<void> {
    if (!isOidcEnabled()) return loginErrorRedirect(res, 'oidc_disabled');

    // The transaction cookie is single-use regardless of outcome.
    const tx = verifyTx(readCookie(req, TX_COOKIE));
    clearTxCookie(res);

    try {
        const { code, state, error } = req.query as Record<string, string | undefined>;
        if (error) return loginErrorRedirect(res, 'oidc_denied');
        if (!code || !state) return loginErrorRedirect(res, 'oidc_failed');
        if (!tx || tx.state !== state) return loginErrorRedirect(res, 'oidc_state');

        const { token_endpoint, userinfo_endpoint } = await getEndpoints();

        // Exchange the authorization code (client_secret_post + PKCE verifier).
        const tokenRes = await fetch(token_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: OIDC_REDIRECT_URI,
                client_id: OIDC_CLIENT_ID,
                client_secret: clientSecret() as string,
                code_verifier: tx.codeVerifier,
            }).toString(),
        });
        if (!tokenRes.ok) {
            console.warn('[oidc] Token exchange failed:', tokenRes.status, await safeText(tokenRes));
            return loginErrorRedirect(res, 'oidc_failed');
        }
        const tokens = (await tokenRes.json()) as { access_token?: string };
        if (!tokens.access_token) return loginErrorRedirect(res, 'oidc_failed');

        // Fetch userinfo to authorize and identify the admin.
        const userinfoRes = await fetch(userinfo_endpoint, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
        });
        if (!userinfoRes.ok) {
            console.warn('[oidc] Userinfo failed:', userinfoRes.status);
            return loginErrorRedirect(res, 'oidc_failed');
        }
        const userinfo = (await userinfoRes.json()) as {
            groups?: string[];
            email?: string;
            preferred_username?: string;
        };

        // Defense in depth: the client is restricted to group:admins server-side,
        // but re-check here before minting a session.
        const groups = Array.isArray(userinfo.groups) ? userinfo.groups : [];
        if (!groups.includes(REQUIRED_GROUP)) {
            console.warn('[oidc] Rejecting login: user not in required group');
            return loginErrorRedirect(res, 'oidc_forbidden');
        }

        // Match to an existing local admin record by preferred_username / email
        // (or email local-part) so the minted JWT is identical to a password login.
        // If none matches, the user is still an authorized org admin: mint the
        // session anyway with a synthetic id, and do NOT create/alter any user row.
        const adminId = await resolveAdminId(userinfo.preferred_username, userinfo.email);

        // Mint the SAME admin JWT the password login mints, then hand it to the
        // SPA via the URL fragment (never sent to the server / never logged).
        const token = signAdminToken(adminId);
        res.redirect(`/admin/login#token=${encodeURIComponent(token)}`);
    } catch (err) {
        console.warn('[oidc] Callback error:', err);
        return loginErrorRedirect(res, 'oidc_failed');
    }
}

async function resolveAdminId(
    preferredUsername: string | undefined,
    email: string | undefined,
): Promise<number> {
    const candidates = new Set<string>();
    if (preferredUsername) candidates.add(preferredUsername);
    if (email) {
        candidates.add(email);
        const local = email.split('@')[0];
        if (local) candidates.add(local);
    }
    for (const username of candidates) {
        const user = await db.query.users.findFirst({
            where: eq(schema.users.username, username),
        });
        if (user) return user.id;
    }
    // No local record. Authorized admins-group user with no password account.
    // Negative id can never collide with a serial user id, keeping the
    // self-delete guard and any id-based lookups safe.
    return -1;
}

async function safeText(res: globalThis.Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 500);
    } catch {
        return '<no body>';
    }
}

/** Register the additive OIDC login routes. Must be mounted before the
 *  /admin static + SPA catch-all so these paths are handled server-side. */
export function registerOidcRoutes(app: Express): void {
    app.get('/admin/oidc/login', (req, res) => {
        handleLogin(req, res).catch(() => loginErrorRedirect(res, 'oidc_failed'));
    });
    app.get('/admin/oidc/callback', (req, res) => {
        handleCallback(req, res).catch(() => loginErrorRedirect(res, 'oidc_failed'));
    });
}
// #endregion
