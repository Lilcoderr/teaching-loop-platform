import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('blocks remote and dangerous image sources while allowing local assets', () => {
    const { container } = render(
      <MarkdownContent>
        {'![remote](https://tracking.example/pixel.png) ![danger](data:image/svg+xml,bad) ![local](/assets/chart.png)'}
      </MarkdownContent>,
    )

    expect(screen.queryByRole('img', { name: 'remote' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'danger' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'local' })).toHaveAttribute('src', '/assets/chart.png')
    expect(screen.getByRole('img', { name: 'local' })).toHaveAttribute('loading', 'lazy')
    expect(container.innerHTML).not.toContain('tracking.example')
    expect(container.innerHTML).not.toContain('data:image')
  })

  it('adds safe external-link attributes and removes dangerous protocols', () => {
    render(
      <MarkdownContent>
        {'[资料](https://example.test/lesson) [内部](/resources) [危险](javascript:alert(1))'}
      </MarkdownContent>,
    )

    expect(screen.getByRole('link', { name: '资料' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '资料' })).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(screen.getByRole('link', { name: '资料' })).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('link', { name: '内部' })).not.toHaveAttribute('target')
    expect(screen.getByText('危险').closest('a')).toBeNull()
  })
})
