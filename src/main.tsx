import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { PlatformProvider } from './context/PlatformContext'
import './styles.css'

const uiThemes = new Set(['clean', 'notebook', 'data'])
const requestedTheme = new URLSearchParams(window.location.search).get('theme')
const activeTheme = requestedTheme && uiThemes.has(requestedTheme)
  ? requestedTheme
  : 'data'
document.documentElement.dataset.uiTheme = activeTheme

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <PlatformProvider>
        <App />
      </PlatformProvider>
    </HashRouter>
  </StrictMode>,
)
