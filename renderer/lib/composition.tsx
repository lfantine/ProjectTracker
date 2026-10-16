import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { CompositionCommand, CompositionSnapshot, CompositionRequest } from '../../shared/composition'

interface CompositionState {
  snapshot: CompositionSnapshot | null
  error: string | null
  pending: boolean
  refresh(): Promise<void>
  mutate(command: CompositionCommand): Promise<{ id?: string } | null>
}
const Context = createContext<CompositionState>({ snapshot: null, error: null, pending: false, refresh: async () => {}, mutate: async () => null })
export function CompositionProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<CompositionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const uncertain = useRef<CompositionRequest | null>(null)
  const latest = useRef<CompositionSnapshot | null>(null), alive = useRef(false), busy = useRef(false), sequence = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try {
      const result = await window.api?.composition?.snapshot()
      if (!alive.current || request !== sequence.current) return
      if (!result?.ok) { setError(result && !result.ok ? result.error.message : 'Composition indisponible.'); return }
      latest.current = result.value; setSnapshot(result.value)
    } catch { if (alive.current) setError('Composition indisponible. Réessayez sans fermer vos vues.') }
  }, [])
  useEffect(() => {
    alive.current = true; void refresh()
    const stop = window.api?.core?.onChanged(() => { void refresh() })
    const stopPackages = window.api?.packages?.onChanged(() => { void refresh() })
    return () => { alive.current = false; sequence.current++; stop?.(); stopPackages?.() }
  }, [refresh])
  const mutate = useCallback(async (command: CompositionCommand) => {
    if (!latest.current || busy.current) return null
    busy.current = true; setPending(true); setError(null)
    try {
      const request = uncertain.current && JSON.stringify(uncertain.current.command) === JSON.stringify(command) ? uncertain.current : { command, expectedRevision: latest.current.revision, operationId: crypto.randomUUID() }
      uncertain.current = request
      const result = await window.api.composition.command(request)
      uncertain.current = null
      if (!result.ok) { if (alive.current) setError(result.error.message); await refresh(); return null }
      await refresh()
      return result.value
    } catch { if (alive.current) setError('Enregistrement non confirmé. Rechargez avant de réessayer.'); await refresh(); return null }
    finally { busy.current = false; if (alive.current) setPending(false) }
  }, [refresh])
  return <Context.Provider value={{ snapshot, error, pending, refresh, mutate }}>{children}</Context.Provider>
}
export const useComposition = () => useContext(Context)
