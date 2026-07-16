import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

const markdownBaseUrl = new URL('https://markdown.local/')
const allowedExternalLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function isLocalMarkdownUrl(value: string) {
  try {
    return new URL(value, markdownBaseUrl).origin === markdownBaseUrl.origin
  } catch {
    return false
  }
}

function transformMarkdownUrl(url: string, key: string) {
  const value = url.trim()
  if (!value) return ''

  if (key === 'src') return isLocalMarkdownUrl(value) ? value : ''
  if (isLocalMarkdownUrl(value)) return value

  try {
    const parsed = new URL(value)
    return allowedExternalLinkProtocols.has(parsed.protocol) ? value : ''
  } catch {
    return ''
  }
}

function isExternalWebLink(href: string | undefined) {
  return href ? /^https?:\/\//i.test(href) : false
}

export function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={transformMarkdownUrl}
        components={{
          a: ({ href, children: linkChildren, node, ...props }) => {
            void node
            if (!href) return <span>{linkChildren}</span>
            return isExternalWebLink(href)
              ? <a {...props} href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">{linkChildren}</a>
              : <a {...props} href={href}>{linkChildren}</a>
          },
          img: ({ src, alt, node, ...props }) => {
            void node
            return src
              ? <img {...props} src={src} alt={alt ?? ''} loading="lazy" decoding="async" />
              : null
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
