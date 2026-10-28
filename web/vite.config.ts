import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: /api/* is proxied to the Worker (`wrangler dev`, port 8787).
// Prod: the Worker serves web/dist via the ASSETS binding with SPA fallback.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
