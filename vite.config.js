// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills'; // Correct plugin import
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const phalaAppUrl = String(env.VITE_PHALA_MINIMAL_APP_URL || '').trim().replace(/\/+$/, '');

    const proxy = {
        '/api': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
        },
    };

    if (phalaAppUrl) {
        proxy['/__phala'] = {
            target: phalaAppUrl,
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/__phala/, ''),
        };
    }

    return {
        server: {
            proxy,
        },
        plugins: [
            react(),
            tailwindcss(),
            nodePolyfills({ // This is the correct plugin to use
                globals: true,
                buffer: true,
                process: true,
            }),
        ],
        build: {
            sourcemap: false, // Set this to false
        }
    };
});
