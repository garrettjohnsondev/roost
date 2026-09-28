import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': `http://localhost:${process.env.ROOST_API_PORT ?? 8790}`,
      '/ws': { target: `ws://localhost:${process.env.ROOST_API_PORT ?? 8790}`, ws: true },
    },
  },
});
