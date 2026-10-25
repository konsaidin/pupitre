import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // относительные пути к ассетам: сборка работает и с file:// (десктоп-обёртка)
  base: './',
  // DSP-ядро тянется как обычный ассет (data-URI через ?inline),
  // а не через встроенную wasm?init-магию Vite
  assetsInclude: ['**/*.wasm', '**/*.sf3'],
  plugins: [react()],
  // воркер разбора гитарного раздела (?worker&inline) тянет alphaTab с import.meta.url — нужен ES-формат
  worker: { format: 'es' },
  // зависимости гитарного раздела Vite иначе находит на лету и перезагружает открытую страницу (dev)
  optimizeDeps: { include: ['@coderline/alphatab', 'fflate', 'idb'] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
