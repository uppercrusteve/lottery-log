import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  // 相对路径，Capacitor 装进 apk 后是 file:// 加载
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { port: 5173 },
  // root 提到了 ui，测试文件仍在仓库根的 tests/ 下
  test: {
    root: '.',
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
