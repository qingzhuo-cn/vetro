import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 桌面 + Web/PWA 双目标
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: 'es2022',
    sourcemap: false
  }
});
