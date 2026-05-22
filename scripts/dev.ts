import { spawn, ChildProcess } from 'child_process';

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        if (!child.killed) child.kill();
    }
    setTimeout(() => process.exit(code), 200);
}

function launch(label: string, command: string, args: string[]) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    children.push(child);
    child.on('exit', code => {
        console.log(`[dev] ${label} exited with code ${code}`);
        shutdown(code ?? 0);
    });
    child.on('error', err => {
        console.error(`[dev] ${label} failed to start:`, err.message);
        shutdown(1);
    });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

launch('backend', 'bun', ['run', './src/index.ts', '--skip-update-check']);
launch('frontend', 'vite', []);

console.log('[dev] backend → http://localhost:3000  ·  frontend → http://localhost:5173 (Ctrl-C to stop both)');
