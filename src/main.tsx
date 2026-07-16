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

const PWA_UPDATE_AVAILABLE_EVENT = 'teaching-loop:pwa-update-available'

type PwaUpdateAvailableDetail = {
  applyUpdate: () => Promise<void>
}

function scheduleServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    const updateServiceWorker = registerSW({
      immediate: false,
      onNeedRefresh: () => {
        const detail: PwaUpdateAvailableDetail = {
          applyUpdate: () => updateServiceWorker(true),
        }
        window.dispatchEvent(new CustomEvent<PwaUpdateAvailableDetail>(PWA_UPDATE_AVAILABLE_EVENT, { detail }))
      },
    })
  }

  const scheduleWhenIdle = () => {
    const idleWindow = window as Window & { requestIdleCallback?: typeof window.requestIdleCallback }
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(register, { timeout: 4_000 })
      return
    }
    window.setTimeout(register, 1_500)
  }

  if (document.readyState === 'complete') scheduleWhenIdle()
  else window.addEventListener('load', scheduleWhenIdle, { once: true })
}

scheduleServiceWorkerRegistration()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <PlatformProvider>
        <App />
      </PlatformProvider>
    </HashRouter>
  </StrictMode>,
)
