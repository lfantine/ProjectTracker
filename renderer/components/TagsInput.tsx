import { useState } from 'react'

export function TagsInput({
  tags,
  onChange,
  suggestions = [],
  placeholder = 'Ajouter un tag…',
  className = '',
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
  className?: string
}) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)

  function addTag(raw: string) {
    const value = raw.trim()
    if (!value) return
    if (!tags.includes(value)) onChange(tags.concat([value]))
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  function handleInputChange(value: string) {
    if (!value.includes(',')) {
      setInput(value)
      return
    }
    const parts = value.split(',')
    const remaining = parts.pop() || ''
    const toAdd = parts.map((p) => p.trim()).filter(Boolean)
    if (toAdd.length) {
      const next = tags.slice()
      for (const t of toAdd) if (!next.includes(t)) next.push(t)
      onChange(next)
    }
    setInput(remaining)
  }

  const suggestionList = suggestions.filter(
    (s) => !tags.includes(s) && (input.trim() ? s.toLowerCase().includes(input.trim().toLowerCase()) : true)
  )
  const showSuggestions = focused && suggestionList.length > 0

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded-lg border border-border bg-bg focus-within:border-accent transition">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-[12px] font-semibold bg-surface2 text-text pl-2 pr-1 py-0.5 rounded-full"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="border-none bg-transparent text-text-faint cursor-pointer text-sm leading-none px-1"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setTimeout(() => setFocused(false), 120)
            addTag(input)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag(input)
            } else if (e.key === 'Backspace' && !input && tags.length > 0) {
              removeTag(tags[tags.length - 1])
            }
          }}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-sm text-text placeholder:text-text-faint py-0.5"
        />
      </div>
      {showSuggestions && (
        <div className="absolute z-10 mt-1 w-full max-w-xs bg-surface border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-auto">
          {suggestionList.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                addTag(s)
              }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-text hover:bg-surface-hover cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
