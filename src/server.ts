import path from 'path';
import express, { Application } from 'express';
import { WebSocketServer } from 'ws';
import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import bodyParser from 'body-parser';
import color from 'colorts';
import { RtAudio } from 'audify';
import { ConfigManager } from './util/configManager';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { AppRouter } from './trpc/router';
import { createContext } from './trpc/context';

export class Server {
    private config: ConfigManager;
    private app: Application;
    private httpServer: HttpServer<typeof IncomingMessage, typeof ServerResponse>;
    private appRouter: AppRouter;

    constructor(config: ConfigManager, rtAudio: RtAudio, appRouter: AppRouter) {
        this.config = config;
        this.appRouter = appRouter;

        this.app = express();

        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use(bodyParser.json());

        this.app.use('/trpc', createExpressMiddleware({
            router: this.appRouter,
            createContext,
        }));

        this.httpServer = createServer(this.app);

        const wss = new WebSocketServer({ server: this.httpServer, path: '/trpc' });
        applyWSSHandler({ wss, router: this.appRouter, createContext });
    }

    start() {
        this.httpServer.listen(this.config.server.port, () => {
            console.log(`Open captions ${color(`http://127.0.0.1:${this.config.server.port}`).bold.underline.blue}`);
            console.log(`Open settings ${color(`http://127.0.0.1:${this.config.server.port}/settings.html`).bold.underline.blue}`);
        });
    }

    stop() {
        this.httpServer.close();
    }
}
