import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
  const base = env.VITE_BASE_PATH || (process.env.GITHUB_ACTIONS && repository ? `/${repository}/` : '/')

  return {
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'markdown-vendor': ['react-markdown', 'remark-math', 'rehype-katex', 'katex'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'icons-vendor': ['lucide-react'],
          },
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['app-icon.svg'],
        manifest: {
          name: '知行学伴',
          short_name: '知行学伴',
          description: '作业、错题、复习与个性化答疑工作台',
          lang: 'zh-CN',
          theme_color: '#0f766e',
          background_color: '#f7f7f4',
          display: 'standalone',
          start_url: '.',
          icons: [
            { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  }
})
