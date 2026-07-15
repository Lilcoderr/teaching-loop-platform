import { describe, expect, it, vi } from 'vitest'
import { revealActiveMobileNav } from './mobileNavigation'

function rect(left: number, right: number): DOMRect {
  return { left, right, top: 0, bottom: 64, width: right - left, height: 64, x: left, y: 0, toJSON: () => ({}) }
}

function navigation(activeRect: DOMRect) {
  const nav = document.createElement('nav')
  const active = document.createElement('a')
  active.className = 'active'
  active.scrollIntoView = vi.fn()
  nav.append(active)
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rect(0, 390))
  vi.spyOn(active, 'getBoundingClientRect').mockReturnValue(activeRect)
  return { nav, active }
}

describe('revealActiveMobileNav', () => {
  it('does not scroll on a desktop viewport', () => {
    const { nav, active } = navigation(rect(420, 496))
    expect(revealActiveMobileNav(nav, false)).toBe(false)
    expect(active.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when the active item is already visible', () => {
    const { nav, active } = navigation(rect(120, 196))
    expect(revealActiveMobileNav(nav, true)).toBe(false)
    expect(active.scrollIntoView).not.toHaveBeenCalled()
  })

  it('reveals an active item outside the narrow navigation viewport', () => {
    const { nav, active } = navigation(rect(420, 496))
    expect(revealActiveMobileNav(nav, true)).toBe(true)
    expect(active.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  })
})
