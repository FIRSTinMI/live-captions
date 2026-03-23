import http from 'http';
import { parse as parseUrl } from 'url';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { WebSocketServer } from 'ws';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { relay } from './relay';
import { hashDeviceToken, verifyAdminToken } from './auth';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

export function createServer() {
    const app = express();

    app.use(cors());
    app.use(bodyParser.json());

    const router = createRouter();
    app.use('/trpc', createExpressMiddleware({ router, createContext }));

    // Serve admin panel static files
    const adminDir = path.join(__dirname, 'public', 'admin');
    app.use('/admin', express.static(adminDir));
    app.get('/admin/*', (_req, res) => {
        res.sendFile(path.join(adminDir, 'index.html'));
    });

    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/', (_req, res) => res.redirect('/admin'));

    // Save device config to DB whenever the device reports its current state
    relay.setErrorLogHandler((deviceId, message, context, occurredAt) => {
        db.insert(schema.errorLogs).values({ deviceId, message, context: context as object, occurredAt })
            .catch(() => { /* best-effort */ });
    });

    relay.setConfigSaveHandler((deviceId, config, source) => {
        db.update(schema.devices)
            .set({
                settings: config,
                // Clear pending push when device acks with a live config message
                ...(source === 'config' ? { pushedSettings: null } : {}),
                updatedAt: new Date(),
            })
            .where(eq(schema.devices.id, deviceId))
            .catch(() => { /* best-effort */ });
    });

    // Attach WebSocket server to the http server (no extra framework needed)
    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', async (req, socket, head) => {
        const { pathname, query } = parseUrl(req.url ?? '', true);
        const token = query.token as string | undefined;

        if (pathname === '/ws/device') {
            if (!token) { socket.destroy(); return; }
            const tokenHash = hashDeviceToken(token);
            const device = await db.query.devices.findFirst({ where: eq(schema.devices.tokenHash, tokenHash) });
            if (!device) { socket.destroy(); return; }

            wss.handleUpgrade(req, socket, head, (ws) => {
                relay.connectDevice(device.id, ws);
            });

        } else if (pathname?.startsWith('/ws/admin/')) {
            if (!token) { socket.destroy(); return; }
            const auth = verifyAdminToken(token);
            if (!auth) { socket.destroy(); return; }
            const deviceId = parseInt(pathname.split('/').pop() ?? '', 10);
            if (isNaN(deviceId)) { socket.destroy(); return; }

            wss.handleUpgrade(req, socket, head, (ws) => {
                relay.connectAdmin(deviceId, ws);
            });

        } else {
            socket.destroy();
        }
    });

    return httpServer;
}
