import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The production build is ONE self-contained HTML file (three.js, fonts, data, Sionna maps
// all inlined) → it works on GitHub Pages and offline by double-clicking docs/index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  resolve: { alias: { '@data': here('../data') } },
  server: { fs: { allow: [here('..')] } },
  build: {
    outDir: here('../docs'),
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 6000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
