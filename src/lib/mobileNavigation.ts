export function revealActiveMobileNav(nav: HTMLElement, isNarrowViewport: boolean) {
  if (!isNarrowViewport) return false
  const active = nav.querySelector<HTMLElement>('a.active')
  if (!active || typeof active.scrollIntoView !== 'function') return false

  const navRect = nav.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  const outsideViewport = activeRect.left < navRect.left || activeRect.right > navRect.right
  if (!outsideViewport) return false

  active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  return true
}
