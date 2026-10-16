import { useEffect, useId, useState } from 'react'

export function ButtonHints() {
  const id = useId()
  const [hint, setHint] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null)
  useEffect(() => {
    let target: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let nativeTitle: string | null = null
    let description: string | null = null
    function hide() {
      clearTimeout(timer)
      if (target) {
        if (nativeTitle !== null) target.setAttribute('title', nativeTitle)
        if (description === null) target.removeAttribute('aria-describedby')
        else target.setAttribute('aria-describedby', description)
      }
      target = null
      setHint(null)
    }
    function show(event: Event) {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [role="button"], a[title]') : null
      if (element === target) return
      hide()
      if (!element) return
      const text = element.getAttribute('title') || element.getAttribute('aria-label') || element.textContent?.trim()
      if (!text) return
      target = element
      nativeTitle = element.getAttribute('title')
      description = element.getAttribute('aria-describedby')
      element.removeAttribute('title')
      timer = setTimeout(() => {
        if (!element.isConnected) { hide(); return }
        const rect = element.getBoundingClientRect()
        element.setAttribute('aria-describedby', [description, id].filter(Boolean).join(' '))
        const above = rect.bottom + 80 > window.innerHeight
        setHint({ text, x: Math.max(148, Math.min(window.innerWidth - 148, rect.left + rect.width / 2)), y: above ? rect.top - 8 : rect.bottom + 8, above })
      }, element.dataset.hintDelay === '900' ? 900 : 2200)
    }
    function leave(event: Event) {
      const related = (event as MouseEvent | FocusEvent).relatedTarget
      if (target && related instanceof Node && target.contains(related)) return
      hide()
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') hide() }
    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('mouseout', leave)
    document.addEventListener('focusout', leave)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', hide)
    return () => {
      hide()
      document.removeEventListener('mouseover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('mouseout', leave)
      document.removeEventListener('focusout', leave)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', hide)
    }
  }, [id])
  return hint ? (
    <div id={id} role="tooltip" className="pointer-events-none fixed z-[1000] max-w-72 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-lg" style={{ left: hint.x, top: hint.y, transform: `translate(-50%, ${hint.above ? '-100%' : '0'})` }}>{hint.text}</div>
  ) : null
}
