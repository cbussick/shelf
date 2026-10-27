import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/unplugin';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    stylex.vite({ useCSSLayers: true }),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['assets/favicon.svg', 'assets/*.ttf', 'icons/apple-touch-icon.png', 'THIRD_PARTY_NOTICES.txt'],
      manifest: {
        name: 'Shelf', short_name: 'Shelf', description: 'A private place for little notes.',
        start_url: '/', scope: '/', display: 'standalone',
        share_target: {
          action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
          params: { files: [{ name: 'images', accept: ['image/jpeg', '.jpg', '.jpeg', 'image/png', '.png', 'image/webp', '.webp', 'image/gif', '.gif'] }] },
        },
        background_color: '#f7f8fa', theme_color: '#263630',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: { port: 4273, host: '0.0.0.0', proxy: { '/api': 'http://127.0.0.1:3000', '/healthz': 'http://127.0.0.1:3000' } },
});
