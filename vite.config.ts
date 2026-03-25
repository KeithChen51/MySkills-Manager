import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          if (id.includes('/node_modules/@monaco-editor/')) {
            return 'monaco-react'
          }
          if (id.includes('/node_modules/monaco-editor/')) {
            if (id.includes('/vs/basic-languages/')) {
              return 'monaco-basic-languages'
            }
            if (id.includes('/vs/editor/contrib/')) {
              return 'monaco-editor-contrib'
            }
            if (id.includes('/vs/editor/browser/')) {
              return 'monaco-editor-browser'
            }
            if (id.includes('/vs/editor/common/')) {
              return 'monaco-editor-common'
            }
            if (id.includes('/vs/editor/')) {
              return 'monaco-editor-core'
            }
            if (id.includes('/vs/language/')) {
              return 'monaco-language'
            }
            if (id.includes('/vs/platform/')) {
              return 'monaco-platform'
            }
            if (id.includes('/vs/base/common/')) {
              return 'monaco-base-common'
            }
            if (id.includes('/vs/base/browser/')) {
              return 'monaco-base-browser'
            }
            if (id.includes('/vs/base/worker/')) {
              return 'monaco-base-worker'
            }
            if (id.includes('/vs/base/')) {
              return 'monaco-base-core'
            }
            return 'monaco-misc'
          }
          if (id.includes('@tauri-apps')) {
            return 'tauri-vendor'
          }
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
})
