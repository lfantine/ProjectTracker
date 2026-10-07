import React, { useEffect, useId, useRef } from 'react'
import type { StatusTone } from '../lib/constants'
import { XIcon } from './icons'

export function Card({
  className = '',
  onClick,
  children,
}: {
  className?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5 ${
        onClick ? 'cursor-pointer hover:bg-surface-hover transition-colors' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface2 text-text-faint',
}

export function StatusPill({
  label,
  tone,
  onClick,
  className = '',
}: {
  label: string
  tone: StatusTone
  onClick?: (e: React.MouseEvent) => void
  className?: string
}) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={`text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${
        onClick ? 'cursor-pointer' : ''
      } ${TONE_CLASSES[tone]} ${className}`}
    >
      {label}
    </Tag>
  )
}

export function Chip({
  label,
  active,
  onClick,
  className = '',
}: {
  label: string
  active?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-accent-soft-text'
          : 'border-border bg-transparent text-text hover:bg-surface-hover'
      } ${className}`}
    >
      {label}
    </button>
  )
}

export function TagChip({ label }: { label: string }) {
  return (
    <span className="text-[10.5px] font-semibold bg-surface2 text-text-muted px-1.5 py-0.5 rounded">
      {label}
    </span>
  )
}

export function PrimaryButton({
  onClick,
  children,
  type = 'button',
  className = '',
  disabled,
}: {
  onClick?: () => void
  children: React.ReactNode
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`border-none bg-accent text-accent-text font-bold text-[13.5px] px-4 py-2.5 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-105 transition ${className}`}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  onClick,
  children,
  className = '',
  disabled,
}: {
  onClick?: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`border border-border bg-transparent text-text-muted font-semibold text-[13.5px] px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-hover transition ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  onClick,
  children,
  className = '',
  title,
}: {
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 border-none bg-transparent text-text-faint text-[12.5px] font-semibold px-2 py-1 rounded-md cursor-pointer hover:bg-surface-hover hover:text-text transition ${className}`}
    >
      {children}
    </button>
  )
}

export function IconButton({
  onClick,
  children,
  className = '',
  title,
}: {
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex-shrink-0 border border-border bg-surface2 text-text-muted rounded-lg flex items-center justify-center cursor-pointer hover:bg-surface-hover transition ${className}`}
    >
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return (
    <input
      {...rest}
      className={`font-sans text-sm px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-faint outline-none focus:border-accent transition ${className}`}
    />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return (
    <textarea
      {...rest}
      className={`font-sans text-sm px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-faint outline-none focus:border-accent transition resize-y ${className}`}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select
      {...rest}
      className={`font-sans text-sm px-3 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-accent transition ${className}`}
    >
      {children}
    </select>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  center = false,
  compact = false,
  allowProjectSwitch = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
  center?: boolean
  compact?: boolean
  allowProjectSwitch?: boolean
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key === 'Tab') {
        const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus()
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open])
  if (!open) return null
  return (
    <div
      className={`fixed inset-0 bg-overlay flex justify-center z-50 ${
        center ? 'items-center p-6' : 'items-start pt-[10vh]'
      }`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog" aria-modal="true" data-allow-project-switch={allowProjectSwitch || undefined} aria-labelledby={titleId} tabIndex={-1}
        style={{ width: compact ? width : '80vw', maxWidth: 'calc(100vw - 32px)', height: compact ? undefined : '80vh', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-1 overflow-auto shadow-2xl"
      >
        <div className="flex items-center justify-between mb-1.5">
          <h2 id={titleId} className="text-[16px] font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="border-none bg-transparent text-text-muted cursor-pointer flex items-center"
          >
            <XIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  className = '',
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 border-none bg-transparent cursor-pointer ${className}`}
    >
      {label && <span className="text-[12px] font-semibold text-text-muted">{label}</span>}
      <span
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-surface2 border border-border'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mt-2.5 mb-1">
      {children}
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-[13px] text-text-faint">{text}</p>
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={`inline-block flex-shrink-0 rounded-full border-2 border-border border-t-accent animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return <div className={`bg-surface2 rounded-md animate-pulse ${className}`} style={style} />
}
