import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 桌面 + H5（鸿蒙 Web 壳 / PWA）多目标
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 相对路径：兼容 Tauri 桌面壳与鸿蒙 Web 组件（rawfile/file://）加载
  base: './',
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: 'es2022',
    sourcemap: false
  }
});
