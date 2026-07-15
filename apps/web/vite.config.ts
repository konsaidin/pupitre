import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // относительные пути к ассетам: сборка работает и с file:// (десктоп-обёртка)
  base: './',
  // DSP-ядро тянется как обычный ассет (data-URI через ?inline),
  // а не через встроенную wasm?init-магию Vite
  assetsInclude: ['**/*.wasm'],
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
