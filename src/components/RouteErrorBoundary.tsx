import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading (?:CSS )?chunk [^ ]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
]

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface RouteErrorBoundaryProps {
  children: ReactNode
  reload?: () => void
  storage?: SessionStore
}

interface RouteErrorBoundaryState {
  error: Error | null
  recoveringChunk: boolean
  resetKey: number
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

function errorText(value: unknown) {
  const error = asError(value)
  return `${error.name}: ${error.message}`
}

export function isChunkLoadError(value: unknown) {
  const text = errorText(value)
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

export function chunkReloadStorageKey(value: unknown) {
  const text = errorText(value)
  const resource = text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? text
  return `teaching-loop:chunk-reload:${encodeURIComponent(resource.slice(0, 240))}`
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, recoveringChunk: false, resetKey: 0 }

  static getDerivedStateFromError(value: unknown): Partial<RouteErrorBoundaryState> {
    return { error: asError(value), recoveringChunk: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面内容渲染失败', error, info)
    if (!isChunkLoadError(error)) return

    const storage = this.getStorage()
    if (!storage) return
    const key = chunkReloadStorageKey(error)
    try {
      if (storage.getItem(key)) return
      storage.setItem(key, new Date().toISOString())
      this.setState({ recoveringChunk: true }, () => {
        try {
          this.reloadPage()
        } catch {
          this.setState({ recoveringChunk: false })
        }
      })
    } catch {
      // If sessionStorage is unavailable, keep the recovery UI instead of risking a reload loop.
    }
  }

  private getStorage = (): SessionStore | undefined => {
    if (this.props.storage) return this.props.storage
    try {
      return window.sessionStorage
    } catch {
      return undefined
    }
  }

  private reloadPage = () => {
    if (this.props.reload) this.props.reload()
    else window.location.reload()
  }

  private retryRender = () => {
    this.setState((previous) => ({ error: null, recoveringChunk: false, resetKey: previous.resetKey + 1 }))
  }

  private refreshPage = () => {
    const { error } = this.state
    if (error && isChunkLoadError(error)) {
      try {
        this.getStorage()?.removeItem(chunkReloadStorageKey(error))
      } catch {
        // A manual refresh is still useful when storage is unavailable.
      }
    }
    this.reloadPage()
  }

  render() {
    const { error, recoveringChunk, resetKey } = this.state
    if (!error) return <Fragment key={resetKey}>{this.props.children}</Fragment>

    if (recoveringChunk) {
      return <div className="route-error" role="status" aria-live="polite"><RefreshCw className="spin" size={26} /><strong>页面资源已更新，正在重新载入</strong></div>
    }

    const chunkFailure = isChunkLoadError(error)
    return (
      <section className="route-error" role="alert">
        <span className="route-error-mark"><AlertTriangle size={24} /></span>
        <h2>{chunkFailure ? '页面资源加载失败' : '这个页面暂时无法显示'}</h2>
        <p>{chunkFailure ? '可能是网站刚刚更新，重新加载后即可继续。' : '已保留当前登录状态，可以重试页面或重新加载。'}</p>
        <div className="route-error-actions">
          {!chunkFailure && <button type="button" className="button" onClick={this.retryRender}><RotateCcw size={16} />重试页面</button>}
          <button type="button" className="button primary" onClick={this.refreshPage}><RefreshCw size={16} />重新加载</button>
        </div>
      </section>
    )
  }
}
