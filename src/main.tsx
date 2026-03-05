import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'

// Use locally bundled monaco-editor instead of CDN.
// CDN loading fails in Tauri desktop apps due to network restrictions.
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
