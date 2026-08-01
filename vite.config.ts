import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { version } from './package.json';

export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(version),
    },
    root: 'src/frontend',
    build: {
        outDir: resolve(__dirname, 'build/public'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'src/frontend/index.html'),
                settings: resolve(__dirname, 'src/frontend/settings.html'),
            },
        },
    },
    server: {
        proxy: {
            '/trpc': { target: 'http://localhost:3000', ws: true },
        },
    },
});
