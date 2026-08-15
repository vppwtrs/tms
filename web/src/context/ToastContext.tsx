import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'warning'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  leaving: boolean
}

interface ToastContextValue {
  push: (type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS: Record<ToastType, string> = { success: '✓', error: '✕', warning: '!' }

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number): void => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id))
        timers.current.delete(id)
      }, 200),
    )
  }, [])

  const push = useCallback(
    (type: ToastType, message: string): void => {
      const id = nextId++
      setToasts((list) => [...list.slice(-3), { id, type, message, leaving: false }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 3800),
      )
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-item toast-${t.type}${t.leaving ? ' toast-leave' : ''}`}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast-icon">{ICONS[t.type]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast ต้องใช้ภายใน ToastProvider')
  return ctx
}
