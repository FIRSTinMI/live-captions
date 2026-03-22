import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
import jwt from 'jsonwebtoken';

const ALGORITHM = 'aes-256-cbc';

export function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET env var is required');
    return secret;
}

export function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY env var is required');
    const buf = Buffer.from(key, 'hex');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    return buf;
}

export function signAdminToken(adminId: number): string {
    return jwt.sign({ adminId, type: 'admin' }, getJwtSecret(), { expiresIn: '24h' });
}

export function verifyAdminToken(token: string): { adminId: number } | null {
    try {
        const decoded = jwt.verify(token, getJwtSecret()) as { adminId: number; type: string };
        if (decoded.type !== 'admin') return null;
        return { adminId: decoded.adminId };
    } catch {
        return null;
    }
}

export function generateDeviceToken(): string {
    return randomBytes(32).toString('hex');
}

export function hashDeviceToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function encryptApiKey(apiKey: string, encryptionKey: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(encryptedApiKey: string, encryptionKey: Buffer): string {
    const [ivHex, encryptedHex] = encryptedApiKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
