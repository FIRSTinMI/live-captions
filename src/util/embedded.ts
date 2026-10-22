import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';

// In the exe built by scripts/compile.ts, each embedded asset folder sits next to the entry
// module under its own folder name: build/public -> <embeddedRoot>/public and audify's
// build/Release -> <embeddedRoot>/Release. Under `bun run` nothing is embedded.
export const isCompiled = Bun.embeddedFiles.length > 0;
export const embeddedRoot = path.dirname(Bun.main);

// Copies an embedded folder to a real folder on disk, skipping files that are already
// identical (a running copy of the exe may hold them open).
export function writeEmbeddedFolder(name: string, dest: string) {
    const src = path.join(embeddedRoot, name);
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(src)) {
        const data = readFileSync(path.join(src, file));
        const out = path.join(dest, file);
        if (existsSync(out) && readFileSync(out).equals(data)) continue;
        writeFileSync(out, data);
    }
}

// express.static streams files with ranged read streams, which reset the connection for files
// inside the exe. This serves an embedded folder from memory instead.
export function embeddedStatic(name: string): RequestHandler {
    const root = path.join(embeddedRoot, name);
    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let rel: string;
        try { rel = decodeURIComponent(req.path); } catch { return next(); }
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.join(root, path.normalize(rel));
        if (!file.startsWith(root + path.sep)) return next();
        let data: Buffer;
        try { data = readFileSync(file); } catch { return next(); }
        res.type(path.extname(file)).send(data);
    };
}
