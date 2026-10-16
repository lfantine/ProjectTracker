export function calendarHelp(): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'help-button'; button.textContent = '?'; button.setAttribute('aria-label', 'Aide du calendrier')
  let timer: ReturnType<typeof setTimeout> | undefined
  const tooltip = document.createElement('span'); tooltip.id = 'calendar-help-tooltip'; tooltip.className = 'help-tooltip'; tooltip.setAttribute('role', 'tooltip')
  tooltip.textContent = 'Glisser pour créer ou déplacer · Double-clic ou Espace pour modifier · Poignée inférieure pour la durée · Suppr pour retirer · ⌘/Ctrl C et V pour copier/coller'
  const hide = () => { clearTimeout(timer); tooltip.remove(); button.removeAttribute('aria-describedby') }
  const show = () => { hide(); timer = setTimeout(() => { if (button.isConnected) { button.append(tooltip); button.setAttribute('aria-describedby', tooltip.id) } }, 900) }
  button.onmouseenter = show; button.onmouseleave = hide; button.onfocus = show; button.onblur = hide
  button.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); hide() } }
  button.onclick = () => { hide(); button.append(tooltip); button.setAttribute('aria-describedby', tooltip.id) }
  return button
}
