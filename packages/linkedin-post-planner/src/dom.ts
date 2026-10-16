export function text<K extends keyof HTMLElementTagNameMap>(tag: K, content: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node
}
/** Disables itself while its async action runs; errors are reported by `onError`. */
export function button(label: string, action: () => unknown, options: { className?: string; ariaLabel?: string; onError?: (error: unknown) => void } = {}): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label
  if (options.className) node.className = options.className
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel)
  node.onclick = event => {
    event.stopPropagation()
    const result = action()
    if (result instanceof Promise) {
      node.disabled = true
      void result.catch(error => options.onError?.(error)).finally(() => { node.disabled = false })
    }
  }
  return node
}
export function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(label: string, control: T, className?: string): HTMLLabelElement {
  const wrapper = document.createElement('label'); if (className) wrapper.className = className
  wrapper.append(text('span', label), control); return wrapper
}
export function input(name: string, value = '', type = 'text'): HTMLInputElement {
  const node = document.createElement('input'); node.name = name; node.type = type; node.value = value; return node
}
export function select(name: string, options: readonly { id: string; label: string }[], value: string): HTMLSelectElement {
  const node = document.createElement('select'); node.name = name
  for (const option of options) { const item = document.createElement('option'); item.value = option.id; item.textContent = option.label; node.append(item) }
  node.value = value; return node
}
export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', options)
}
