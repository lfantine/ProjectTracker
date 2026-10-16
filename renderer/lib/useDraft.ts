import { useCallback, useEffect, useRef, useState } from 'react'

export type DraftState = 'idle' | 'saving' | 'error'

type Session<T> = {
  value: T
  dirty: boolean
  edit: number
  commit: (next: T, expectedRevision?: number) => Promise<boolean>
  pending: Promise<boolean> | null
  revision?: number
}

// Each edited entity owns a session. An old request can finish after navigation
// without clearing a new entity's draft or sending its text to the wrong id.
export function useDraft<T>(value: T, commit: (next: T, expectedRevision?: number) => Promise<boolean>, options: { delay?: number; resetKey?: unknown; revision?: number } = {}) {
  const delay = options.delay ?? 500
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<DraftState>('idle')
  const session = useRef<Session<T>>({ value, dirty: false, edit: 0, commit, pending: null, revision: options.revision })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const key = useRef(options.resetKey)

  const save = useCallback((current: Session<T>): Promise<boolean> => {
    if (current.pending) return current.pending
    if (!current.dirty) return Promise.resolve(true)
    const updateState = (next: DraftState) => {
      if (mounted.current && session.current === current) setState(next)
    }
    updateState('saving')
    current.pending = (async () => {
      while (current.dirty) {
        const edit = current.edit
        const target = current.value
        let ok = false
        try { ok = await current.commit(target, current.revision) } catch { /* keep the draft for retry */ }
        if (!ok) { updateState('error'); return false }
        if (current.revision !== undefined) current.revision++
        if (current.edit === edit) current.dirty = false
      }
      updateState('idle')
      return true
    })().finally(() => { current.pending = null })
    return current.pending
  }, [])

  useEffect(() => {
    if (!Object.is(key.current, options.resetKey)) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const previous = session.current
      // Commit with the callback captured for the previous entity.
      void save(previous)
      key.current = options.resetKey
      session.current = { value, dirty: false, edit: 0, commit, pending: null, revision: options.revision }
      setDraft(value)
      setState('idle')
    } else if (!session.current.dirty && !session.current.pending) {
      session.current.value = value
      setDraft(value)
    }
  }, [value, options.resetKey, commit, save])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    return save(session.current)
  }, [save])

  const change = useCallback((next: T) => {
    const current = session.current
    if (!current.dirty && !current.pending) { current.commit = commit; current.revision = options.revision }
    current.value = next
    current.dirty = true
    current.edit++
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void save(current) }, delay)
  }, [commit, delay, save, options.revision])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      void save(session.current)
    }
  }, [save])

  return { value: draft, change, flush, state }
}
