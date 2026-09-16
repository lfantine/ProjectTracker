import React, { createContext, useCallback, useContext, useState } from 'react'

type ToastTone = 'default' | 'success' | 'danger'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE_CLASSES: Record<ToastTone, string> = {
  default: 'bg-surface border-border text-text',
  success: 'bg-success-soft border-success text-success',
  danger: 'bg-danger-soft border-danger text-danger',
}

let nextToastId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, tone: ToastTone = 'default') => {
    const id = nextToastId++
    setToasts((prev) => prev.concat([{ id, message, tone }]))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3200)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-xs px-4 py-2.5 rounded-lg border shadow-lg text-[13px] font-semibold ${TONE_CLASSES[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
