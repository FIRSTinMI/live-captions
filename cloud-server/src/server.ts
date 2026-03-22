import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createRouter } from './trpc/router';
import { createContext } from './trpc/context';

export function createServer() {
    const app = express();
    expressWs(app);

    app.use(cors());
    app.use(bodyParser.json());

    const router = createRouter();

    app.use('/trpc', createExpressMiddleware({
        router,
        createContext,
    }));

    // Serve admin panel static files
    const adminDir = path.join(__dirname, 'public', 'admin');
    app.use('/admin', express.static(adminDir));
    app.get('/admin/*', (_req, res) => {
        res.sendFile(path.join(adminDir, 'index.html'));
    });

    // Health check
    app.get('/health', (_req, res) => {
        res.json({ ok: true });
    });

    app.get('/', (_req, res) => {
        res.redirect('/admin');
    });

    return app;
}
