// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills'; // Correct plugin import
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    server: {
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8787',
                changeOrigin: true,
            },
        },
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
});