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
          manualChunks(id) {
            const moduleId = id.replaceAll('\\', '/')
            if (moduleId.includes('/node_modules/react/')
              || moduleId.includes('/node_modules/react-dom/')
              || moduleId.includes('/node_modules/react-router/')
              || moduleId.includes('/node_modules/react-router-dom/')
              || moduleId.includes('/node_modules/scheduler/')) return 'react-vendor'
            if (moduleId.includes('/node_modules/@supabase/')) return 'supabase-vendor'
            if (moduleId.includes('/node_modules/lucide-react/')) return 'icons-vendor'
            if (moduleId.includes('/node_modules/react-markdown/')
              || moduleId.includes('/node_modules/remark-')
              || moduleId.includes('/node_modules/rehype-')
              || moduleId.includes('/node_modules/katex/')
              || moduleId.includes('/node_modules/unified/')
              || moduleId.includes('/node_modules/micromark')
              || moduleId.includes('/node_modules/mdast-')
              || moduleId.includes('/node_modules/hast-')
              || moduleId.includes('/node_modules/unist-')
              || moduleId.includes('/node_modules/vfile')) return 'markdown-vendor'
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
      testTimeout: 15_000,
    },
  }
})
