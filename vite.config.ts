import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' -> GitHub Pages / Cloudflare Pages / Vercel のどこに置いても
// サブディレクトリ配信で壊れないようにする（相対パス出力）。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2019', // iPadOS Safari 14+ を想定
    outDir: 'dist',
  },
  server: {
    host: true, // 同一LANのiPadから http://<Macのip>:5173 で開けるようにする
    port: 5173,
  },
});
