import { Request } from 'express';
import { db, schema } from '../db';
import { verifyAdminToken, hashDeviceToken } from '../auth';
import { eq } from 'drizzle-orm';

export interface Context {
    adminId: number | null;
    deviceId: number | null;
}

export async function createContext({ req }: { req: Request }): Promise<Context> {
    const authHeader = req.headers.authorization;
    let adminId: number | null = null;
    let deviceId: number | null = null;

    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);

        // Try admin JWT first
        const adminPayload = verifyAdminToken(token);
        if (adminPayload) {
            adminId = adminPayload.adminId;
        } else {
            // Try device opaque token
            try {
                const tokenHash = hashDeviceToken(token);
                const device = await db.query.devices.findFirst({
                    where: eq(schema.devices.tokenHash, tokenHash),
                });
                if (device) {
                    deviceId = device.id;
                    // Update lastSeenAt
                    await db.update(schema.devices)
                        .set({ lastSeenAt: new Date() })
                        .where(eq(schema.devices.id, device.id));
                }
            } catch {
                // DB unavailable - leave deviceId null
            }
        }
    }

    return { adminId, deviceId };
}
