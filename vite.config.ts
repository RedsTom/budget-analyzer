import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

/**
 * Le déploiement peut être servi à la racine (domaine dédié) ou sous un
 * sous-chemin (GitHub Pages). `VITE_BASE` permet de fixer ce préfixe sans
 * toucher au code de l'application.
 */
const base = process.env.VITE_BASE ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Le service worker est enregistré par `virtual:pwa-register/react`.
      injectRegister: null,
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'app-icon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        id: base,
        name: 'Budget Analyzer',
        short_name: 'Budget',
        description:
          'Analyse budgétaire locale et chiffrée à partir de relevés bancaires CSV.',
        lang: 'fr',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Saisie manuelle',
            short_name: 'Saisie',
            url: `${base}#/manual`,
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Transactions',
            short_name: 'Transactions',
            url: `${base}#/transactions`,
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Assistant',
            short_name: 'Assistant',
            url: `${base}#/assistant`,
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        // L'IA est strictement en ligne : aucune requête ni réponse n'est
        // mise en cache par le service worker.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/generativelanguage\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
            method: 'POST',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
