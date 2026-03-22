import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { relay } from './relay';
import { hashDeviceToken, verifyAdminToken } from './auth';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

export function createServer() {
    const app = express();
    expressWs(app);
    const wsApp = app as expressWs.Application;

    wsApp.use(cors());
    wsApp.use(bodyParser.json());

    const router = createRouter();
    wsApp.use('/trpc', createExpressMiddleware({ router, createContext }));

    // Device relay WebSocket
    wsApp.ws('/ws/device', async (ws, req) => {
        const token = req.query.token as string | undefined;
        if (!token) { ws.close(1008, 'Missing token'); return; }

        const tokenHash = hashDeviceToken(token);
        const device = await db.query.devices.findFirst({ where: eq(schema.devices.tokenHash, tokenHash) });
        if (!device) { ws.close(1008, 'Invalid token'); return; }

        relay.connectDevice(device.id, ws);
    });

    // Admin relay WebSocket
    wsApp.ws('/ws/admin/:deviceId', (ws, req) => {
        const token = req.query.token as string | undefined;
        if (!token) { ws.close(1008, 'Missing token'); return; }

        const auth = verifyAdminToken(token);
        if (!auth) { ws.close(1008, 'Invalid token'); return; }

        const deviceId = parseInt(req.params.deviceId, 10);
        if (isNaN(deviceId)) { ws.close(1008, 'Invalid device ID'); return; }

        relay.connectAdmin(deviceId, ws);
    });

    // Serve admin panel static files
    const adminDir = path.join(__dirname, 'public', 'admin');
    wsApp.use('/admin', express.static(adminDir));
    wsApp.get('/admin/*', (_req, res) => {
        res.sendFile(path.join(adminDir, 'index.html'));
    });

    wsApp.get('/health', (_req, res) => res.json({ ok: true }));
    wsApp.get('/', (_req, res) => res.redirect('/admin'));

    return wsApp;
}
