import React from 'react'
import { useDraft } from '../lib/useDraft'
import { Input, Textarea } from './ui'

// Drop-in replacements for Input / Textarea bound to stored data: they keep a
// local draft and commit through `onCommit`, which resolves to true once the
// write is confirmed.

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'> & {
  value: string
  onCommit: (value: string, expectedRevision?: number) => Promise<boolean>
  resetKey?: unknown
  revision?: number
  delay?: number
}

export function DraftInput({ value, onCommit, resetKey, revision, delay, onBlur, className = '', ...props }: InputProps) {
  const draft = useDraft(value, onCommit, { resetKey, revision, delay })
  return (
    <Input
      {...props}
      value={draft.value}
      aria-invalid={draft.state === 'error' || undefined}
      className={`${className} ${draft.state === 'error' ? '!border-danger' : ''}`}
      onChange={(event) => draft.change(event.target.value)}
      onBlur={(event) => {
        void draft.flush()
        onBlur?.(event)
      }}
    />
  )
}

type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue'> & {
  value: string
  onCommit: (value: string, expectedRevision?: number) => Promise<boolean>
  resetKey?: unknown
  revision?: number
  delay?: number
}

export function DraftTextarea({ value, onCommit, resetKey, revision, delay, onBlur, className = '', ...props }: TextareaProps) {
  const draft = useDraft(value, onCommit, { resetKey, revision, delay })
  return (
    <Textarea
      {...props}
      value={draft.value}
      aria-invalid={draft.state === 'error' || undefined}
      className={`${className} ${draft.state === 'error' ? '!border-danger' : ''}`}
      onChange={(event) => draft.change(event.target.value)}
      onBlur={(event) => {
        void draft.flush()
        onBlur?.(event)
      }}
    />
  )
}
