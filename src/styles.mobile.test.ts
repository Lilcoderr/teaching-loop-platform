import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync('src/styles.css', 'utf8')

describe('mobile fixed-navigation spacing', () => {
  it('keeps the tutor workspace above the fixed mobile navigation', () => {
    expect(styles).not.toContain('min-width: 320px')
    expect(styles).toContain('.tutor-page { height: calc(100dvh - 142px - env(safe-area-inset-bottom)); }')
    expect(styles).toContain('.hint-levels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; }')
    expect(styles).toContain('.message-panel { height: calc(100dvh - 192px - env(safe-area-inset-bottom)); }')
    expect(styles).toContain('height: calc(64px + env(safe-area-inset-bottom));')
  })
})
