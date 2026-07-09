import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // относительные пути к ассетам: сборка работает и с file:// (десктоп-обёртка)
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
