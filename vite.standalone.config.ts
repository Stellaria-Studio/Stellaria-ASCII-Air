import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'standalone',
  base: './',
  publicDir: false,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../release/ascii-sky-webapp',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
