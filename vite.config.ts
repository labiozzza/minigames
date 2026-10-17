import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Test hooks (window.__PLUMBER__, solve shortcuts) are compiled in ONLY for
// dev or explicit test builds (VITE_TEST_HOOKS=1). In release builds the flag
// is the literal `false`, so esbuild removes all hook code entirely.
const testHooks = process.env.VITE_TEST_HOOKS === '1';

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __TEST_HOOKS__: JSON.stringify(testHooks || command === 'serve'),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'script',
      strategies: 'generateSW',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'MiniGames',
        short_name: 'MiniGames',
        description: 'Бесплатная офлайн-платформа мини-игр. Игра №1: Переливашки (Water Sort).',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        icons: [
          { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: './icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  worker: { format: 'es' },
}));
