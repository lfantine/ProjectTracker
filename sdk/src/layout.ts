// Presentation only: no SDK/native capability and no business data. Each side
// still checks the exact frame window/origin; sizes and viewport are bounded.
export const FRAME_SIZE = 'pt-runtime/content-size'
export const FRAME_VIEWPORT = 'pt-runtime/flow-viewport'
export const MAX_FRAME_HEIGHT = 100_000

export function observeContentSize(hostOrigin: string): () => void {
  let pending = 0, previous = -1
  const measure = () => {
    pending = 0
    if (!document.body) return
    const style = getComputedStyle(document.body)
    const height = Math.min(MAX_FRAME_HEIGHT, Math.max(1, Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height) + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0))))
    if (height !== previous) { previous = height; window.parent.postMessage({ type: FRAME_SIZE, height }, hostOrigin) }
  }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(measure) }
  const viewport = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== hostOrigin || event.ports.length) return
    const data = event.data
    if (!data || Object.keys(data).length !== 3 || data.type !== FRAME_VIEWPORT || !Number.isFinite(data.top) || !Number.isFinite(data.height) || data.top < 0 || data.height < 0 || data.top > MAX_FRAME_HEIGHT || data.height > MAX_FRAME_HEIGHT) return
    document.documentElement.dataset.amberLayout = 'flow'
    document.documentElement.style.setProperty('--amber-viewport-top', `${data.top}px`)
    document.documentElement.style.setProperty('--amber-viewport-height', `${data.height}px`)
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(document.body)
  const mutations = new MutationObserver(schedule)
  mutations.observe(document.body, { childList: true, subtree: true, characterData: true })
  window.addEventListener('message', viewport)
  window.addEventListener('resize', schedule)
  schedule()
  const stop = () => { cancelAnimationFrame(pending); observer.disconnect(); mutations.disconnect(); window.removeEventListener('message', viewport); window.removeEventListener('resize', schedule); window.removeEventListener('pagehide', stop) }
  window.addEventListener('pagehide', stop, { once: true })
  return stop
}

/** Smallest height letting a frame reach the bottom of the visible page area,
 * below its own top and above the frames placed after it (slot features). */
export function fillHeight(frame: HTMLIFrameElement, scroller: HTMLElement): number {
  const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  let after = 0
  for (let sibling = frame.nextElementSibling; sibling; sibling = sibling.nextElementSibling) after += sibling.getBoundingClientRect().height
  const padding = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
  return Math.max(0, Math.min(MAX_FRAME_HEIGHT, Math.floor(scroller.clientHeight - offset - padding - after)))
}

// `fill`: full pages (majors) are at least as tall as the visible area, so
// dialogs/popovers inside the frame are never clipped by a short content.
export function fitContribution(frame: HTMLIFrameElement, origin: string, options: { fill?: boolean } = {}): () => void {
  let pending = 0
  const notifyViewport = () => {
    pending = 0
    if (!frame.isConnected) return
    const page = frame.closest<HTMLElement>('[data-page-scroll]')
    if (options.fill && page) { const min = `${fillHeight(frame, page)}px`; if (frame.style.minHeight !== min) frame.style.minHeight = min }
    const rect = frame.getBoundingClientRect(), scroller = page?.getBoundingClientRect()
    const top = Math.max(0, Math.min(rect.height, (scroller?.top ?? 0) - rect.top))
    const bottom = Math.min(rect.height, (scroller?.bottom ?? window.innerHeight) - rect.top)
    frame.contentWindow?.postMessage({ type: FRAME_VIEWPORT, top: Math.round(top), height: Math.max(0, Math.round(bottom - top)) }, origin)
  }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(notifyViewport) }
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || event.ports.length) return
    const data = event.data
    if (!data || Object.keys(data).length !== 2 || data.type !== FRAME_SIZE || !Number.isInteger(data.height) || data.height < 1 || data.height > MAX_FRAME_HEIGHT) return
    if (frame.style.height !== `${data.height}px`) frame.style.height = `${data.height}px`
    schedule()
  }
  window.addEventListener('message', receive)
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  // The page area (sidebar, panels) and the frames below (container) can
  // change size without a window resize. Converges: the container only grows
  // by what the min-height then gives back.
  const resized = options.fill && typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  if (resized) requestAnimationFrame(() => { const page = frame.closest<HTMLElement>('[data-page-scroll]'); if (page) resized.observe(page); if (frame.parentElement) resized.observe(frame.parentElement) })
  schedule()
  return () => { cancelAnimationFrame(pending); resized?.disconnect(); window.removeEventListener('message', receive); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
}
