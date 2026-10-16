import { afterEach, expect, it, vi } from 'vitest'
import { calendarHelp } from '../packages/builtin-week/src/help'
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })
it('shows a real calendar tooltip after 900 ms and dismisses on Escape/leave', () => {
  vi.useFakeTimers()
  const help = calendarHelp(); document.body.append(help)
  help.dispatchEvent(new MouseEvent('mouseenter'))
  vi.advanceTimersByTime(899); expect(document.querySelector('[role=tooltip]')).toBeNull()
  vi.advanceTimersByTime(1); expect(document.querySelector('[role=tooltip]')).toHaveTextContent('Glisser')
  help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(document.querySelector('[role=tooltip]')).toBeNull()
  help.focus(); vi.advanceTimersByTime(900); expect(help).toHaveAttribute('aria-describedby')
  help.dispatchEvent(new MouseEvent('mouseleave')); expect(help).not.toHaveAttribute('aria-describedby')
})
