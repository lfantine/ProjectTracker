import { useEffect, useState } from 'react'

/** Local clock, refreshed after waking up or returning to the app. */
export function useLocalNow() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const refresh = () => setNow(new Date())
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return now
}
