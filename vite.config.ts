/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/dashboard',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  test: {
    include: ['../**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['../../node_modules/**', '../../dist/**', '../../research/**'],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
