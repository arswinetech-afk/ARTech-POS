import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const stub = fileURLToPath(new URL('./src/lib/empty-module.ts', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    // jsPDF optionally imports these for HTML/SVG rendering; we only draw vectors + text.
    alias: { canvg: stub, html2canvas: stub, dompurify: stub },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'ARTech POS',
        short_name: 'ARTech POS',
        description: 'Offline-first Point of Sale for sari-sari stores and small businesses',
        theme_color: '#0f7a3f',
        background_color: '#f4f7f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell so the POS opens with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Never let the service worker touch Supabase requests - IndexedDB is our offline store.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Allow the sandbox preview host and any Cloudflare tunnel / pages preview host.
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'dexie', 'dexie-react-hooks', 'date-fns'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
          scanner: ['@zxing/browser', '@zxing/library'],
          pdf: ['jspdf'],
        },
      },
    },
  },
})
