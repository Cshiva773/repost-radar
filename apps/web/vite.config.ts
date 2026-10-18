import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApiPlugin } from './dev/mockApi';

const API_TARGET = process.env.API_URL ?? 'http://localhost:8080';

// `pnpm dev` proxies /api to a running API; `pnpm dev:mock` answers /api from in-memory fixtures instead
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'mock' ? [mockApiPlugin()] : [])],
  server: {
    port: 3000,
    proxy: mode === 'mock' ? undefined : {
      '/api': { target: API_TARGET, rewrite: (requestPath) => requestPath.replace(/^\/api/, '') },
    },
  },
}));
