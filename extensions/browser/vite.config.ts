import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Multi-entry build: the service worker, content script, popup, and
// options page each need their own bundle. Vite's `build.rollupOptions.input`
// lets us list them; outputs are flat in dist/ matching what
// public/manifest.json points at.

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/autofill': resolve(__dirname, 'src/content/autofill.ts'),
        // HTML inputs at the project root so vite emits them flat as
        // dist/popup.html / dist/options.html — what manifest.json points at.
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
