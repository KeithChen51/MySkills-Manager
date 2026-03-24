import "@fontsource/jetbrains-mono/500.css"
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'

function loadDeferredFonts() {
  void Promise.all([
    import("@fontsource/jetbrains-mono/600.css"),
    import("@fontsource/jetbrains-mono/700.css"),
  ]);
}

if (typeof window !== "undefined") {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof idle === "function") {
    idle(() => {
      loadDeferredFonts();
    });
  } else {
    window.setTimeout(() => {
      loadDeferredFonts();
    }, 1200);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
